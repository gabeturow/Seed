"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { askLibrary } from "@/app/ask/actions";
import { reshapeDoc } from "@/app/ask/doc-actions";
import { DocActions, DocBody } from "@/components/AnswerDoc";

const EXAMPLES = [
  "What's the evidence that taste-focused menu names increase vegetable choices?",
  "Should we label dishes as \"vegan\" or \"plant-based\" on menus?",
  "How do default options change what people order?",
];

const VIEWS = [
  { kind: "answer", label: "Answer" },
  { kind: "page", label: "1-page annotated" },
  { kind: "memo", label: "Memo" },
  { kind: "bibliography", label: "Bibliography" },
];

// One answer, with ways to see it (answer, annotated page, memo, bibliography) and to copy, download, or share it.
function Answer({ r, id }) {
  const base = { kind: "answer", title: r.question, question: r.question, body: r.answer, library: r.library, outside: r.outside };
  const [docs, setDocs] = useState({ answer: base });
  const [view, setView] = useState("answer");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const card = useRef(null);
  const doc = docs[view];

  const show = (kind) => {
    setError("");
    if (docs[kind]) return setView(kind);
    start(async () => {
      const res = await reshapeDoc(base, kind);
      if (res.error) return setError(res.error);
      setDocs((d) => ({ ...d, [kind]: res.doc }));
      setView(kind);
    });
  };

  return (
    <article className="card answer" ref={card}>
      <p className="asked">{r.question}</p>
      <div className="views no-print" role="tablist" aria-label="Ways to see this answer">
        {VIEWS.map((v) => (
          <button key={v.kind} type="button" role="tab" aria-selected={view === v.kind}
            className={`view-tab${view === v.kind ? " on" : ""}`} onClick={() => show(v.kind)} disabled={pending}>
            {v.label}
          </button>
        ))}
        {pending && <span className="muted small">Writing it up…</span>}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <DocBody doc={doc} scope={`${id}-`} />
      <DocActions doc={doc} printRef={card} />
    </article>
  );
}

const LENGTHS = [
  { key: "paragraph", label: "1 paragraph" },
  { key: "page", label: "1 page" },
  { key: "five", label: "5 pages" },
];

export default function AskForm() {
  const [state, action, pending] = useActionState(askLibrary, null);
  const [history, setHistory] = useState([]);
  const box = useRef(null);
  const [len, setLen] = useState(1);

  useEffect(() => {
    if (state?.answer) setHistory((h) => [state, ...h]);
  }, [state]);

  return (
    <>
      <form action={action} className="card ask-form">
        <label>
          Your question
          <textarea ref={box} name="question" rows={3} required maxLength={2000}
            placeholder="For example: what menu language makes plant-based dishes more appealing?"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form.requestSubmit(); }} />
        </label>
        <div className="length-slider">
          <label htmlFor="length-range">Length of the answer: <strong>{LENGTHS[len].label}</strong></label>
          <input id="length-range" type="range" min={0} max={2} step={1} value={len}
            onChange={(e) => setLen(Number(e.target.value))} aria-valuetext={LENGTHS[len].label} list="length-ticks" />
          <datalist id="length-ticks">{LENGTHS.map((l, i) => <option key={l.key} value={i} label={l.label} />)}</datalist>
          <div className="length-labels" aria-hidden="true">{LENGTHS.map((l) => <span key={l.key}>{l.label}</span>)}</div>
          <input type="hidden" name="length" value={LENGTHS[len].key} />
        </div>
        <div className="ask-row">
          <button className="button" disabled={pending}>{pending ? "Researching…" : "Ask"}</button>
          {pending && <span className="muted small">Reading the library. {len === 2 ? "A five-page answer can take a few minutes." : "This can take a minute or two."}</span>}
        </div>
        {!history.length && !pending && (
          <div className="examples">
            <span className="muted small">Try:</span>
            {EXAMPLES.map((q) => (
              <button type="button" key={q} className="tag example" onClick={() => { box.current.value = q; box.current.focus(); }}>{q}</button>
            ))}
          </div>
        )}
        {state?.error && <p className="notice error" role="alert">{state.error}</p>}
      </form>
      {history.map((r, i) => <Answer key={history.length - i} id={history.length - i} r={r} />)}
    </>
  );
}
