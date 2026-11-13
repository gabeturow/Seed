"use client";
import { useRef, useState } from "react";
import { browserClient } from "@/lib/supabase-browser";
import { attachPdf } from "@/app/admin/attach/actions";

// Pick a folder of PDFs: each one is matched to the library article it belongs to and linked to it.
export default function AttachPdfs() {
  const ref = useRef(null);
  const [busy, setBusy] = useState("");
  const [rows, setRows] = useState([]);

  async function run(files) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) && f.size <= 50 * 1024 * 1024);
    if (!pdfs.length) return;
    setRows([]); const client = browserClient(); let i = 0, n = 0;
    setBusy(`Matching 0 of ${pdfs.length}…`);
    await Promise.all(Array.from({ length: Math.min(3, pdfs.length) }, async () => {
      while (i < pdfs.length) {
        const f = pdfs[i++]; const path = `${crypto.randomUUID()}.pdf`;
        const { error } = await client.storage.from("article-pdfs").upload(path, f, { contentType: "application/pdf" });
        const r = error ? { status: "failed", name: f.name, reason: error.message } : await attachPdf({ path, name: f.name });
        setRows((x) => [...x, { name: f.name, ...r }]);
        setBusy(`Matching ${++n} of ${pdfs.length}…`);
      }
    }));
    setBusy("");
  }

  const ok = rows.filter((r) => r.status === "attached");
  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="button" disabled={!!busy} onClick={() => ref.current?.click()}>Choose a folder…</button>
        <input ref={ref} type="file" multiple hidden {...{ webkitdirectory: "" }} onChange={(e) => { run(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {busy && <span className="muted">{busy} Keep this page open.</span>}
      </div>
      {rows.length > 0 && <p><strong>{ok.length} linked</strong>, {rows.length - ok.length} not matched.</p>}
      <ul className="stack">
        {rows.map((r, k) => (
          <li key={k}>{r.status === "attached"
            ? <>✓ {r.name} → <a href={`/admin/articles/${r.id}`}>{r.title}</a>{r.textAdded ? " (text added)" : ""}</>
            : <span className="muted">– {r.name}: {r.reason}</span>}</li>
        ))}
      </ul>
    </div>
  );
}
