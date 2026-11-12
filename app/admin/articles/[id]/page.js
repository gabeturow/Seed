import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { loadTopicsFor } from "@/lib/articles";
import ArticleForm from "@/components/ArticleForm";
import Notice from "@/components/Notice";
import { deleteArticle, saveArticle, setArticleStatus } from "../../actions";

const statusText = { approved: "In the library", pending: "Waiting for review", rejected: "Rejected" };

export default async function EditArticlePage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: a }, { data: sources }, { data: topics }] = await Promise.all([
    supabase.from("articles").select("*").eq("id", id).single(),
    supabase.from("sources").select("id, name").order("name"),
    supabase.from("topics").select("id, name").order("name"),
  ]);
  if (!a) notFound();
  const topicsBy = await loadTopicsFor(supabase, [a.id]);
  const back = `/admin/articles/${a.id}`;

  return (
    <>
      <p><Link href="/library">← Back to the library</Link></p>
      <section className="card">
        <h1>Edit article</h1>
        <p className="muted">Status: <span className={`status ${a.status}`}>{statusText[a.status]}</span></p>
        <Notice sp={sp} />
        <ArticleForm article={a} sources={sources ?? []} topics={topics ?? []}
          selectedTopicIds={(topicsBy[a.id] ?? []).map((t) => t.id)}
          action={saveArticle} mode={a.status === "pending" ? "review" : "edit"} back={back} />
      </section>

      <section className="card danger-zone">
        <h2>Remove from the library</h2>
        {a.status === "approved" && (
          <form action={setArticleStatus} className="stack">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="status" value="rejected" />
            <input type="hidden" name="back" value={back} />
            <p className="muted">Hide it from the library but keep the record, so it isn't suggested again.</p>
            <button className="button secondary">Hide from library</button>
          </form>
        )}
        <form action={deleteArticle} className="stack">
          <input type="hidden" name="id" value={a.id} />
          <label className="check inline"><input type="checkbox" name="confirm" /> Yes, delete this article permanently</label>
          <button className="button danger">Delete permanently</button>
        </form>
      </section>
    </>
  );
}
