import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import Notice from "@/components/Notice";
import { addSynonyms, deleteSynonym, deleteTopic, saveTopic } from "../actions";

export default async function TopicsPage({ searchParams }) {
  const sp = await searchParams;
  const { supabase } = await requireAdmin();
  const [{ data: topics }, { data: links }, syn] = await Promise.all([
    supabase.from("topics").select("*").order("name"),
    supabase.from("article_topics").select("topic_id"),
    supabase.from("topic_synonyms").select("id, topic_id, synonym").order("synonym"),
  ]);
  const synonymsReady = !syn.error;
  const synonyms = {};
  for (const x of syn.data ?? []) (synonyms[x.topic_id] ??= []).push(x);
  const n = {};
  for (const l of links ?? []) n[l.topic_id] = (n[l.topic_id] ?? 0) + 1;

  return (
    <>
      <h1>Topics</h1>
      <p className="muted">
        The shared tag list. Partners choose from these when they suggest an article, and only you can add or change them.
        Renaming a topic updates it on every article. Synonyms are other words people might search for; they find the
        topic&apos;s articles without adding another tag. Use a synonym only for the same idea in different words, and make a
        separate topic when the meaning differs.
      </p>
      {!synonymsReady && (
        <p className="notice error">Synonyms aren&apos;t set up yet. Run database/update-topic-synonyms.sql in Supabase, then reload.</p>
      )}
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
            <div key={t.id} className="topic-block">
              <form action={saveTopic} className="row-form">
                <input type="hidden" name="id" value={t.id} />
                <input name="name" defaultValue={t.name} required aria-label="Topic name" />
                <Link href={`/library?topic=${t.id}`} className="num" title="Articles with this topic">{n[t.id] ?? 0}</Link>
                <button className="link-button">Rename</button>
                <button className="link-button danger" formAction={deleteTopic} formNoValidate>Remove</button>
              </form>
              {synonymsReady && (
                <div className="synonyms">
                  <span className="muted">Also found by:</span>
                  {(synonyms[t.id] ?? []).map((x) => (
                    <form key={x.id} action={deleteSynonym} className="synonym">
                      <input type="hidden" name="id" value={x.id} />
                      {x.synonym}
                      <button className="link-button" aria-label={`Remove synonym ${x.synonym}`} title="Remove">×</button>
                    </form>
                  ))}
                  <form action={addSynonyms} className="synonym-add">
                    <input type="hidden" name="topic_id" value={t.id} />
                    <input name="synonyms" placeholder="add synonyms, comma separated" aria-label={`Add synonyms for ${t.name}`} />
                    <button className="link-button">Add</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
