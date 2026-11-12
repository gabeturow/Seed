"use client";
import { useEffect, useRef, useState } from "react";

// A "Dictate" button for a text box. Uses the browser's built-in speech recognition (Chrome, Edge, Safari),
// so no audio goes through The Seed; the browser's speech service handles it. Hidden where unsupported.
// `target` is a ref to the textarea. Spoken text is added at the end and the box is told it changed.
export default function DictateButton({ target }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState("");
  const rec = useRef(null);

  useEffect(() => {
    setSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    return () => rec.current?.abort();
  }, []);

  function insert(spoken) {
    const el = target.current;
    if (!el) return;
    const base = el.value.replace(/\s+$/, "");
    const next = (base ? base + " " : "") + spoken.trim();
    // Go through the native setter so React sees the change in controlled and uncontrolled boxes alike.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, next.slice(0, el.maxLength > 0 ? el.maxLength : undefined));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }

  function toggle() {
    if (listening) { rec.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) insert(e.results[i][0].transcript);
    };
    r.onerror = (e) => setProblem(
      e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access is blocked. Allow it in your browser's site settings."
      : e.error === "no-speech" ? "" : "Dictation stopped. Try again.");
    r.onend = () => setListening(false);
    setProblem("");
    rec.current = r;
    try { r.start(); setListening(true); } catch { setProblem("Dictation couldn't start. Try again."); }
  }

  if (!supported) return null;
  return (
    <span className="dictate">
      <button type="button" className={`link-button dictate-btn${listening ? " on" : ""}`} onClick={toggle} aria-pressed={listening}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
        </svg>
        {listening ? "Stop dictating" : "Dictate"}
      </button>
      {problem && <span className="small" role="alert"> {problem}</span>}
    </span>
  );
}
