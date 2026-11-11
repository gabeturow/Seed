"use server";
import { requireApproved } from "@/lib/auth";
import { loadTopicsFor } from "@/lib/articles";
import { ask, hasClaudeKey, hostOf, READER_MODEL, SEARCH_MODEL, searchVettedSites, textOf, vettedSites } from "@/lib/claude";

const PAGE = 60_000;        // characters of full text handed over per read when the reader is unavailable
const READ_LIMIT = 600_000; // most characters of one article the reader looks at

const READER_SYSTEM = `You help a research assistant by pulling the relevant passages out of one long article.
Return only what the article says that bears on the focus you are given:
- Copy passages word for word, in quotation marks. Do not paraphrase, and do not add anything the article doesn't say.
- Keep exact numbers, sample sizes, methods, and conditions with the passage they belong to. Say where each passage appears (section or heading) when you can tell.
- Include up to about 1,500 words in total, most important first. If the article has nothing relevant, say "Nothing relevant in this article." and stop.`;

const SYSTEM_BASE = `You are the research assistant for The Seed, a private library of vetted research on the psychology of eating, narrative design, and behavioral design, used by Bite (Building Impact Through Eaters) and its partners.

How to answer:
1. Start from the library catalog in the first message. Prefer library articles over anything else, and cite them.
2. When the summaries aren't enough to answer accurately and in detail (exact numbers, methods, sample sizes, quotes, specific examples), call read_article to read the full text of the most relevant articles. Say in the focus what you need (specific numbers, methods, examples); the passages come back word for word.
3. If the library doesn't cover the question well, call search_vetted_sources. It searches only the websites of the library's vetted sources. Results from it are NOT in the library and have not been reviewed.
4. Never invent studies, numbers, or links. If neither the library nor the vetted sources answer the question, say so plainly.

How to write the answer:
- Plain, direct language. Lead with the answer, then the evidence. Length: follow the length instruction in the question message.
- Use short paragraphs, "- " bullets, and **bold** sparingly. No headings, no tables. In a long answer, you can open a paragraph with a short **bold phrase** to mark the topic.
- Cite library articles as [A12], using the article's id from the catalog. Cite outside results as [W3], using the number from search_vetted_sources. Put the citation right after the claim it supports.
- Keep library findings and outside findings clearly apart. Introduce outside findings with a sentence such as "Outside the library, ..." so readers know they are unvetted.
- If a library article's details are flagged as uncertain in its summary, say so.`;

const LENGTHS = {
  paragraph: { rule: "Answer in one paragraph of about 80 to 120 words. Give the bottom line and the strongest evidence, with citations. No bullets.", maxTokens: 6000 },
  page: { rule: "Answer in about one page: roughly 400 to 500 words, in short paragraphs and a few bullets.", maxTokens: 8000 },
  five: { rule: "Answer in about five pages: roughly 2,000 to 2,500 words. Cover the main findings, the evidence behind each (numbers, methods, and settings where the sources give them), where the evidence is thin or mixed, and practical implications. Read full articles where that adds substance.", maxTokens: 16000 },
};

const TOOLS = [
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
      `Full text available: ${a.has_text ? "yes" : "no (answer from the summary)"}`,
      `Summary: ${a.summary ?? "(no summary yet)"}`,
    ];
    return bits.filter(Boolean).join("\n");
  }).join("\n\n");
}

async function readArticle(supabase, ids, input) {
  const id = Number.isInteger(input?.article_id) ? input.article_id : null;
  if (!id || !ids.has(id)) return { text: `There is no library article with id ${input?.article_id}.`, error: true };
  const { data } = await supabase.from("articles").select("full_text, title").eq("id", id).single();
  const full = data?.full_text;
  if (!full) return { text: "The full text of this article isn't stored in the library. Answer from its summary and say that you couldn't check the full text." };
  const focus = typeof input.focus === "string" ? input.focus.trim() : "";

  // A cheaper, faster model reads the whole article and returns only the relevant passages.
  if (focus) {
    try {
      const res = await ask({
        model: READER_MODEL, max_tokens: 4000, system: READER_SYSTEM,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: `Article: ${data.title ?? ""}\n\n${full.slice(0, READ_LIMIT)}\n\n---\nFocus: ${focus}` }],
      });
      const text = textOf(res.content).trim();
      if (text && res.stop_reason !== "refusal") {
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

  const { supabase } = await requireApproved();
  const [{ data: rows }, { data: sources }, sites] = await Promise.all([
    supabase.from("articles").select("id, url, title, authors, publication_year, publication_date, source_id, resource_type, summary, full_text").eq("status", "approved").order("id"),
    supabase.from("sources").select("id, name"),
    vettedSites(supabase),
  ]);
  const articles = (rows ?? []).map(({ full_text, ...a }) => ({ ...a, has_text: Boolean(full_text) }));
  const byId = Object.fromEntries(articles.map((a) => [a.id, a]));
  const topicsBy = await loadTopicsFor(supabase, articles.map((a) => a.id));
  const sourceName = Object.fromEntries((sources ?? []).map((s) => [s.id, s.name]));
  const ids = new Set(articles.map((a) => a.id));

  const web = [];          // numbered outside results: index + 1 = W number
  const readIds = new Set();
  let messages = [{
    role: "user",
    content: [
      { type: "text", text: `Library catalog (${articles.length} articles):\n\n${catalogText(articles, topicsBy, sourceName)}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Question: ${question}\n\nLength: ${len.rule}` },
    ],
  }];

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
        if (call.name === "read_article") {
          const r = await readArticle(supabase, ids, call.input);
          if (r.read) readIds.add(r.read);
          return { type: "tool_result", tool_use_id: call.id, content: r.text, is_error: r.error || undefined };
        }
        if (call.name === "search_vetted_sources") {
          const query = typeof call.input?.query === "string" ? call.input.query.trim() : "";
          if (!query) return { type: "tool_result", tool_use_id: call.id, content: "Give a search query.", is_error: true };
          const { results, notes } = await searchVettedSites(query, sites);
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
      outside: cited(/\[W(\d+)\]/g).filter((n) => web[n - 1]).map((n) => ({ n, ...web[n - 1], site: hostOf(web[n - 1].url) })),
      readCount: readIds.size,
    };
  } catch (err) {
    console.error("Research assistant failed:", err);
    return { error: "Something went wrong reaching the assistant. Try again in a minute." };
  }
}
