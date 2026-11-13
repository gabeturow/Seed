"use client";
import { useState, useTransition } from "react";
import { startCitationRun } from "@/app/admin/ai/cited";

// Reads the reference lists of the library's articles, then looks up the most-cited works that aren't in the library.
// It runs in the background; progress shows in the panel at the bottom right of every admin page.
export default function CitationFinder({ disabled, ready, unscanned, twoPlus, onePlus }) {
  const [howMany, setHowMany] = useState(6);
  const [minCites, setMinCites] = useState(2);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function go() {
    setMsg(""); setErr("");
    start(async () => {
      const res = await startCitationRun({ howMany, minCites });
      if (res?.error) return setErr(res.error);
      setMsg("Started. It runs in the background, so you can leave this page. Progress is in the panel at the bottom right, and finds go to Review.");
      window.dispatchEvent(new Event("ingest-queued"));
    });
  }

  if (!ready) return <p className="notice">First run <code>database/update-cited-works.sql</code> in the Supabase SQL Editor.</p>;
  return (
    <div className="update-all">
      <p className="muted">
        {unscanned > 0 ? `${unscanned} article${unscanned === 1 ? "" : "s"} still to read for their reference lists. ` : "All reference lists have been read. "}
        {twoPlus} work{twoPlus === 1 ? " is" : "s are"} cited by two or more of your articles and not in the library yet{onePlus > twoPlus ? ` (${onePlus} cited by at least one)` : ""}.
      </p>
      <p>
        <label>Look up about{" "}
          <select value={howMany} onChange={(e) => setHowMany(Number(e.target.value))} disabled={pending}>
            <option value={4}>4</option><option value={8}>8</option><option value={12}>12</option><option value={24}>24</option>
          </select>{" "}cited works, cited by at least{" "}
          <select value={minCites} onChange={(e) => setMinCites(Number(e.target.value))} disabled={pending}>
            <option value={3}>3</option><option value={2}>2</option><option value={1}>1</option>
          </select>{" "}of your articles
        </label>
      </p>
      <p><button type="button" className="button secondary" onClick={go} disabled={disabled || pending}>{pending ? "Starting…" : "Find cited papers"}</button></p>
      {msg && <p className="notice ok" role="status">{msg}</p>}
      {err && <p className="notice error" role="alert">{err}</p>}
    </div>
  );
}
