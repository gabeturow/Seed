"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { pdfBufferText } from "@/lib/fulltext";
import { bestMatch } from "@/lib/attach-match";

// A PDF was uploaded to storage by the browser. Find the article it belongs to and attach it (and its text if missing).
export async function attachPdf({ path, name }) {
  const { supabase } = await requireAdmin();
  if (!/^[\w-]+\.pdf$/i.test(String(path))) return { status: "skipped", reason: "bad path" };
  const drop = async () => { try { await supabase.storage.from("article-pdfs").remove([path]); } catch {} };
  try {
    const { data: blob } = await supabase.storage.from("article-pdfs").download(path);
    if (!blob) return { status: "unmatched", name, reason: "couldn't read the upload" };
    const text = await pdfBufferText(Buffer.from(await blob.arrayBuffer()));
    const { data: arts } = await supabase.from("articles").select("id, title, url, full_text, admin_notes").is("pdf_path", null).neq("status", "rejected");
    const m = bestMatch(`${String(name ?? "").replace(/\.pdf$/i, "")} ${(text ?? "").slice(0, 6000)}`, arts ?? []);
    if (!m) { await drop(); return { status: "unmatched", name, reason: text ? "no article matched, or it already has a PDF" : "scanned PDF with no readable text" }; }
    const a = arts.find((x) => x.id === m.article.id);
    const fix = { pdf_path: path, url: `/library/${a.id}/pdf` };
    if (a.url && !a.url.startsWith("/library/")) fix.admin_notes = [a.admin_notes, `Original link: ${a.url}`].filter(Boolean).join("\n");
    const gotText = !!text && (!a.full_text || a.full_text.length < 800);
    if (gotText) fix.full_text = text;
    const { error } = await supabase.from("articles").update(fix).eq("id", a.id);
    if (error) { await drop(); return { status: "failed", name, reason: error.message }; }
    revalidatePath("/", "layout");
    return { status: "attached", name, id: a.id, title: a.title, textAdded: gotText };
  } catch (e) { await drop(); return { status: "failed", name, reason: String(e?.message ?? e).slice(0, 160) }; }
}
