"use client";
import { Fragment, useRef, useState, useTransition } from "react";
import { blocksOf, docToHtml, docToText, libraryNumbers, safeUrl, tokensOf } from "@/lib/doc";
import { shareDoc } from "@/app/ask/doc-actions";

// One line of text with **bold** and numbered citation chips.
function Inline({ text, doc, scope }) {
  const num = libraryNumbers(doc);
  const lib = Object.fromEntries(doc.library.map((a) => [a.id, a]));
  const web = Object.fromEntries(doc.outside.map((w) => [w.n, w]));
  return tokensOf(text).map((t, i) => {
    if (t.t === "bold") return <strong key={i}>{t.text}</strong>;
    if (t.t === "cite" && t.kind === "A" && num[t.key]) {
      return <a key={i} className="cite" href={`#lib-${scope}${t.key}`} title={lib[t.key].title}>{num[t.key]}</a>;
    }
    if (t.t === "cite" && t.kind === "W" && web[t.key]) {
      return <a key={i} className="cite outside" href={web[t.key].url} target="_blank" rel="noreferrer" title={web[t.key].title}>{web[t.key].site}</a>;
    }
    if (t.t === "cite") return null;
    return <Fragment key={i}>{t.text}</Fragment>;
  });
}

// The text of a doc plus its list of sources.
export function DocBody({ doc, scope = "" }) {
  return (
    <>
      {doc.title && doc.kind !== "answer" && <h2 className="doc-title">{doc.title}</h2>}
      {blocksOf(doc.body).map((b, i) => {
        if (b.type === "h") return <h3 key={i} className="doc-h">{b.text}</h3>;
        if (b.type === "ul") return <ul key={i}>{b.items.map((l, j) => <li key={j}><Inline text={l} doc={doc} scope={scope} /></li>)}</ul>;
        return <p key={i}><Inline text={b.text} doc={doc} scope={scope} /></p>;
      })}

      {doc.library.length > 0 && (
        <div className="sources-used">
          <h2>{doc.kind === "bibliography" ? "Sources" : "From the library"}</h2>
          <ol className="cited">
            {doc.library.map((a) => (
              <li key={a.id} id={`lib-${scope}${a.id}`}>
                {a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}
                <span className="muted small">{[a.authors, a.year].filter(Boolean).join(", ")}{a.readFull ? " · full text read" : ""}</span>
                {a.note && <span className="note">{a.note}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {doc.outside.some((w) => w.broad) && (
        <div className="sources-used unvetted broad">
          <h2>From the broader web <span className="flag warn">Not vetted</span></h2>
          <p><strong>These sources are not from the library or its vetted sources, and Bite hasn&apos;t reviewed them.</strong> Check them before relying on them.</p>
          <ol className="cited">
            {doc.outside.filter((w) => w.broad).map((w) => (
              <li key={w.n}>
                <a href={safeUrl(w.url) ?? "#"} target="_blank" rel="noreferrer">{w.title}</a>
                <span className="muted small">{w.site}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {doc.outside.some((w) => !w.broad) && (
        <div className="sources-used unvetted">
          <h2>From outside the library <span className="flag warn">Unvetted</span></h2>
          <p className="muted small">Found on the websites of vetted sources, but not reviewed or added to the library.</p>
          <ol className="cited">
            {doc.outside.filter((w) => !w.broad).map((w) => (
              <li key={w.n}>
                <a href={safeUrl(w.url) ?? "#"} target="_blank" rel="noreferrer">{w.title}</a>
                <span className="muted small">{w.site}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyRich(doc) {
  const html = docToHtml(doc), text = docToText(doc);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

// Copy, Word, PDF, and Share link for whatever doc is showing.
export function DocActions({ doc, canShare = true, printRef }) {
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef(null);
  const say = (m) => { setNote(m); clearTimeout(timer.current); timer.current = setTimeout(() => setNote(""), 4000); };

  const copy = async () => { try { await copyRich(doc); say("Copied, with links."); } catch { say("Couldn't copy. Select the text and copy it instead."); } };

  const word = async () => {
    say("Making the Word file…");
    try {
      const { makeWord } = await import("@/lib/doc-word");
      const { blob, name } = await makeWord(doc);
      download(blob, name);
      say("Downloaded.");
    } catch (err) { console.error(err); say("Couldn't make the Word file."); }
  };

  // Prints just this answer; in the print window, choose "Save as PDF".
  const pdf = () => {
    const el = printRef?.current;
    if (!el) return window.print();
    el.classList.add("print-this");
    document.body.classList.add("printing-one");
    const done = () => { el.classList.remove("print-this"); document.body.classList.remove("printing-one"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };

  const share = () => start(async () => {
    const r = await shareDoc(doc);
    if (r.error) return say(r.error);
    const url = `${location.origin}${r.path}`;
    setLink(url);
    try { await navigator.clipboard.writeText(url); say("Link copied. Only approved Seed members can open it."); } catch { say("Link ready below."); }
  });

  return (
    <div className="doc-actions no-print">
      <button type="button" className="button secondary small" onClick={copy}>Copy</button>
      <button type="button" className="button secondary small" onClick={word}>Word</button>
      <button type="button" className="button secondary small" onClick={pdf}>PDF</button>
      {canShare && <button type="button" className="button secondary small" onClick={share} disabled={pending}>{pending ? "Making link…" : "Share link"}</button>}
      {note && <span className="muted small" role="status">{note}</span>}
      {link && <input className="share-link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />}
    </div>
  );
}
