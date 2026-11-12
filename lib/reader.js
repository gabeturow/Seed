import { cached, hashOf, normalizeKey } from "./cache";
import { ask, READER_MODEL, textOf } from "./claude";

export const READ_LIMIT = 600_000;   // most characters of one article the reader looks at
const READ_CACHE_MS = 6 * 60 * 60 * 1000;

const READER_SYSTEM = `You help a research assistant by pulling the relevant passages out of one long article.
Return only what the article says that bears on the focus you are given:
- Copy passages word for word, in quotation marks. Do not paraphrase, and do not add anything the article doesn't say.
- Keep exact numbers, sample sizes, methods, and conditions with the passage they belong to. Say where each passage appears (section or heading) when you can tell.
- Include up to about 1,500 words in total, most important first. If the article has nothing relevant, say "Nothing relevant in this article." and stop.`;

// A fast model reads the whole article and returns only the passages that bear on `focus`, word for word.
// The same article read for the same focus is reused (the key includes a fingerprint of the text, so an edit re-reads it).
export async function extractPassages(supabase, { id, title, full, internal }, focus) {
  return cached(`read|${id}|${hashOf(full)}|${normalizeKey(focus)}`, READ_CACHE_MS, async () => {
    const res = await ask({
      model: READER_MODEL, max_tokens: 4000, system: READER_SYSTEM,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: `Article: ${title ?? ""}\n\n${full.slice(0, READ_LIMIT)}\n\n---\nFocus: ${focus}` }],
    });
    return res.stop_reason === "refusal" ? "" : textOf(res.content).trim();
  }, (t) => Boolean(t), { supabase, internal: Boolean(internal) });
}
