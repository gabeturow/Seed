import { requireApproved } from "@/lib/auth";
import { hasClaudeKey } from "@/lib/claude";
import AskForm from "@/components/AskForm";

// Answers can take a minute or two while the assistant reads and searches.
export const maxDuration = 300;

export default async function AskPage() {
  const { supabase, user } = await requireApproved();
  // This person's saved conversations, newest first. If the table isn't set up yet, there are none.
  const { data: saved, error } = await supabase.from("ask_threads").select("id, turns, updated_at")
    .eq("user_id", user.id).order("updated_at", { ascending: false }).limit(25);
  return (
    <>
      <section className="intro">
        <h1>Ask the <em>library</em></h1>
        <p className="muted">
          Ask a research question. The assistant answers from the library first, reads full articles when it needs
          detail, and cites what it used. If the library doesn't cover something, it searches only the vetted sources'
          websites and lists those results separately as unvetted.
        </p>
      </section>
      {hasClaudeKey ? <AskForm saved={error ? [] : (saved ?? [])} /> : (
        <div className="card"><p>The research assistant isn't set up yet: the Anthropic API key is missing from <code>.env.local</code>.</p></div>
      )}
    </>
  );
}
