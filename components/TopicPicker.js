// A scrollable list of topic checkboxes. Submits as topic_ids.
export default function TopicPicker({ topics, selected = [], label = "Topics" }) {
  const chosen = new Set(selected);
  return (
    <fieldset className="topic-picker">
      <legend>{label}</legend>
      <div className="topic-grid">
        {topics.map((t) => (
          <label key={t.id} className="check">
            <input type="checkbox" name="topic_ids" value={t.id} defaultChecked={chosen.has(t.id)} />
            {t.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
