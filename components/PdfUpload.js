"use client";
import { useState } from "react";
import { browserClient } from "@/lib/supabase-browser";

// Picks a PDF and sends it straight to the site's storage; the form then saves its path with the article.
export default function PdfUpload({ current }) {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function pick(e) {
    const file = e.target.files?.[0];
    setPath(""); setStatus("");
    if (!file) return;
    if (file.type !== "application/pdf") { setStatus("That isn't a PDF."); return; }
    if (file.size > 50 * 1024 * 1024) { setStatus("That PDF is over 50 MB."); return; }
    setBusy(true);
    const name = `${crypto.randomUUID()}.pdf`;
    const { error } = await browserClient().storage.from("article-pdfs").upload(name, file, { contentType: "application/pdf" });
    setBusy(false);
    if (error) setStatus(`Couldn't upload it: ${error.message}`);
    else { setPath(name); setStatus(`Uploaded ${file.name}. It is saved with the article when you save.`); }
  }

  return (
    <label className="span-2">Upload the PDF <span className="hint">(optional; it becomes the article&apos;s link)</span>
      <input type="file" accept="application/pdf" onChange={pick} disabled={busy} />
      <input type="hidden" name="pdf_path" value={path} />
      {current && !path && <span className="hint">This article already has a stored PDF. Choosing a file replaces it.</span>}
      {status && <span className="hint" role="status">{status}</span>}
    </label>
  );
}
