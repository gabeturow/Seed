import { Fragment } from "react";

// **bold**, "- " bullets, and "## " headings: the light formatting the assistant writes. Nothing fancier.
// Plain text with web addresses turned into links.
function Linked({ text }) {
  return text.split(/(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g).map((p, i) =>
    /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : <Fragment key={i}>{p}</Fragment>);
}

function Bold({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}><Linked text={p.slice(2, -2)} /></strong> : <Linked key={i} text={p} />);
}

export default function RichText({ text }) {
  return String(text ?? "").replace(/\r/g, "").replace(/^(#{1,3} .+)$/gm, "\n$1\n").split(/\n{2,}/).filter((b) => b.trim()).map((block, i) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 1 && /^#{1,3} /.test(lines[0])) return <h3 key={i} className="deep-h">{lines[0].replace(/^#{1,3} /, "")}</h3>;
    if (lines.every((l) => /^[-•]\s+/.test(l))) {
      return <ul key={i}>{lines.map((l, j) => <li key={j}><Bold text={l.replace(/^[-•]\s+/, "")} /></li>)}</ul>;
    }
    return <p key={i}><Bold text={lines.join(" ")} /></p>;
  });
}
