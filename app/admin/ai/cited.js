"use server";
import { requireAdmin } from "@/lib/auth";
import { hasClaudeKey } from "@/lib/claude";
import { norm } from "@/lib/cited-core";

const TOP = 100;

// Every cited work (the table is larger than one 1000-row page).
async function allCitedWorks(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("cited_works").select("id, title, authors, year, cited_by, status").order("id").range(from, from + 999);
    if (error) return { error };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return { rows };
  }
}

// What the page shows before you click: how often works are cited, and the most-cited works the library doesn't have yet.
export async function citedStatus() {
  const { supabase } = await requireAdmin();
  const count = (q) => q.then((r) => (r.error ? null : r.count ?? 0), () => null);
  const [unscanned, withText, { data: arts }] = await Promise.all([
    count(supabase.from("articles").select("id", { count: "exact", head: true }).is("refs_scanned_at", null).not("full_text", "is", null)),
    count(supabase.from("articles").select("id", { count: "exact", head: true }).not("full_text", "is", null)),
    supabase.from("articles").select("id, title"),
  ]);
  if (unscanned === null) return { ready: false };
  const { rows, error } = await allCitedWorks(supabase);
  if (error) return { ready: false };

  // Same "already in the library" test the lookup uses, so the list doesn't show what we have.
  const libTitles = (arts ?? []).map((a) => norm(a.title)).filter((t) => t.length >= 15);
  const inLibrary = (w) => { const t = norm(w.title); return libTitles.some((l) => l.includes(t) || t.includes(l)); };
  const titleOf = Object.fromEntries((arts ?? []).map((a) => [a.id, a.title]));
  const missing = rows.filter((w) => w.status !== "added" && !inLibrary(w));

  // How many works are cited by 1, 2, 3… of your articles (missing works only).
  const byCount = {};
  for (const w of missing) byCount[w.cited_by.length] = (byCount[w.cited_by.length] ?? 0) + 1;
  const spread = Object.entries(byCount).map(([n, works]) => ({ n: Number(n), works })).sort((a, b) => b.n - a.n);

  const top = missing
    .sort((a, b) => b.cited_by.length - a.cited_by.length || (b.year ?? 0) - (a.year ?? 0))
    .slice(0, TOP)
    .map((w) => ({
      id: w.id, title: w.title, authors: w.authors, year: w.year, status: w.status, cites: w.cited_by.length,
      citedBy: w.cited_by.map((id) => titleOf[id]).filter(Boolean),
    }));
  return { ready: true, unscanned, withText, missing: missing.length, spread, top };
}

// Queues a background run (reads the reference lists, then looks up the most-cited works). The work itself happens in
// app/api/cited/run, which the status panel starts. Needs database/update-cite-runs.sql.
// `ids` = the cited works ticked in the list; only those are looked up.
export async function startCitationRun({ ids = [] } = {}) {
  const { supabase } = await requireAdmin();
  if (!hasClaudeKey) return { error: "The Anthropic API key is missing from .env.local." };
  const { count, error: e1 } = await supabase.from("cite_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  if (e1) return { error: /cite_runs/.test(e1.message) ? "Background runs aren't set up yet. Run database/update-cite-runs.sql in Supabase first." : e1.message };
  if (count) return { error: "A search is already running. You can follow it in the panel at the bottom right." };
  const workIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, TOP);
  if (!workIds.length) return { error: "Tick at least one cited work to look up." };
  const { error } = await supabase.from("cite_runs").insert({ how_many: workIds.length, min_cites: 1, work_ids: workIds });
  return error ? { error: error.message } : { ok: true };
}

export async function clearCitationRuns() {
  const { supabase } = await requireAdmin();
  await supabase.from("cite_runs").delete().in("status", ["done", "failed"]);
  return { ok: true };
}
