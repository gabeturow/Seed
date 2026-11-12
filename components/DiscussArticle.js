"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import DictateButton from "./DictateButton";
import RichText from "./RichText";
import { clearArticleChat, discussArticle } from "@/app/library/[id]/actions";

const STARTERS = [
  "What did they actually find?",
  "How was the study done, and who was in it?",
  "What are the limitations?",
  "How could a foodservice team use this?",
];

export default function DiscussArticle({ articleId, hasText, saved = [] }) {
  const [messages, setMessages] = useState(saved);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const end = useRef(null);
  const box = useRef(null);

  useEffect(() => { if (messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, pending]);

  function send(question) {
    const q = question.trim();
    if (!q || pending) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next); setDraft(""); setError("");
    start(async () => {
      const res = await discussArticle(articleId, next);
      if (res?.reply) setMessages([...next, { role: "assistant", content: res.reply }]);
      else { setMessages(messages); setDraft(q); setError(res?.error ?? "Something went wrong. Try again."); }
    });
  }

  function clear() {
    start(async () => {
      const res = await clearArticleChat(articleId);
      if (res?.ok) { setMessages([]); setError(""); } else setError(res?.error ?? "Couldn't clear the conversation.");
    });
  }

  return (
    <div className="discuss-box">
      {messages.length > 0 && (
        <p className="muted small">Saved to your account. <button type="button" className="link-button" onClick={clear} disabled={pending}>Clear this conversation</button></p>
      )}
      {messages.length === 0 && (
        <div className="starters">
          {STARTERS.map((s) => <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={pending}>{s}</button>)}
        </div>
      )}
      <div className="thread" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role === "user" ? "You" : "Assistant"}</span>
            {m.role === "user" ? <p>{m.content}</p> : <RichText text={m.content} />}
          </div>
        ))}
        {pending && <div className="msg assistant"><span className="who">Assistant</span><p className="muted">Reading{hasText ? " the article" : ""}…</p></div>}
        <div ref={end} />
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); send(draft); }} className="discuss-form">
        <textarea ref={box} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={2000}
          placeholder={messages.length ? "Ask a follow-up…" : "Ask anything about this article…"}
          aria-label="Your question"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
        <div className="discuss-actions">
          <DictateButton target={box} />
          <button className="button" disabled={pending || !draft.trim()}>{pending ? "Thinking…" : "Send"}</button>
        </div>
      </form>
    </div>
  );
}
