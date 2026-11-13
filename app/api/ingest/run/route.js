import { after } from "next/server";
import { getViewer } from "@/lib/auth";
import { ingestOne } from "@/lib/ingest-core";

// Works through the queued "Add an article" jobs in the background, after this response has already been sent,
// so it keeps going when the person moves to another page. A few jobs run at once; if time runs short the rest
// stay queued and the status panel asks for another run.
export const maxDuration = 300;
const SLOTS = 3;
const STOP_STARTING_AFTER_MS = 190_000;
const STALE_MS = 8 * 60_000;

async function work(supabase, user, slots) {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: slots }, async () => {
    while (Date.now() - t0 < STOP_STARTING_AFTER_MS) {
      const { data: next } = await supabase.from("ingest_jobs").select("id").eq("status", "queued").order("id").limit(1);
      if (!next?.length) return;
      const { data: claimed } = await supabase.from("ingest_jobs")
        .update({ status: "running", started_at: new Date().toISOString() }).eq("id", next[0].id).eq("status", "queued").select("*");
      if (!claimed?.length) continue;          // another worker took it
      const job = claimed[0];
      try {
        const r = await ingestOne(supabase, user, job);
        await supabase.from("ingest_jobs").update({
          status: "done", article_id: r.id, label: r.title ?? job.label, finished_at: new Date().toISOString(),
          message: r.duplicate ? "Already in the library" : null,
        }).eq("id", job.id);
      } catch (err) {
        await supabase.from("ingest_jobs").update({ status: "failed", message: String(err?.message ?? err).slice(0, 400), finished_at: new Date().toISOString() }).eq("id", job.id);
      }
    }
  }));
}

export async function POST() {
  const { supabase, user, profile } = await getViewer();
  if (!user || profile?.status !== "approved" || profile?.role !== "admin") return Response.json({ error: "Admins only." }, { status: 403 });
  await supabase.from("ingest_jobs").update({ status: "queued" }).eq("status", "running").lt("started_at", new Date(Date.now() - STALE_MS).toISOString());
  const [{ count: queued }, { count: running }] = await Promise.all([
    supabase.from("ingest_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    supabase.from("ingest_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
  ]);
  const slots = Math.min(SLOTS - (running ?? 0), queued ?? 0);
  if (!queued || slots <= 0) return Response.json({ started: 0, queued: queued ?? 0, running: running ?? 0 });
  after(() => work(supabase, user, slots));
  return Response.json({ started: slots, queued, running });
}
