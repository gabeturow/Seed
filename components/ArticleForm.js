import PdfUpload from "./PdfUpload";
import TopicPicker from "./TopicPicker";

// The full article form used by the admin to add, edit, and review articles.
// mode: "new" | "edit" | "review"
export default function ArticleForm({ article = {}, sources, topics, selectedTopicIds = [], action, mode, back }) {
  const a = article;
  return (
    <form action={action} className="stack article-form">
      {a.id && <input type="hidden" name="id" value={a.id} />}
      <input type="hidden" name="back" value={back} />

      <div className="grid-2">
        <label className="span-2">Link <span className="hint">(required unless you upload a PDF below)</span>
          <input name="url" defaultValue={a.source_url ?? (a.pdf_path ? "" : (a.url ?? ""))} placeholder="https://" />
          <span className="hint">The article&apos;s own web page. A stored PDF is shown separately as &ldquo;Read the PDF&rdquo;.</span>
        </label>
        <label className="span-2">DOI <span className="hint">(if it has one; the library links to it)</span>
          <input name="doi" defaultValue={a.doi ?? ""} placeholder="10.1234/abcd.5678" />
        </label>
        <PdfUpload current={!!a.pdf_path} />
        <label className="span-2">Title
          <input name="title" defaultValue={a.title ?? ""} />
        </label>
        <label className="span-2">Authors
          <input name="authors" defaultValue={a.authors ?? ""} placeholder="Separate names with semicolons" />
        </label>
        <label>Source
          <select name="source_id" defaultValue={a.source_id ?? ""}>
            <option value="">No source yet</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>Type of resource
          <input name="resource_type" defaultValue={a.resource_type ?? ""} placeholder="Report, journal article, toolkit…" />
        </label>
        <label>Publication date
          <input name="publication_date" type="date" defaultValue={a.publication_date ?? ""} />
          <span className="hint">Or just the year, if that's all you know:</span>
          <input name="publication_year" type="number" min="1800" max="2100" defaultValue={a.publication_year ?? ""} placeholder="Year" />
        </label>
        <label>Other organizations involved
          <input name="related_organizations" defaultValue={a.related_organizations ?? ""} placeholder="Co-publishers, partners" />
          <span className="hint">Publication details (journal, volume, pages):</span>
          <input name="publication_details" defaultValue={a.publication_details ?? ""} />
        </label>
      </div>

      <label>Summary
        <textarea name="summary" rows={6} defaultValue={a.summary ?? ""}
          placeholder="Leave blank if there's no abstract yet. It will show as “Summary to come.”" />
      </label>
      <div className="grid-2">
        <label>Where the summary came from
          <select name="summary_origin" defaultValue={a.summary_origin ?? ""}>
            <option value="">No summary yet</option>
            <option value="abstract">The article's own abstract</option>
            <option value="human">Written by a person</option>
            <option value="ai_draft">Drafted by AI</option>
          </select>
        </label>
        <label className="check inline">
          <input type="checkbox" name="summary_needs_review" defaultChecked={!!a.summary_needs_review} />
          Summary still needs review
        </label>
      </div>

      <TopicPicker topics={topics} selected={selectedTopicIds} />

      <label>Private admin notes
        <textarea name="admin_notes" rows={2} defaultValue={a.admin_notes ?? ""} />
      </label>

      {mode === "review" && (
        <label>Note back to the person who suggested it (optional)
          <input name="review_note" defaultValue={a.review_note ?? ""} placeholder="For example, why it wasn't added" />
        </label>
      )}

      <div className="actions">
        <label className="check internal-check">
          <input type="checkbox" name="internal" defaultChecked={!!a.internal} />
          Internal (BITE staff only)
        </label>
        {mode === "new" && <button className="button" name="intent" value="create">Add to library</button>}
        {mode === "edit" && <button className="button" name="intent" value="save">Save changes</button>}
        {mode === "review" && (
          <>
            <button className="button" name="intent" value="approve">Approve and add to library</button>
            <button className="button secondary" name="intent" value="save">Save without deciding</button>
            <button className="button danger" name="intent" value="reject" formNoValidate>Reject</button>
          </>
        )}
      </div>
    </form>
  );
}
