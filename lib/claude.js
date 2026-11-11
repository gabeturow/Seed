// Everything that talks to Claude (Anthropic's AI) lives here.
// Used by the research assistant (/ask) and the scout (/admin/ai).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";          // (not currently used; Ask and the scout run on SEARCH_MODEL)
export const SEARCH_MODEL = "claude-sonnet-5-5"; // answers questions on the Ask page and runs the quick web searches
export const READER_MODEL = "claude-haiku-5-5";   // reads long articles and pulls out the relevant passages
export const hasClaudeKey = Boolean(process.env.ANTHROPIC_API_KEY);

let client;
// Keys not tied to one workspace need the workspace ID on every request (ANTHROPIC_WORKSPACE_ID in .env.local).
const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
export const claude = () => (client ??= new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}));

// If Claude declines a request, let Anthropic retry it on a fallback model instead of failing.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
export const ask = (params) => claude().beta.messages.create({ ...FALLBACK, ...params });

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

// The vetted websites, from the Sources page: [{ domain, name, id }]
export async function vettedSites(supabase, { scoutOnly = false } = {}) {
  let q = supabase.from("sources").select("id, name, website_url, scout_enabled, last_scouted_at")
    .not("website_url", "is", null);
  const { data } = await q;
  const seen = new Map();
  for (const s of data ?? []) {
    if (scoutOnly && !s.scout_enabled) continue;
    const domain = hostOf(s.website_url);
    if (!domain) continue;
    if (!seen.has(domain)) seen.set(domain, { domain, names: [], ids: [], lastScouted: s.last_scouted_at });
    seen.get(domain).names.push(s.name);
    seen.get(domain).ids.push(s.id);
  }
  return [...seen.values()];
}

export const isVetted = (url, sites) => {
  const h = hostOf(url);
  return Boolean(h && sites.some((s) => h === s.domain || h.endsWith("." + s.domain)));
};

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Pull every search result (url + title) out of a response.
export function searchResultsIn(content) {
  const out = [];
  for (const block of content ?? []) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) if (r.url) out.push({ url: r.url, title: r.title ?? r.url });
    }
  }
  return out;
}

export const textOf = (content) =>
  (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();

// Search only the vetted websites. The web search tool takes at most 64 sites per search,
// so the list is split into groups that are searched side by side.
export async function searchVettedSites(question, sites) {
  if (!sites.length) return { results: [], notes: [] };
  const groups = chunk(sites.map((s) => s.domain), 60);
  const runs = await Promise.allSettled(groups.map(async (domains) => {
    let messages = [{
      role: "user",
      content:
        `Search for published research, reports, or articles that help answer this question:\n"${question}"\n\n` +
        `List up to 5 of the most relevant items you found. For each, give the title, the exact URL, the publisher, ` +
        `the year if shown, and one or two sentences on what it says that bears on the question. ` +
        `Only list items that appeared in your search results. If nothing relevant turns up, say so.`,
    }];
    const found = [];
    for (let turn = 0; turn < 4; turn++) {
      const res = await claude().messages.create({
        model: SEARCH_MODEL, max_tokens: 4000,
        output_config: { effort: "low" },
        tools: [{ type: "web_search_20260209", name: "web_search", allowed_domains: domains, max_uses: 3 }],
        messages,
      });
      found.push(...searchResultsIn(res.content));
      if (res.stop_reason !== "pause_turn") return { results: found, note: textOf(res.content) };
      messages = [...messages, { role: "assistant", content: res.content }];
    }
    return { results: found, note: "" };
  }));
  const results = [], notes = [], seen = new Set();
  for (const r of runs) {
    if (r.status !== "fulfilled") { console.error("Vetted search failed:", r.reason?.message); continue; }
    if (r.value.note) notes.push(r.value.note);
    for (const item of r.value.results) {
      if (seen.has(item.url) || !isVetted(item.url, sites)) continue;
      seen.add(item.url);
      results.push(item);
    }
  }
  return { results, notes };
}
