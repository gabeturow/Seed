"use client";
import DictateButton from "./DictateButton";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { askFollowUp, askLibrary } from "@/app/ask/actions";
import { reshapeDoc } from "@/app/ask/doc-actions";
import { deleteThread, saveThread } from "@/app/ask/threads";
import { DocActions, DocBody } from "@/components/AnswerDoc";
import { withFollowUps } from "@/lib/doc";

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
function Answer({ r, id, saved = null, onDelete }) {
  const base = { kind: "answer", title: r.question, question: r.question, body: r.answer, library: r.library, outside: r.outside };
  const [docs, setDocs] = useState({ answer: base });
  const [view, setView] = useState("answer");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const card = useRef(null);
  const doc = docs[view];
  const [turns, setTurns] = useState(saved ? saved.turns.slice(1) : []);   // follow-up questions and answers
  const [threadId, setThreadId] = useState(saved ? saved.id : null);
  const [saveNote, setSaveNote] = useState("");
  const saving = useRef(false);

  // Saves the conversation to the person's account: once when a new answer appears, again after each follow-up.
  async function persist(all) {
    const res = await saveThread(threadId, all);
    if (res?.id) { setThreadId(res.id); setSaveNote(""); }
    else if (res?.error) setSaveNote(res.error);
    return res;
  }
  useEffect(() => {
    if (saved || saving.current) return;
    saving.current = true;
    persist([r]);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [fLen, setFLen] = useState("paragraph");
  const [fError, setFError] = useState("");
  const [fPending, fStart] = useTransition();
  const fbox = useRef(null);

  function followUp(e) {
    e.preventDefault();
    const q = fbox.current.value.trim();
    if (!q || fPending) return;
    setFError("");
    fStart(async () => {
      const prior = [r, ...turns].map((t) => ({ question: t.question, answer: t.answer, outside: t.outside }));
      const res = await askFollowUp(q, fLen, prior);
      if (res?.error) return setFError(res.error);
      setTurns((t) => [...t, res]);
      fbox.current.value = "";
      await persist([r, ...turns, res]);
    });
  }

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
      <DocActions doc={withFollowUps(doc, turns)} printRef={card} />

      {turns.map((t, i) => (
        <section key={i} className="followup">
          <p className="asked">{t.question}</p>
          <DocBody doc={{ kind: "answer", title: t.question, question: t.question, body: t.answer, library: t.library, outside: t.outside }} scope={`${id}-f${i}-`} />
        </section>
      ))}
      {saveNote && <p className="notice error no-print" role="alert">{saveNote}</p>}
      {threadId && onDelete && <p className="no-print"><button type="button" className="link-button" onClick={() => onDelete(threadId)}>Delete this conversation</button></p>}
      {turns.length < 5 ? (
        <form className="followup-form no-print" onSubmit={followUp}>
          <label>
            Ask a follow-up
            <textarea ref={fbox} rows={2} maxLength={2000} placeholder="Probe further, or ask about one of the sources above…"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
          </label>
          <div className="followup-row">
            <DictateButton target={fbox} />
            <select value={fLen} onChange={(e) => setFLen(e.target.value)} aria-label="Length of the follow-up answer">
              <option value="paragraph">1 paragraph</option>
              <option value="page">1 page</option>
              <option value="five">5 pages</option>
            </select>
            <button className="button" disabled={fPending}>{fPending ? "Researching…" : "Ask"}</button>
          </div>
          {fError && <p className="notice error" role="alert">{fError}</p>}
        </form>
      ) : <p className="muted small no-print">That&apos;s five follow-ups. Ask a new question above to keep going.</p>}
    </article>
  );
}

const LENGTHS = [
  { key: "paragraph", label: "1 paragraph" },
  { key: "page", label: "1 page" },
  { key: "five", label: "5 pages" },
];

export default function AskForm({ saved = [] }) {
  const [state, action, pending] = useActionState(askLibrary, null);
  const [history, setHistory] = useState([]);
  const [earlier, setEarlier] = useState(saved);
  async function remove(id) {
    if (!window.confirm("Delete this saved conversation?")) return;
    const res = await deleteThread(id);
    if (res?.ok) setEarlier((e) => e.filter((t) => t.id !== id));
  }
  const box = useRef(null);
  const [len, setLen] = useState(1);

  useEffect(() => {
    if (state?.answer) setHistory((h) => [state, ...h]);
  }, [state]);

  return (
    <>
      <form action={action} className="card ask-form">
        <div className="ask-top">
        <label className="ask-question">
          Your question
          <textarea ref={box} name="question" rows={3} required maxLength={2000}
            placeholder="For example: what menu language makes plant-based dishes more appealing?"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form.requestSubmit(); }} />
          <DictateButton target={box} />
        </label>
        <div className="length-slider">
          <label htmlFor="length-range">Length of the answer: <strong>{LENGTHS[len].label}</strong></label>
          <input id="length-range" type="range" min={0} max={2} step={1} value={len}
            onChange={(e) => setLen(Number(e.target.value))} aria-valuetext={LENGTHS[len].label} list="length-ticks" />
          <datalist id="length-ticks">{LENGTHS.map((l, i) => <option key={l.key} value={i} label={l.label} />)}</datalist>
          <div className="length-labels" aria-hidden="true">{LENGTHS.map((l) => <span key={l.key}>{l.label}</span>)}</div>
          <input type="hidden" name="length" value={LENGTHS[len].key} />
        </div>
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
      {earlier.length > 0 && (
        <section className="earlier">
          <h2>Your earlier questions</h2>
          <p className="muted small">Saved to your account. Only you can see them.</p>
          {earlier.map((t) => (
            <details key={t.id} className="earlier-item">
              <summary>{t.turns[0].question}{t.turns.length > 1 ? ` (+${t.turns.length - 1} follow-up${t.turns.length > 2 ? "s" : ""})` : ""}</summary>
              <Answer r={t.turns[0]} id={1000 + t.id} saved={t} onDelete={remove} />
            </details>
          ))}
        </section>
      )}
    </>
  );
}
