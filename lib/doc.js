// Shared helpers for an assistant "document": an answer, one-page response, memo, or bibliography.
// A doc looks like:
//   { kind, title, question, body, library: [{id,title,url,authors,year,readFull,note}], outside: [{n,url,title,site}] }
// The body is light text: paragraphs, "- " bullets, "## " headings, **bold**, and citations like [A12] or [W3].

export const KINDS = ["answer", "page", "memo", "bibliography"];

// Only ever link to normal web addresses (never javascript: or similar).
export function safeUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === "http:" || x.protocol === "https:" ? x.href : null;
  } catch {
    return null;
  }
}

// Splits the body into headings, bullet lists, and paragraphs.
export function blocksOf(body) {
  const text = String(body ?? "").replace(/\r/g, "").replace(/^(#{1,3} .+)$/gm, "\n$1\n");
  const out = [];
  for (const chunk of text.split(/\n{2,}/)) {
    let list = null, para = [];
    const flushPara = () => { if (para.length) out.push({ type: "p", text: para.join(" ") }); para = []; };
    const flushList = () => { if (list) out.push({ type: "ul", items: list }); list = null; };
    for (const raw of chunk.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (/^#{1,3} /.test(line)) { flushPara(); flushList(); out.push({ type: "h", text: line.replace(/^#{1,3} /, "") }); }
      else if (/^[-•]\s+/.test(line)) { flushPara(); (list ??= []).push(line.replace(/^[-•]\s+/, "")); }
      else { flushList(); para.push(line); }
    }
    flushPara(); flushList();
  }
  return out;
}

// Splits a line into plain text, **bold**, and [A12] / [W3] citations.
export function tokensOf(text) {
  return String(text).split(/(\*\*[^*]+\*\*|\[[AW]\d+\])/g).filter((p) => p !== "").map((p) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return { t: "bold", text: p.slice(2, -2) };
    const m = p.match(/^\[([AW])(\d+)\]$/);
    if (m) return { t: "cite", kind: m[1], key: Number(m[2]) };
    return { t: "text", text: p };
  });
}

// Library articles are numbered 1, 2, 3 ... in the order the doc lists them.
export const libraryNumbers = (doc) => Object.fromEntries((doc.library ?? []).map((a, i) => [a.id, i + 1]));

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Checks a doc that came from the browser, so only plain, size-limited data is used or saved.
export function cleanDoc(raw) {
  if (!raw || typeof raw !== "object") return null;
  const body = str(raw.body, 40000);
  const library = (Array.isArray(raw.library) ? raw.library : []).slice(0, 80)
    .filter((a) => a && Number.isInteger(a.id))
    .map((a) => ({
      id: a.id, title: str(a.title, 400), url: safeUrl(a.url), authors: str(a.authors, 400) || null,
      year: Number.isInteger(a.year) ? a.year : null, readFull: Boolean(a.readFull), note: str(a.note, 1200) || null,
    }));
  const outside = (Array.isArray(raw.outside) ? raw.outside : []).slice(0, 80)
    .filter((w) => w && Number.isInteger(w.n) && safeUrl(w.url))
    .map((w) => ({ n: w.n, url: safeUrl(w.url), title: str(w.title, 400), site: str(w.site, 120) }));
  if (!body && !library.length) return null;
  return {
    kind: KINDS.includes(raw.kind) ? raw.kind : "answer",
    title: str(raw.title, 300), question: str(raw.question, 2000), body, library, outside,
  };
}

export const KIND_LABEL = { answer: "Answer", page: "1-page annotated", memo: "Memo", bibliography: "Annotated bibliography" };

export const fileBase = (doc) =>
  (doc.title || doc.question || "seed-answer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "seed-answer";

const authorLine = (a) => [a.authors, a.year].filter(Boolean).join(", ");

// Plain-text version, for copying into an email or document.
export function docToText(doc) {
  const num = libraryNumbers(doc);
  const web = Object.fromEntries((doc.outside ?? []).map((w) => [w.n, w]));
  const cite = (s) => s.replace(/\[A(\d+)\]/g, (m, id) => (num[id] ? `[${num[id]}]` : "")).replace(/\[W(\d+)\]/g, (m, n) => (web[n] ? `[${web[n].site || "web"}]` : ""));
  const lines = [];
  if (doc.title) lines.push(doc.title, "");
  for (const b of blocksOf(doc.body)) {
    if (b.type === "h") lines.push(b.text.toUpperCase(), "");
    else if (b.type === "ul") lines.push(...b.items.map((i) => `- ${cite(i).replace(/\*\*/g, "")}`), "");
    else lines.push(cite(b.text).replace(/\*\*/g, ""), "");
  }
  if (doc.library.length) {
    lines.push("SOURCES (library)");
    doc.library.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.title}${authorLine(a) ? ` (${authorLine(a)})` : ""}${a.url ? ` - ${a.url}` : ""}`);
      if (a.note) lines.push(`   ${a.note}`);
    });
    lines.push("");
  }
  if (doc.outside.length) {
    lines.push("OUTSIDE THE LIBRARY (unvetted: found on vetted sources' websites, not reviewed)");
    doc.outside.forEach((w) => lines.push(`- ${w.title} (${w.site}) - ${w.url}`));
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Rich version (keeps links and bold), so it pastes into Gmail, Docs, or Word with the links intact.
export function docToHtml(doc) {
  const num = libraryNumbers(doc);
  const lib = Object.fromEntries(doc.library.map((a) => [a.id, a]));
  const web = Object.fromEntries(doc.outside.map((w) => [w.n, w]));
  const inline = (s) => tokensOf(s).map((t) => {
    if (t.t === "bold") return `<strong>${esc(t.text)}</strong>`;
    if (t.t === "cite") {
      if (t.kind === "A" && num[t.key]) return lib[t.key].url ? `<a href="${esc(lib[t.key].url)}">[${num[t.key]}]</a>` : `[${num[t.key]}]`;
      if (t.kind === "W" && web[t.key]) return `<a href="${esc(web[t.key].url)}">[${esc(web[t.key].site || "web")}]</a>`;
      return "";
    }
    return esc(t.text);
  }).join("");
  const out = [];
  if (doc.title) out.push(`<h2>${esc(doc.title)}</h2>`);
  for (const b of blocksOf(doc.body)) {
    if (b.type === "h") out.push(`<h3>${esc(b.text)}</h3>`);
    else if (b.type === "ul") out.push(`<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
    else out.push(`<p>${inline(b.text)}</p>`);
  }
  if (doc.library.length) {
    out.push("<h3>Sources</h3><ol>" + doc.library.map((a) =>
      `<li>${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)}${authorLine(a) ? ` (${esc(authorLine(a))})` : ""}${a.note ? `<br>${esc(a.note)}` : ""}</li>`).join("") + "</ol>");
  }
  if (doc.outside.length) {
    out.push("<h3>Outside the library (unvetted)</h3><p><em>Found on vetted sources' websites, not reviewed.</em></p><ul>" +
      doc.outside.map((w) => `<li><a href="${esc(w.url)}">${esc(w.title)}</a> (${esc(w.site)})</li>`).join("") + "</ul>");
  }
  return out.join("");
}
