import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import Notice from "@/components/Notice";
import { deleteTopic, saveTopic } from "../actions";

export default async function TopicsPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: topics }, { data: links }] = await Promise.all([
    supabase.from("topics").select("*").order("name"),
    supabase.from("article_topics").select("topic_id"),
  ]);
  const n = {};
  for (const l of links ?? []) n[l.topic_id] = (n[l.topic_id] ?? 0) + 1;

  return (
    <>
      <h1>Topics</h1>
      <p className="muted">
        The shared tag list. Partners choose from these when they suggest an article, and only you can add or change them.
        Renaming a topic updates it on every article.
      </p>
      <Notice sp={sp} />
      <section className="card">
        <form action={saveTopic} className="row-form">
          <input name="name" placeholder="New topic, e.g. narrative design" required />
          <button className="button">Add topic</button>
        </form>
      </section>
      <section className="card">
        <div className="topic-admin">
          {(topics ?? []).map((t) => (
            <form key={t.id} action={saveTopic} className="row-form">
              <input type="hidden" name="id" value={t.id} />
              <input name="name" defaultValue={t.name} required aria-label="Topic name" />
              <Link href={`/?topic=${t.id}`} className="num" title="Articles with this topic">{n[t.id] ?? 0}</Link>
              <button className="link-button">Rename</button>
              <button className="link-button danger" formAction={deleteTopic} formNoValidate>Remove</button>
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
