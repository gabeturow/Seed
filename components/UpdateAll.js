"use client";
import { useState, useTransition } from "react";
import { startUpdateRun } from "@/app/admin/ai/bg";

// One button that brings the whole library up to date. It runs in the background (progress shows in the panel at the
// bottom right of every admin page), and each step does only what is still waiting, so running it again is safe and cheap.
export default function UpdateAll({ disabled, todo = [], upToDate }) {
  const [withAi, setWithAi] = useState(true);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function go() {
    setMsg(""); setErr("");
    start(async () => {
      const res = await startUpdateRun({ withAi });
      if (res?.error) return setErr(res.error);
      setMsg("Started. It runs in the background, so you can leave this page. Progress is in the panel at the bottom right.");
      window.dispatchEvent(new Event("ingest-queued"));
    });
  }

  return (
    <div className="update-all">
      {todo.length > 0 ? (
        <ul>{todo.map((t, i) => <li key={i}>{t}</li>)}</ul>
      ) : upToDate ? <p className="notice ok">Everything is up to date.</p> : null}
      <label className="check inline">
        <input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)} disabled={pending} />
        {" "}Include the steps that use Anthropic credit (drafting new PDFs and writing summaries)
      </label>
      <p>
        <button type="button" className="button" onClick={go} disabled={disabled || pending}>
          {pending ? "Starting…" : todo.length ? "Update the library" : "Check and update the library"}
        </button>
      </p>
      {msg && <p className="notice ok" role="status">{msg}</p>}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}
