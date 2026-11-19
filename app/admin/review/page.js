import { requireAdmin } from "@/lib/auth";
import { loadTopicsFor } from "@/lib/articles";
import ArticleForm from "@/components/ArticleForm";
import Notice from "@/components/Notice";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteArticle, approveAllPending, saveArticle, setArticleStatus } from "../actions";

const originLabel = { partner: "Suggested by", scout: "Found by the weekly scout", import: "Imported", admin: "Added by" };

export default async function ReviewPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: pending }, { data: rejected }, { data: sources }, { data: topics }, { data: people }] = await Promise.all([
    supabase.from("articles").select("*").eq("status", "pending").order("created_at"),
    supabase.from("articles").select("id, url, title, reviewed_at").eq("status", "rejected").order("reviewed_at", { ascending: false }).limit(20),
    supabase.from("sources").select("id, name").order("name"),
    supabase.from("topics").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email"),
  ]);
  const list = pending ?? [];
  const topicsBy = await loadTopicsFor(supabase, list.map((a) => a.id));
  const person = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name || p.email]));

  return (
    <>
      <h1>Review queue</h1>
      <p className="muted">
        Nothing joins the library until you approve it. You can fix the title, summary, topics, or anything else first.
      </p>
      <Notice sp={sp} />
      {list.length > 1 && (
        <form action={approveAllPending}>
          <ConfirmButton className="button"
            message={`Approve all ${list.length} articles waiting in the queue? They'll join the library as they are now.`}>
            Approve all ({list.length})
          </ConfirmButton>
        </form>
      )}
      {list.length === 0 && <div className="empty"><p>All caught up. There's nothing waiting for review.</p></div>}

      {list.map((a) => (
        <section key={a.id} className="card review-item">
          <div className="submitted">
            <p>
              <strong>{originLabel[a.origin]}{a.origin !== "scout" && a.submitted_by ? ` ${person[a.submitted_by] ?? "a partner"}` : ""}</strong>
              {" "}on {new Date(a.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
            {a.submission_note && <blockquote>{a.submission_note}</blockquote>}
            <p><a href={a.url} target="_blank" rel="noreferrer">Open the article ↗</a></p>
          </div>
          <ArticleForm article={a} sources={sources ?? []} topics={topics ?? []}
            selectedTopicIds={(topicsBy[a.id] ?? []).map((t) => t.id)}
            action={saveArticle} mode="review" back="/admin/review" />
        </section>
      ))}

      {(rejected ?? []).length > 0 && (
        <details className="card">
          <summary>Recently rejected ({rejected.length})</summary>
          <table className="table rejected-table">
            <thead>
              <tr><th>Article</th><th></th><th></th></tr>
            </thead>
            <tbody>
            {rejected.map((r) => (
              <tr key={r.id}>
                <td><a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a></td>
                <td className="action-cell"><form action={setArticleStatus} className="inline-form">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value="approved" />
                  <input type="hidden" name="back" value="/admin/review" />
                  <button className="link-button plain-ink">Move to library</button>
                </form></td>
                <td className="action-cell"><form action={deleteArticle} className="inline-form">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="confirm" value="on" />
                  <input type="hidden" name="back" value="/admin/review" />
                  <ConfirmButton className="link-button danger"
                    message={`Permanently delete "${r.title || r.url}" from the database? This can't be undone.`}>
                    Delete
                  </ConfirmButton>
                </form></td>
              </tr>
            ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
