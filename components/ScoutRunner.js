"use client";
import { useState, useTransition } from "react";
import { startScoutRun } from "@/app/admin/ai/bg";

// "Run the scout": starts it in the background. Progress shows in the panel at the bottom right of every admin page.
export default function ScoutRunner({ themes, defaultTheme, disabled }) {
  const [theme, setTheme] = useState(defaultTheme ?? "all");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  function go() {
    setMsg(""); setErr("");
    start(async () => {
      const res = await startScoutRun({ theme });
      if (res?.error) return setErr(res.error);
      setMsg("Started. It runs in the background, so you can leave this page. Progress is in the panel at the bottom right, and finds go to Review.");
      window.dispatchEvent(new Event("ingest-queued"));
    });
  }
  return (
    <div className="stack">
      <p>
        <label>Theme{" "}
          <select value={theme} onChange={(e) => setTheme(e.target.value)} disabled={pending}>
            {themes.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.count} articles){t.thinnest ? " — fewest" : ""}</option>)}
            <option value="all">All themes at once (broad)</option>
          </select>
        </label>
      </p>
      <p><button type="button" className="button secondary" onClick={go} disabled={disabled || pending}>{pending ? "Starting…" : "Run the scout"}</button></p>
      {msg && <p className="notice ok" role="status">{msg}</p>}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}
