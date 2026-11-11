import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import Notice from "@/components/Notice";
import { deleteSource, saveSource } from "../actions";

export default async function SourcesPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: sources }, { data: counts }] = await Promise.all([
    supabase.from("sources").select("*").order("name"),
    supabase.from("articles").select("source_id").eq("status", "approved"),
  ]);
  const n = {};
  for (const c of counts ?? []) n[c.source_id] = (n[c.source_id] ?? 0) + 1;

  return (
    <>
      <h1>Sources</h1>
      <p className="muted">
        The publications and organizations articles come from. The scout checks the websites of the sources marked
        “scout” for new articles, and the research assistant searches those websites. There are {sources?.length ?? 0} sources.
      </p>
      <Notice sp={sp} />

      <section className="card">
        <h2>Add a source</h2>
        <form action={saveSource} className="row-form">
          <input name="name" placeholder="Name" required />
          <input name="website_url" placeholder="Website (optional)" />
          <label className="check inline"><input type="checkbox" name="scout_enabled" defaultChecked /> Scout</label>
          <button className="button">Add</button>
        </form>
      </section>

      <section className="card">
        <div className="source-grid source-head" aria-hidden>
          <span>Name</span><span>Website</span><span>Notes</span><span className="center">Scout</span><span className="center">Articles</span><span></span><span></span>
        </div>
        {(sources ?? []).map((s) => (
          <form key={s.id} action={saveSource} className="source-grid source-row">
            <input type="hidden" name="id" value={s.id} />
            <input name="name" defaultValue={s.name} required aria-label="Name" />
            <input name="website_url" defaultValue={s.website_url ?? ""} placeholder="Website" aria-label="Website" />
            <input name="notes" defaultValue={s.notes ?? ""} placeholder="Notes" aria-label="Notes" />
            <span className="center"><input type="checkbox" name="scout_enabled" defaultChecked={s.scout_enabled} aria-label="Scout" /></span>
            <Link href={`/?source=${s.id}`} className="center">{n[s.id] ?? 0}</Link>
            <button className="link-button">Save</button>
            <button className="link-button danger" formAction={deleteSource} formNoValidate>Remove</button>
          </form>
        ))}
      </section>
    </>
  );
}
