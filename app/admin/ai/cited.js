"use server";
import { requireAdmin } from "@/lib/auth";
import { hasClaudeKey } from "@/lib/claude";

// What the page shows before you click.
export async function citedStatus() {
  const { supabase } = await requireAdmin();
  const count = (q) => q.then((r) => (r.error ? null : r.count ?? 0), () => null);
  const [unscanned, withText] = await Promise.all([
    count(supabase.from("articles").select("id", { count: "exact", head: true }).is("refs_scanned_at", null).not("full_text", "is", null)),
    count(supabase.from("articles").select("id", { count: "exact", head: true }).not("full_text", "is", null)),
  ]);
  if (unscanned === null) return { ready: false };
  const { data } = await supabase.from("cited_works").select("cited_by").eq("status", "new");
  const rows = data ?? [];
  return { ready: true, unscanned, withText, twoPlus: rows.filter((r) => r.cited_by.length >= 2).length, onePlus: rows.length };
}

// Queues a background run (reads the reference lists, then looks up the most-cited works). The work itself happens in
// app/api/cited/run, which the status panel starts. Needs database/update-cite-runs.sql.
export async function startCitationRun({ howMany = 6, minCites = 2 } = {}) {
  const { supabase } = await requireAdmin();
  if (!hasClaudeKey) return { error: "The Anthropic API key is missing from .env.local." };
  const { count, error: e1 } = await supabase.from("cite_runs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  if (e1) return { error: /cite_runs/.test(e1.message) ? "Background runs aren't set up yet. Run database/update-cite-runs.sql in Supabase first." : e1.message };
  if (count) return { error: "A search is already running. You can follow it in the panel at the bottom right." };
  const { error } = await supabase.from("cite_runs").insert({
    how_many: Math.min(Math.max(Number(howMany) || 6, 1), 40), min_cites: Math.min(Math.max(Number(minCites) || 2, 1), 5),
  });
  return error ? { error: error.message } : { ok: true };
}

export async function clearCitationRuns() {
  const { supabase } = await requireAdmin();
  await supabase.from("cite_runs").delete().in("status", ["done", "failed"]);
  return { ok: true };
}
