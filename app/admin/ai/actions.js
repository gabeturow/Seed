"use server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setTopics } from "@/lib/articles";
import { withMsg } from "@/lib/forms";
import { ask, chunk, hasClaudeKey, hostOf, SEARCH_MODEL, searchResultsIn, vettedSites } from "@/lib/claude";

const BACK = "/admin/ai";
const MAX_PER_GROUP = 4;   // most articles one group of websites can add per run
const GROUP_SIZE = 25;     // websites searched together

const ADD_TOOL = {
  name: "add_candidate",
  description: "Put one article you found into The Seed's review queue. Only use URLs that appeared in your web search results. Call once per article.",
  input_schema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Exact URL of the article or report, from the search results." },
      title: { type: "string" },
      authors: { type: "string", description: "Authors or organization, if shown. Leave out if unknown." },
      year: { type: "integer", description: "Publication year, if shown." },
      resource_type: { type: "string", description: "e.g. report, journal article, toolkit, case study, article" },
      summary: { type: "string", description: "Two to four plain sentences: what was studied or argued, and the main findings. Only what the source says." },
      why_relevant: { type: "string", description: "One sentence on why it belongs in The Seed." },
      topics: { type: "array", items: { type: "string" }, description: "Up to 4 topics, chosen only from the topic list." },
    },
    required: ["url", "title", "summary", "why_relevant"],
  },
};

const norm = (u) => String(u ?? "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[#?].*$/, "").replace(/\/+$/, "");

export async function runScout() {
  const { supabase } = await requireAdmin();
  if (!hasClaudeKey) redirect(withMsg(BACK, "The Anthropic API key is missing from .env.local.", "error"));

  const [sites, { data: topics }, { data: existing }] = await Promise.all([
    vettedSites(supabase, { scoutOnly: true }),
    supabase.from("topics").select("id, name"),
    supabase.from("articles").select("url, title"),
  ]);
  if (!sites.length) redirect(withMsg(BACK, "No sources have a website yet. Add websites on the Sources page first.", "error"));

  const topicId = Object.fromEntries((topics ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  const known = new Set((existing ?? []).map((a) => norm(a.url)));
  const knownTitles = (existing ?? []).map((a) => a.title).filter(Boolean);
  const sourceFor = (url) => {
    const h = hostOf(url);
    return sites.find((s) => h === s.domain || h?.endsWith("." + s.domain))?.ids[0] ?? null;
  };
  const oldest = sites.map((s) => s.lastScouted).filter(Boolean).sort()[0];
  const since = oldest ? new Date(oldest) : new Date(Date.now() - 2 * 365 * 864e5);
  const sinceText = since.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const prompt = (domains) => `You are the scout for The Seed, a vetted research library for Bite (Building Impact Through Eaters). The library covers the psychology of eating, narrative design, and behavioral design: how language, menus, defaults, framing, and choice architecture shift what people choose to eat, especially toward climate-smart, plant-forward food.

Search these websites for research, reports, toolkits, or case studies published since ${sinceText} that fit the library:
${domains.join(", ")}

Look for substantive pieces with evidence or practical guidance (studies, reports, toolkits, case studies), not news items, press releases, job posts, or event pages. Skip anything already in the library:
${knownTitles.map((t) => `- ${t}`).join("\n")}

For each good find, call add_candidate (at most ${MAX_PER_GROUP} in total, best first). Use only URLs from your search results. Choose topics only from this list: ${(topics ?? []).map((t) => t.name).join(", ")}.
When you're done, reply with one sentence saying how many you added.`;

  let added = 0, skipped = 0;
  const failures = [];

  await Promise.all(chunk(sites, GROUP_SIZE).map(async (group) => {
    const domains = group.map((s) => s.domain);
    const seenUrls = new Set();
    let count = 0;
    let messages = [{ role: "user", content: prompt(domains) }];
    try {
      for (let turn = 0; turn < 10; turn++) {
        const res = await ask({
          model: SEARCH_MODEL, max_tokens: 8000, messages,
          output_config: { effort: "medium" },
          // Save the conversation so far (including search results) so each later step re-reads it at a fraction of the price.
          cache_control: { type: "ephemeral" },
          tools: [{ type: "web_search_20260209", name: "web_search", allowed_domains: domains, max_uses: 8 }, ADD_TOOL],
        });
        for (const r of searchResultsIn(res.content)) seenUrls.add(norm(r.url));
        messages = [...messages, { role: "assistant", content: res.content }];
        if (res.stop_reason === "pause_turn") continue;
        const calls = res.content.filter((b) => b.type === "tool_use" && b.name === "add_candidate");
        if (!calls.length) break;

        const results = [];
        for (const call of calls) {
          const c = call.input ?? {};
          const reply = (content, is_error) => results.push({ type: "tool_result", tool_use_id: call.id, content, is_error: is_error || undefined });
          if (typeof c.url !== "string" || typeof c.title !== "string" || typeof c.summary !== "string") { reply("Missing url, title, or summary.", true); continue; }
          const key = norm(c.url);
          if (!seenUrls.has(key)) { reply("That URL wasn't in your search results. Only add articles you found.", true); continue; }
          if (!hostOf(c.url) || !sourceFor(c.url)) { reply("That URL isn't on one of the vetted websites.", true); continue; }
          if (known.has(key)) { skipped++; reply("Already in the library or the review queue. Skipped."); continue; }
          if (count >= MAX_PER_GROUP) { reply(`Limit of ${MAX_PER_GROUP} reached. Stop adding.`); continue; }

          known.add(key);
          const { data: row, error } = await supabase.from("articles").insert({
            url: c.url.trim(), title: c.title.trim(),
            authors: typeof c.authors === "string" ? c.authors.trim() || null : null,
            publication_year: Number.isInteger(c.year) && c.year > 1900 && c.year < 2100 ? c.year : null,
            resource_type: typeof c.resource_type === "string" ? c.resource_type : null,
            source_id: sourceFor(c.url),
            summary: c.summary.trim(), summary_origin: "ai_draft", summary_needs_review: true,
            submission_note: typeof c.why_relevant === "string" ? c.why_relevant : null,
            admin_notes: `Found by the scout on ${new Date().toLocaleDateString("en-US")}. Check the details and summary against the article.`,
            status: "pending", origin: "scout",
          }).select("id").single();
          if (error) { reply(`Couldn't save it: ${error.message}`, true); continue; }
          const tids = (Array.isArray(c.topics) ? c.topics : []).map((t) => topicId[String(t).toLowerCase()]).filter(Boolean).slice(0, 4);
          try { await setTopics(supabase, row.id, tids); } catch { /* topics are optional */ }
          count++; added++;
          reply("Added to the review queue.");
        }
        messages = [...messages, { role: "user", content: results }];
      }
      await supabase.from("sources").update({ last_scouted_at: new Date().toISOString() }).in("id", group.flatMap((s) => s.ids));
    } catch (err) {
      console.error("Scout group failed:", err);
      failures.push(err?.error?.error?.message || err?.message || "unknown error");
    }
  }));

  revalidatePath("/", "layout");
  const parts = [
    added ? `The scout added ${added} article${added === 1 ? "" : "s"} to the review queue.` : "The scout didn't find anything new this time.",
    skipped ? `It skipped ${skipped} already in the library.` : "",
    failures.length ? `Some websites couldn't be searched (${failures.length} group${failures.length === 1 ? "" : "s"}). Anthropic said: ${failures[0]}` : "",
  ];
  redirect(withMsg(added ? "/admin/review" : BACK, parts.filter(Boolean).join(" "), failures.length && !added ? "error" : "msg"));
}

// One-time: copy the saved text of the library's Drive files into the database.
export async function loadFullText() {
  const { supabase } = await requireAdmin();
  let files;
  try {
    files = JSON.parse(await readFile(path.join(process.cwd(), "database", "full-text.json"), "utf8"));
  } catch {
    redirect(withMsg(BACK, "Couldn't find database/full-text.json.", "error"));
  }
  let loaded = 0;
  for (const f of files) {
    const { data, error } = await supabase.from("articles").update({ full_text: f.text })
      .like("url", `%${f.drive_id}%`).select("id");
    if (error) {
      const hint = /full_text/.test(error.message) ? " Run database/update-ai-features.sql in Supabase first." : "";
      redirect(withMsg(BACK, `Couldn't save the text: ${error.message}.${hint}`, "error"));
    }
    loaded += data?.length ?? 0;
  }
  revalidatePath(BACK);
  redirect(withMsg(BACK, `Loaded the full text of ${loaded} articles.`));
}

// Adds articles from database/drive-import.json (fetched from the shared Drive folder) to the review queue, with their full text.
export async function importDriveArticles() {
  const { supabase } = await requireAdmin();
  let items;
  try {
    items = JSON.parse(await readFile(path.join(process.cwd(), "database", "drive-import.json"), "utf8"));
  } catch {
    redirect(withMsg(BACK, "Couldn't find database/drive-import.json.", "error"));
  }
  const [{ data: topics }, { data: sources }, { data: existing }] = await Promise.all([
    supabase.from("topics").select("id, name"),
    supabase.from("sources").select("id, name"),
    supabase.from("articles").select("url"),
  ]);
  const topicId = Object.fromEntries((topics ?? []).map((t) => [t.name.toLowerCase(), t.id]));
  const have = (existing ?? []).map((a) => a.url);
  const sourceFor = (name) => {
    const n = String(name ?? "").toLowerCase();
    if (!n) return null;
    return (sources ?? []).find((s) => n.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(n))?.id ?? null;
  };

  let added = 0, skipped = 0;
  for (const it of items) {
    if (have.some((u) => u.includes(it.drive_id))) { skipped++; continue; }
    const notes = [`From the shared Drive folder. Title, authors, year and summary were drafted by AI from the article text; check them.`,
      it.publisher ? `Publisher or journal: ${it.publisher}.` : "", ...(it.uncertain ?? [])].filter(Boolean).join(" ");
    const { data: row, error } = await supabase.from("articles").insert({
      url: `https://drive.google.com/file/d/${it.drive_id}/view?usp=drivesdk`,
      title: it.title, authors: it.authors || null,
      publication_year: Number.isInteger(it.year) ? it.year : null,
      resource_type: it.resource_type || null, source_id: sourceFor(it.publisher),
      summary: it.summary, summary_origin: "ai_draft", summary_needs_review: true,
      admin_notes: notes, full_text: it.text, status: "pending", origin: "import",
    }).select("id").single();
    if (error) { redirect(withMsg(BACK, `Stopped after ${added}: ${error.message}`, "error")); }
    const tids = (it.topics ?? []).map((t) => topicId[String(t).toLowerCase()]).filter(Boolean).slice(0, 4);
    try { await setTopics(supabase, row.id, tids); } catch { /* topics are optional */ }
    added++;
  }
  revalidatePath("/", "layout");
  redirect(withMsg(added ? "/admin/review" : BACK,
    added ? `Added ${added} article${added === 1 ? "" : "s"} from Drive to the review queue.${skipped ? ` Skipped ${skipped} already in the library.` : ""}`
          : `Nothing new to add (${skipped} already in the library).`));
}
