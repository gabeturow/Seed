// Builds a Word (.docx) file from a doc. Loaded only when someone clicks "Word", so it doesn't weigh down the page.
import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { blocksOf, fileBase, libraryNumbers, tokensOf } from "./doc.js";

const link = (text, url, extra = {}) =>
  new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink", ...extra })] });

export async function makeWord(doc) {
  const num = libraryNumbers(doc);
  const lib = Object.fromEntries(doc.library.map((a) => [a.id, a]));
  const web = Object.fromEntries(doc.outside.map((w) => [w.n, w]));

  const runs = (text) => tokensOf(text).flatMap((t) => {
    if (t.t === "bold") return [new TextRun({ text: t.text, bold: true })];
    if (t.t === "cite") {
      if (t.kind === "A" && num[t.key]) return [lib[t.key].url ? link(`[${num[t.key]}]`, lib[t.key].url) : new TextRun(`[${num[t.key]}]`)];
      if (t.kind === "W" && web[t.key]) return [link(`[${web[t.key].site || "web"}]`, web[t.key].url)];
      return [];
    }
    return [new TextRun(t.text)];
  });

  const kids = [];
  if (doc.title) kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(doc.title)] }));
  if (doc.question && doc.question !== doc.title) {
    kids.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: `Question: ${doc.question}`, italics: true })] }));
  }
  for (const b of blocksOf(doc.body)) {
    if (b.type === "h") kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(b.text)] }));
    else if (b.type === "ul") b.items.forEach((i) => kids.push(new Paragraph({ bullet: { level: 0 }, children: runs(i) })));
    else kids.push(new Paragraph({ spacing: { after: 160 }, children: runs(b.text) }));
  }
  if (doc.library.length) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Sources")] }));
    doc.library.forEach((a, i) => {
      const who = [a.authors, a.year].filter(Boolean).join(", ");
      kids.push(new Paragraph({
        spacing: { after: a.note ? 40 : 120 },
        children: [new TextRun(`${i + 1}. `), a.url ? link(a.title, a.url) : new TextRun(a.title), ...(who ? [new TextRun(` (${who})`)] : [])],
      }));
      if (a.note) kids.push(new Paragraph({ spacing: { after: 120 }, indent: { left: 360 }, children: [new TextRun(a.note)] }));
    });
  }
  if (doc.outside.length) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Outside the library (unvetted)")] }));
    kids.push(new Paragraph({ children: [new TextRun({ text: "Found on the websites of vetted sources, but not reviewed or added to the library.", italics: true })] }));
    doc.outside.forEach((w) => kids.push(new Paragraph({ bullet: { level: 0 }, children: [link(w.title || w.url, w.url), new TextRun(` (${w.site})`)] })));
  }

  const file = new Document({
    creator: "The Seed",
    title: doc.title || doc.question || "The Seed",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: kids }],
  });
  return { blob: await Packer.toBlob(file), name: `${fileBase(doc)}.docx` };
}
