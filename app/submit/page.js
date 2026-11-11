import { requireApproved } from "@/lib/auth";
import Notice from "@/components/Notice";
import TopicPicker from "@/components/TopicPicker";
import { submitArticle } from "./actions";

const statusLabel = { pending: "Waiting for review", approved: "In the library", rejected: "Not added" };

export default async function SubmitPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase, user } = await requireApproved();
  const [{ data: sources }, { data: topics }, { data: mine }] = await Promise.all([
    supabase.from("sources").select("id, name").order("name"),
    supabase.from("topics").select("id, name").order("name"),
    supabase.from("articles").select("id, url, title, status, review_note, created_at")
      .eq("submitted_by", user.id).order("created_at", { ascending: false }),
  ]);

  return (
    <div className="two-col">
      <section className="card">
        <h1>Suggest an article</h1>
        <p className="muted">
          Share a link and a short note on why it belongs. The admin reviews every suggestion before it joins the library.
        </p>
        <Notice sp={sp} />
        <form action={submitArticle} className="stack">
          <label>Link to the article <span className="req">required</span>
            <input name="url" required placeholder="https://" />
          </label>
          <label>Why it belongs <span className="req">required</span>
            <textarea name="submission_note" required rows={3}
              placeholder="What makes this useful or high quality?" />
          </label>
          <details>
            <summary>Add more details (optional)</summary>
            <div className="stack">
              <label>Title<input name="title" /></label>
              <label>Source
                <select name="source_id" defaultValue="">
                  <option value="">Not sure</option>
                  {(sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <TopicPicker topics={topics ?? []} selected={[]} label="Suggested topics" />
            </div>
          </details>
          <button className="button" type="submit">Send for review</button>
        </form>
      </section>

      <aside className="card">
        <h2>Your suggestions</h2>
        {(mine ?? []).length === 0 && <p className="muted">You haven't suggested anything yet.</p>}
        <ul className="plain">
          {(mine ?? []).map((m) => (
            <li key={m.id}>
              <a href={m.url} target="_blank" rel="noreferrer">{m.title || m.url}</a>
              <span className={`status ${m.status}`}>{statusLabel[m.status]}</span>
              {m.review_note && <p className="small muted">Note from the admin: {m.review_note}</p>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
