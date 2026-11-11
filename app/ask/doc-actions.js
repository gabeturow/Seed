"use server";
import { requireApproved } from "@/lib/auth";
import { ask, hasClaudeKey, SEARCH_MODEL, textOf } from "@/lib/claude";
import { cleanDoc, KIND_LABEL } from "@/lib/doc";

// ---------- Share link ----------
export async function shareDoc(rawDoc) {
  const doc = cleanDoc(rawDoc);
  if (!doc) return { error: "There's nothing to share yet." };
  const { supabase } = await requireApproved();
  // An answer that draws on internal articles can only be opened by staff.
  const ids = doc.library.map((a) => a.id);
  const { data: inner } = ids.length ? await supabase.from("articles").select("id").in("id", ids).eq("internal", true) : { data: [] };
  const { data, error } = await supabase.from("shared_answers").insert({ doc, internal: (inner ?? []).length > 0 }).select("id").single();
  if (error) {
    const missing = /shared_answers/.test(error.message);
    const needsAccess = /internal/.test(error.message);
    return { error: needsAccess ? "Run database/update-access.sql in Supabase first, then try again." : missing ? "Share links aren't set up yet. Run database/update-ai-features.sql in Supabase first." : "Couldn't create the link. Try again." };
  }
  return { path: `/ask/shared/${data.id}` };
}

// ---------- Other ways to see an answer ----------
const COMMON = `Use only what the answer and the source details below say. Do not add studies, numbers, or claims that are not there. Keep the citations: [A12] for library articles and [W3] for outside (unvetted) results, placed right after the claim they support. Plain, direct language. Light formatting only: short paragraphs, "- " bullets, **bold** sparingly, and "## " headings only where asked.`;

const KIND_PROMPT = {
  page: `Rewrite the answer as a one-page annotated response of about 400 words.
Start with one line "TITLE: " and a short title. Then a two-sentence bottom line. Then 5 to 8 bullets, one per key idea: the idea in a sentence, then the evidence in a sentence, then its citation. If a claim rests only on outside (unvetted) results, say so in that bullet.`,
  memo: `Rewrite the answer as a short memo that someone could share with colleagues, about 500 to 700 words.
Start with one line "TITLE: " and a short title. Then these sections, each starting with a "## " heading: "## Bottom line" (2 to 3 sentences), "## What the research shows" (short paragraphs or bullets with citations), "## What to do" (3 to 5 practical recommendations that follow from the evidence, as bullets), "## How strong is the evidence" (what is solid, what is thin or mixed, what outside unvetted results add). Do not invent a sender, recipient, or date.`,
  bibliography: `Write an annotated bibliography. For each source below, write one or two sentences saying what it contributes to the answer and what kind of evidence it is (for example a field experiment, a review, a guide). Output one line per source, in this exact form: "[A12] annotation" using the source's own id, and nothing else. Skip the outside results; they are not annotated.`,
};

export async function reshapeDoc(rawBase, kind) {
  const base = cleanDoc(rawBase);
  if (!base || !KIND_PROMPT[kind]) return { error: "There's nothing to reshape yet." };
  if (!hasClaudeKey) return { error: "The Anthropic API key is missing from .env.local." };
  const { supabase } = await requireApproved();

  // Source details come from the library itself, not from the browser.
  const ids = base.library.map((a) => a.id);
  const { data: rows } = ids.length
    ? await supabase.from("articles").select("id, title, authors, publication_year, resource_type, summary").in("id", ids).eq("status", "approved")
    : { data: [] };
  const known = Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
  const library = base.library.filter((a) => known[a.id]);

  const sources = [
    ...library.map((a) => {
      const r = known[a.id];
      return `[A${a.id}] ${r.title}${r.authors ? ` - ${r.authors}` : ""}${r.publication_year ? `, ${r.publication_year}` : ""}${r.resource_type ? ` (${r.resource_type})` : ""}\nSummary: ${r.summary ?? "(none)"}`;
    }),
    ...base.outside.map((w) => `[W${w.n}] ${w.title} (${w.site}) - outside the library, unvetted`),
  ].join("\n\n");

  try {
    const res = await ask({
      model: SEARCH_MODEL, max_tokens: 6000,
      output_config: { effort: "low" },
      messages: [{
        role: "user",
        content: `${COMMON}\n\n${KIND_PROMPT[kind]}\n\nQuestion: ${base.question}\n\nAnswer:\n${base.body}\n\nSources:\n${sources}`,
      }],
    });
    if (res.stop_reason === "refusal") return { error: "That couldn't be written. Try again." };
    const text = textOf(res.content).trim();
    if (!text) return { error: "Nothing came back. Try again." };

    if (kind === "bibliography") {
      const notes = {};
      for (const m of text.matchAll(/^\s*\[A(\d+)\]\s*(.+)$/gm)) notes[Number(m[1])] = m[2].trim();
      return {
        doc: {
          kind, title: "Annotated bibliography", question: base.question, body: "",
          library: library.map((a) => ({ ...a, note: notes[a.id] ?? null })), outside: base.outside,
        },
      };
    }

    let title = KIND_LABEL[kind];
    let body = text;
    const t = text.match(/^\s*TITLE:\s*(.+)\n?/i);
    if (t) { title = t[1].trim().replace(/^\*+|\*+$/g, ""); body = text.slice(t[0].length).trim(); }

    // Keep only the sources the new text cites, in order of first mention.
    const order = (re) => [...new Set([...body.matchAll(re)].map((m) => Number(m[1])))];
    const libById = Object.fromEntries(library.map((a) => [a.id, a]));
    const webByN = Object.fromEntries(base.outside.map((w) => [w.n, w]));
    return {
      doc: {
        kind, title, question: base.question, body,
        library: order(/\[A(\d+)\]/g).filter((id) => libById[id]).map((id) => libById[id]),
        outside: order(/\[W(\d+)\]/g).filter((n) => webByN[n]).map((n) => webByN[n]),
      },
    };
  } catch (err) {
    console.error("Reshaping an answer failed:", err);
    return { error: "Something went wrong writing that. Try again in a minute." };
  }
}
