"use server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { withMsg } from "@/lib/forms";
import { SCOUT_THEMES, themeCounts, importDrive, attachPdfs, fetchTexts, redraftBatch, uploadPdfs, addPdfs, cleanPdfs, unmatchedPdfs, normText, safe } from "@/lib/ai-core";

const BACK = "/admin/ai";
const finish = (r) => redirect(withMsg(r.to ?? BACK, r.text, r.ok ? "msg" : "error"));

export async function loadFullText() {
  const { supabase } = await requireAdmin();
  let files;
  try {
    files = JSON.parse(await readFile(path.join(process.cwd(), "database", "full-text.json"), "utf8"));
  } catch {
    redirect(withMsg(BACK, "Couldn't find database/full-text.json.", "error"));
  }
  let loaded = 0;
  for (const f of files) {
    const { data, error } = await supabase.from("articles").update({ full_text: f.text })
      .like("url", `%${f.drive_id}%`).select("id");
    if (error) {
      const hint = /full_text/.test(error.message) ? " Run database/update-ai-features.sql in Supabase first." : "";
      redirect(withMsg(BACK, `Couldn't save the text: ${error.message}.${hint}`, "error"));
    }
    loaded += data?.length ?? 0;
  }
  revalidatePath(BACK);
  redirect(withMsg(BACK, `Loaded the full text of ${loaded} articles.`));
}

// One-time clean-up: writes three summaries of each article from its full text: the short card summary, a one-page
// summary, and a five-page summary (behind the "Go deeper" button). AI-drafted short summaries are replaced (the old
// one is kept in the admin notes and the article is flagged for review); human-written short summaries are left alone.


// What is waiting to be done, for the Update button. Cheap counts only (no article text is loaded).
export async function libraryStatus() {
  const { supabase } = await requireAdmin();
  const readJson = async (f) => { try { return JSON.parse(await readFile(path.join(process.cwd(), "database", f), "utf8")); } catch { return null; } };
  const [drive, pdfs] = await Promise.all([readJson("drive-import.json"), readJson("pdf-text.json")]);
  const count = (q) => q.then((r) => r.count ?? 0, () => 0);
  const [{ data: arts }, total, noText, noSummaries, pending] = await Promise.all([
    supabase.from("articles").select("url, title, admin_notes"),
    count(supabase.from("articles").select("id", { count: "exact", head: true })),
    supabase.from("articles").select("id, title").is("full_text", null).order("id").then((r) => r.data ?? [], () => []),
    count(supabase.from("articles").select("id", { count: "exact", head: true }).not("full_text", "is", null).is("summary_page", null)),
    count(supabase.from("articles").select("id", { count: "exact", head: true }).eq("status", "pending")),
  ]);
  const urls = (arts ?? []).map((a) => a.url ?? "");
  // A stored PDF replaces the Drive link, so also match by title (as the import itself does).
  const titles = new Set((arts ?? []).map((a) => normText(a.title)).filter(Boolean));
  return {
    total, noSummaries, pending,
    noText: noText.length, noTextArticles: noText,
    newDrive: (drive ?? []).filter((it) => !urls.some((u) => u.includes(it.drive_id)) && !titles.has(normText(it.title))).length,
    newPdfs: pdfs ? unmatchedPdfs(pdfs, arts ?? []).length : null,   // null = no saved text file yet
    pdfFiles: pdfs?.length ?? 0,
  };
}

// Add the PDFs in database/pdf-text.json that match no article in the library to the review queue (a few per
// click). The title, authors, year and short summary are drafted by AI from the PDF's text. The PDF is uploaded to

// The single-step buttons.
export async function redraftSummaries() {
  const { supabase } = await requireAdmin();
  finish(await safe(() => redraftBatch(supabase)));
}
export async function fetchMissingText() {
  const { supabase } = await requireAdmin();
  finish(await safe(() => fetchTexts(supabase)));
}
export async function attachPdfText() {
  const { supabase } = await requireAdmin();
  finish(await safe(() => attachPdfs(supabase)));
}
export async function addPdfArticles() {
  const { supabase } = await requireAdmin();
  const r = await safe(() => addPdfs(supabase));
  finish(r.ok && r.left ? { ...r, to: BACK } : { ...r, to: r.ok ? "/admin/review" : BACK });
}
export async function scoutThemeInfo() {
  const { supabase } = await requireAdmin();
  const counts = await themeCounts(supabase);
  return SCOUT_THEMES.map((t, i) => ({ key: t.key, name: t.name, count: counts[i], thinnest: counts[i] === Math.min(...counts) }));
}
export async function removeUnusedPdfs() {
  const { supabase } = await requireAdmin();
  finish({ ...(await safe(() => cleanPdfs(supabase))), to: BACK });
}
export async function uploadArticlePdfs() {
  const { supabase } = await requireAdmin();
  const r = await safe(() => uploadPdfs(supabase));
  finish({ ...r, to: BACK });
}
export async function importDriveArticles() {
  const { supabase } = await requireAdmin();
  finish(await safe(() => importDrive(supabase)));
}
