"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { citedStep } from "@/app/admin/ai/cited";

// Reads the reference lists of the library's articles, then looks up the most-cited works that aren't in the library.
export default function CitationFinder({ disabled, ready, unscanned, twoPlus, onePlus }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState("");
  const [log, setLog] = useState([]);
  const [howMany, setHowMany] = useState(6);
  const [minCites, setMinCites] = useState(2);
  const [finished, setFinished] = useState(null);

  async function run() {
    setRunning(true); setFinished(null); setLog([]);
    const add = (label, r) => setLog((l) => [...l, { label, ok: r.ok !== false, text: r.text }]);
    const call = async (step, state) => {
      try { return await citedStep(step, state); }
      catch (err) { return { ok: false, fatal: true, text: `The request failed (${err?.message ?? "no connection"}). Click again to continue.` }; }
    };
    let stopped = false;
    for (let i = 0; i < 60 && !stopped; i++) {
      setNow("Reading reference lists…");
      const r = await call("scan", {});
      add("Reading reference lists", r);
      if (r.fatal) stopped = true;
      if (!r.left || r.ok === false) break;
    }
    let found = 0;
    for (let i = 0; i < Math.ceil(howMany / 3) && !stopped; i++) {
      setNow(`Looking up cited works (round ${i + 1})…`);
      const r = await call("find", { minCites });
      add("Looking up the most-cited works", r);
      if (r.fatal) stopped = true;
      found += 1;
      if (!r.left || r.ok === false) break;
    }
    setNow(""); setFinished(stopped ? "stopped" : "done"); setRunning(false); router.refresh();
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
          <select value={howMany} onChange={(e) => setHowMany(Number(e.target.value))} disabled={running}>
            <option value={3}>3</option><option value={6}>6</option><option value={12}>12</option><option value={24}>24</option>
          </select>{" "}cited works, cited by at least{" "}
          <select value={minCites} onChange={(e) => setMinCites(Number(e.target.value))} disabled={running}>
            <option value={3}>3</option><option value={2}>2</option><option value={1}>1</option>
          </select>{" "}of your articles
        </label>
      </p>
      <p><button type="button" className="button secondary" onClick={run} disabled={disabled || running}>{running ? "Working…" : "Find cited papers"}</button></p>
      {running && <p className="muted small" role="status">{now} Keep this page open.</p>}
      {log.length > 0 && <ol className="update-log">{log.map((e, i) => <li key={i} className={e.ok ? "" : "bad"}><strong>{e.label}.</strong> {e.text}</li>)}</ol>}
      {finished === "done" && <p className="notice ok">Finished. New finds are in <Link href="/admin/review">Review</Link>.</p>}
      {finished === "stopped" && <p className="notice error" role="alert">Stopped early; see the last line above.</p>}
    </div>
  );
}
