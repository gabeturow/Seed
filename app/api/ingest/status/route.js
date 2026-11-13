import { getViewer } from "@/lib/auth";

export async function GET() {
  const { supabase, user, profile } = await getViewer();
  if (!user || profile?.status !== "approved" || profile?.role !== "admin") return Response.json({ jobs: [] }, { status: 403 });
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase.from("ingest_jobs").select("id, status, label, url, message, article_id, created_at")
    .gte("created_at", since).order("id", { ascending: false }).limit(40);
  return Response.json({ jobs: data ?? [] });
}
