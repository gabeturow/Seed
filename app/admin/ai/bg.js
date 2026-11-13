"use server";
import { requireAdmin } from "@/lib/auth";
import { SCOUT_THEMES, themeCounts } from "@/lib/ai-core";

// Starts the scout or "Update the library" as a background run (see app/api/bg/run). Needs database/update-bg-runs.sql.
async function queueRun(kind, params) {
  const { supabase } = await requireAdmin();
  const { data: active, error: e1 } = await supabase.from("bg_runs").select("id").eq("kind", kind).in("status", ["queued", "running"]).limit(1);
  if (e1) return { error: /bg_runs/.test(e1.message) ? "Run database/update-bg-runs.sql in Supabase first." : e1.message };
  if (active?.length) return { error: "That is already running. Progress is in the panel at the bottom right." };
  const { error } = await supabase.from("bg_runs").insert({ kind, params });
  return error ? { error: error.message } : { ok: true };
}

export async function startScoutRun({ theme = "" } = {}) {
  const { supabase } = await requireAdmin();
  let chosen = String(theme);
  if (chosen !== "all" && !SCOUT_THEMES.some((t) => t.key === chosen)) {   // no choice: the theme with the fewest articles
    const counts = await themeCounts(supabase);
    chosen = SCOUT_THEMES[counts.indexOf(Math.min(...counts))].key;
  }
  return queueRun("scout", { theme: chosen });
}

export async function startUpdateRun({ withAi = true } = {}) {
  return queueRun("update", { withAi: !!withAi });
}

export async function clearBgRuns() {
  const { supabase } = await requireAdmin();
  await supabase.from("bg_runs").delete().in("status", ["done", "failed"]);
  return { ok: true };
}
