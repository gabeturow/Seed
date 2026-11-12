"use server";
import { requireApproved } from "@/lib/auth";
import { loadTopicsFor } from "@/lib/articles";
import { cached, hashOf, normalizeKey } from "@/lib/cache";
import { extractPassages, READ_LIMIT } from "@/lib/reader";
import { ask, hasClaudeKey, hostOf, READER_MODEL, SEARCH_MODEL, searchOpenWeb, searchVettedSites, textOf, vettedSites } from "@/lib/claude";

const PAGE = 60_000;        // characters of full text handed over per read when the reader is unavailable
const WEB_CACHE_MS = 24 * 60 * 60 * 1000;   // outside searches are reused for a day

const SYSTEM_BASE = `You are the research assistant for The Seed, a private library of vetted research on the psychology of eating, narrative design, and behavioral design, used by Bite (Building Impact Through Eaters) and its partners.

How to answer:
1. Start from the library catalog in the first message. Prefer library articles over anything else, and cite them.
2. When the short summaries aren't enough to answer accurately and in detail, go deeper in two steps, cheapest first. First call read_detailed_summary for the most relevant articles that have one (the catalog says which): it returns a long, structured summary of the whole article. Answer from it if it covers what you need. Only if it lacks the detail the question needs (exact numbers, methods, sample sizes, quotes, specific examples), call read_article to read the full text; say in the focus what you need, and the passages come back word for word. Don't call read_article for something the detailed summary already answers.
3. If the library doesn't cover the question well, call search_vetted_sources. It searches only the websites of the library's vetted sources. Results from it are NOT in the library and have not been reviewed.
4. If the library and the vetted sources still don't answer the question well, call search_web to search the broader web. This is the last resort; use it only after steps 1 to 3. Results are unreviewed and can be unreliable, so prefer research, institutions, and established organizations, and say when a source looks weak.
5. Never invent studies, numbers, or links. If nothing answers the question, say so plainly.

How to write the answer:
- Plain, direct language. Lead with the answer, then the evidence. Length: follow the length instruction in the question message.
- Use short paragraphs, "- " bullets, and **bold** sparingly. No headings, no tables. In a long answer, you can open a paragraph with a short **bold phrase** to mark the topic.
- Cite library articles as [A12], using the article's id from the catalog. Cite outside results as [W3], using the number from search_vetted_sources. Put the citation right after the claim it supports.
- Keep library findings and outside findings clearly apart. Introduce outside findings with a sentence such as "Outside the library, ..." so readers know they are unvetted.
- Anything that comes from search_web must start with a clear warning, in its own opening sentence: "**Not from the library:** the library and its vetted sources don't cover this, so what follows comes from a broader web search and hasn't been reviewed by Bite." Then cite every claim from it with [W#], naming the publisher in the sentence (for example "A 2023 WHO report found ... [W4]"). Never present web findings as library findings, and never cite a source you didn't get from a search result.
- If a library article's details are flagged as uncertain in its summary, say so.

The reader may ask follow-up questions in the same conversation. Answer the latest question, using the earlier answers as context. You can reuse earlier citations ([A12], [W3]) and don't need to repeat what you already said. Read more articles or search again if the new question needs it.`;

const LENGTHS = {
  paragraph: { rule: "Answer in one paragraph of about 80 to 120 words. Give the bottom line and the strongest evidence, with citations. No bullets.", maxTokens: 6000 },
  page: { rule: "Answer in about one page: roughly 400 to 500 words, in short paragraphs and a few bullets.", maxTokens: 8000 },
  five: { rule: "Answer in about five pages: roughly 2,000 to 2,500 words. Cover the main findings, the evidence behind each (numbers, methods, and settings where the sources give them), where the evidence is thin or mixed, and practical implications. Read full articles where that adds substance.", maxTokens: 16000 },
};

const TOOLS = [
  {
    name: "read_detailed_summary",
    description: "Read an article's long, structured summary (about five pages, written from its full text) by catalog id. Cheaper and faster than read_article. Use it first for articles marked as having a detailed summary; use read_article only if it doesn't contain what you need.",
    input_schema: {
      type: "object",
      properties: { article_id: { type: "integer", description: "The article's id from the catalog, e.g. 12 for [A12]." } },
      required: ["article_id"],
    },
  },
  {
    name: "read_article",
    description: "Read a library article's full text by its catalog id, when the summary is not enough for an accurate, detailed answer. A reader goes through the whole article and returns the passages that bear on your focus, word for word. Ask for one specific thing per call.",
    input_schema: {
      type: "object",
      properties: {
        article_id: { type: "integer", description: "The article's id from the catalog, e.g. 12 for [A12]." },
        focus: { type: "string", description: "What you need from the article, in a sentence: the question, numbers, methods, or examples you're after." },
      },
      required: ["article_id", "focus"],
    },
  },
  {
    name: "search_vetted_sources",
    description: "Search the websites of the library's vetted sources for material the library does not cover. Results are outside the library and unreviewed. Returns numbered results to cite as [W1], [W2], ...",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for, in a few words or a short question." } },
      required: ["query"],
    },
  },
  {
    name: "search_web",
    description: "Last resort: search the broader web when the library and the vetted sources' websites don't answer the question. Results are unreviewed and outside the library's vetting. Returns numbered results to cite as [W#].",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for, in a few words or a short question." } },
      required: ["query"],
    },
  },
];

function catalogText(articles, topicsBy, sourceName) {
  return articles.map((a) => {
    const bits = [
      `[A${a.id}] ${a.title ?? a.url}`,
      a.authors && `Authors: ${a.authors}`,
      (a.publication_year || a.publication_date) && `Year: ${a.publication_year ?? a.publication_date.slice(0, 4)}`,
      a.source_id && sourceName[a.source_id] && `Source: ${sourceName[a.source_id]}`,
      a.resource_type && `Type: ${a.resource_type}`,
      topicsBy[a.id]?.length && `Topics: ${topicsBy[a.id].map((t) => t.name).join(", ")}`,
      `Detailed summary (about 5 pages) available: ${a.has_long ? "yes" : "no"}`,
      `Full text available: ${a.has_text ? "yes" : "no (answer from the summary)"}`,
      `Summary: ${a.summary ?? "(no summary yet)"}`,
    ];
    return bits.filter(Boolean).join("\n");
  }).join("\n\n");
}

async function readDetailedSummary(supabase, ids, input) {
  const id = Number.isInteger(input?.article_id) ? input.article_id : null;
  if (!id || !ids.has(id)) return { text: `There is no library article with id ${input?.article_id}.`, error: true };
  const { data } = await supabase.from("articles").select("title, summary_long").eq("id", id).single();
  if (!data?.summary_long) return { text: "This article has no detailed summary. Use read_article for its full text, or answer from the short summary." };
  return { text: `Detailed summary of [A${id}] ${data.title ?? ""} (AI-written from the full text; it can leave out detail, so if it doesn't cover what the question needs, call read_article):\n\n${data.summary_long}`, summaryRead: id };
}

async function readArticle(supabase, ids, input) {
  const id = Number.isInteger(input?.article_id) ? input.article_id : null;
  if (!id || !ids.has(id)) return { text: `There is no library article with id ${input?.article_id}.`, error: true };
  const { data } = await supabase.from("articles").select("full_text, title, internal").eq("id", id).single();
  const full = data?.full_text;
  if (!full) return { text: "The full text of this article isn't stored in the library. Answer from its summary and say that you couldn't check the full text." };
  const focus = typeof input.focus === "string" ? input.focus.trim() : "";

  // A cheaper, faster model reads the whole article and returns only the relevant passages.
  if (focus) {
    try {
      const text = await extractPassages(supabase, { id, title: data.title, full, internal: data.internal }, focus);
      if (text) {
        const cut = full.length > READ_LIMIT ? ` (Only the first ${READ_LIMIT.toLocaleString("en-US")} of ${full.length.toLocaleString("en-US")} characters were read.)` : "";
        return { text: `Passages from the full text of [A${id}] ${data.title ?? ""}, chosen for: ${focus}${cut}\n\n${text}`, read: id };
      }
    } catch (err) {
      console.error("Article reader failed, handing over raw text:", err?.message);
    }
  }

  // Fallback: hand over the first page of raw text.
  const end = Math.min(full.length, PAGE);
  return { text: `Full text of [A${id}] ${data.title ?? ""}:\n\n${full.slice(0, end)}${end < full.length ? "\n\n[Text continues; only the first part is shown.]" : ""}`, read: id };
}

export async function askLibrary(_prev, fd) {
  const question = String(fd.get("question") ?? "").trim();
  const len = LENGTHS[String(fd.get("length"))] ?? LENGTHS.page;
  if (!question) return { error: "Type a question first." };
  if (question.length > 2000) return { error: "That question is too long. Keep it under 2,000 characters." };
  if (!hasClaudeKey) return { error: "The research assistant isn't set up yet: the Anthropic API key is missing from .env.local." };
  return answerQuestion({ question, len, prior: [] });
}

// A follow-up in an ongoing conversation. `prior` is the earlier questions and answers, oldest first.
const MAX_FOLLOW_UPS = 5;
export async function askFollowUp(question, lengthKey, prior) {
  question = String(question ?? "").trim();
  const len = LENGTHS[lengthKey] ?? LENGTHS.paragraph;
  if (!question) return { error: "Type a question first." };
  if (question.length > 2000) return { error: "That question is too long. Keep it under 2,000 characters." };
  if (!hasClaudeKey) return { error: "The research assistant isn't set up yet: the Anthropic API key is missing from .env.local." };
  const str = (v, max) => typeof v === "string" && v.length <= max;
  const turns = Array.isArray(prior) ? prior : [];
  if (!turns.length || turns.length > MAX_FOLLOW_UPS + 1) return { error: "This conversation is long. Start a new question." };
  const clean = [];
  for (const t of turns) {
    if (!t || !str(t.question, 2000) || !str(t.answer, 40_000) || !t.question.trim() || !t.answer.trim()) return { error: "That conversation couldn't be continued. Ask a new question." };
    const outside = (Array.isArray(t.outside) ? t.outside : []).slice(0, 30)
      .filter((w) => w && Number.isInteger(w.n) && w.n >= 1 && w.n <= 300 && str(w.title, 400) && str(w.url, 800))
      .map((w) => ({ n: w.n, title: w.title, url: w.url, broad: w.broad === true }));
    clean.push({ question: t.question.trim(), answer: t.answer.trim(), outside });
  }
  return answerQuestion({ question, len, prior: clean });
}

async function answerQuestion({ question, len, prior }) {
  const { supabase } = await requireApproved();
  const [{ data: rows }, { data: sources }, sites, { data: textRows }, { data: longRows }] = await Promise.all([
    supabase.from("articles").select("id, url, title, authors, publication_year, publication_date, source_id, resource_type, summary").eq("status", "approved").order("id"),
    supabase.from("sources").select("id, name"),
    vettedSites(supabase),
    supabase.from("articles").select("id").eq("status", "approved").not("full_text", "is", null),       // ids only: the texts themselves are large
    supabase.from("articles").select("id").eq("status", "approved").not("summary_long", "is", null),
  ]);
  const hasText = new Set((textRows ?? []).map((r) => r.id)), hasLong = new Set((longRows ?? []).map((r) => r.id));
  const articles = (rows ?? []).map((a) => ({ ...a, has_text: hasText.has(a.id), has_long: hasLong.has(a.id) }));
  const byId = Object.fromEntries(articles.map((a) => [a.id, a]));
  const topicsBy = await loadTopicsFor(supabase, articles.map((a) => a.id));
  const sourceName = Object.fromEntries((sources ?? []).map((s) => [s.id, s.name]));
  const ids = new Set(articles.map((a) => a.id));

  const web = [];          // numbered outside results: index + 1 = W number
  for (const t of prior) for (const w of t.outside) web[w.n - 1] = { title: w.title, url: w.url, broad: w.broad };   // keep earlier [W] numbers
  const readIds = new Set();
  const asks = [...prior.map((t) => t.question), question];
  let messages = [{
    role: "user",
    content: [
      { type: "text", text: `Library catalog (${articles.length} articles):\n\n${catalogText(articles, topicsBy, sourceName)}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Question: ${asks[0]}\n\nLength: ${(prior.length ? LENGTHS.page : len).rule}` },
    ],
  }];
  prior.forEach((t, i) => {
    messages.push({ role: "assistant", content: t.answer });
    messages.push({ role: "user", content: `Follow-up question: ${asks[i + 1]}\n\nLength: ${len.rule}` });
  });

  try {
    let final = null;
    for (let turn = 0; turn < 12; turn++) {
      const res = await ask({
        model: SEARCH_MODEL, max_tokens: len.maxTokens, system: SYSTEM_BASE, tools: TOOLS, messages,
        output_config: { effort: "medium" },
      });
      if (res.stop_reason === "refusal") return { error: "The assistant couldn't answer that question. Try rephrasing it." };
      const calls = res.content.filter((b) => b.type === "tool_use");
      if (!calls.length || res.stop_reason === "end_turn") { final = res; break; }
      if (res.stop_reason === "max_tokens") break;
      messages = [...messages, { role: "assistant", content: res.content }];
      const results = await Promise.all(calls.map(async (call) => {
        if (call.name === "read_detailed_summary") {
          const r = await readDetailedSummary(supabase, ids, call.input);
          return { type: "tool_result", tool_use_id: call.id, content: r.text, is_error: r.error || undefined };
        }
        if (call.name === "read_article") {
          const r = await readArticle(supabase, ids, call.input);
          if (r.read) readIds.add(r.read);
          return { type: "tool_result", tool_use_id: call.id, content: r.text, is_error: r.error || undefined };
        }
        if (call.name === "search_vetted_sources") {
          const query = typeof call.input?.query === "string" ? call.input.query.trim() : "";
          if (!query) return { type: "tool_result", tool_use_id: call.id, content: "Give a search query.", is_error: true };
          const sitesKey = hashOf(sites.map((x) => x.domain).sort().join(","));
          const { results, notes } = await cached(`web|${sitesKey}|${normalizeKey(query)}`, WEB_CACHE_MS,
            () => searchVettedSites(query, sites), (r) => r.results.length > 0, { supabase, internal: false });
          if (!results.length) return { type: "tool_result", tool_use_id: call.id, content: "No relevant results on the vetted sources' websites." };
          const lines = results.map((r) => {
            web.push(r);
            return `[W${web.length}] ${r.title} — ${r.url}`;
          });
          return {
            type: "tool_result", tool_use_id: call.id,
            content: `Results from the vetted sources' websites (outside the library, unreviewed):\n${lines.join("\n")}\n\nNotes from the search:\n${notes.join("\n\n")}`,
          };
        }
        if (call.name === "search_web") {
          const query = typeof call.input?.query === "string" ? call.input.query.trim() : "";
          if (!query) return { type: "tool_result", tool_use_id: call.id, content: "Give a search query.", is_error: true };
          const { results, notes } = await cached(`openweb|${normalizeKey(query)}`, WEB_CACHE_MS,
            () => searchOpenWeb(query), (r) => r.results.length > 0, { supabase, internal: false });
          if (!results.length) return { type: "tool_result", tool_use_id: call.id, content: "No reliable results on the broader web." };
          const lines = results.map((r) => {
            web.push({ ...r, broad: true });
            return `[W${web.length}] ${r.title} — ${r.url}`;
          });
          return {
            type: "tool_result", tool_use_id: call.id,
            content: `Results from the broader web (not from the library or its vetted sources; unreviewed):\n${lines.join("\n")}\n\nNotes from the search:\n${notes.join("\n\n")}`,
          };
        }
        return { type: "tool_result", tool_use_id: call.id, content: `Unknown tool ${call.name}.`, is_error: true };
      }));
      messages = [...messages, { role: "user", content: results }];
    }
    if (!final) return { error: "The assistant ran out of time before finishing. Try a narrower question." };

    const answer = textOf(final.content);
    const cited = (re) => [...new Set([...answer.matchAll(re)].map((m) => Number(m[1])))];
    return {
      question,
      answer,
      library: cited(/\[A(\d+)\]/g).filter((n) => byId[n]).map((n) => ({
        id: n, title: byId[n].title ?? byId[n].url, url: byId[n].url, authors: byId[n].authors,
        year: byId[n].publication_year, readFull: readIds.has(n),
      })),
      outside: cited(/\[W(\d+)\]/g).filter((n) => web[n - 1]).map((n) => ({ n, ...web[n - 1], site: hostOf(web[n - 1].url), broad: web[n - 1].broad === true })),
      readCount: readIds.size,
    };
  } catch (err) {
    console.error("Research assistant failed:", err);
    return { error: "Something went wrong reaching the assistant. Try again in a minute." };
  }
}
