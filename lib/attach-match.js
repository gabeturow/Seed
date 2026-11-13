// Finds which library article a PDF belongs to, by checking how many of an article's title words appear at the start of the PDF.
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "your", "their", "into", "are", "how", "why", "what"]);

export function titleWords(title) {
  return [...new Set(norm(title).split(" ").filter((w) => w.length > 3 && !STOP.has(w)))];
}

// articles: [{id, title}]. head: text from the first pages (plus the file name). Returns {article, score} or null.
export function bestMatch(head, articles) {
  const hay = ` ${norm(head)} `;
  const scored = articles.map((a) => {
    const w = titleWords(a.title);
    if (w.length < 3) return { a, score: 0 };
    return { a, score: w.filter((x) => hay.includes(` ${x} `) || hay.includes(` ${x}`)).length / w.length };
  }).sort((x, y) => y.score - x.score);
  const [top, next] = scored;
  if (!top || top.score < 0.85 || (next && next.score > top.score - 0.1)) return null;
  return { article: top.a, score: top.score };
}
