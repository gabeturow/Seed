import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApproved } from "@/lib/auth";
import { cleanDoc, KIND_LABEL } from "@/lib/doc";
import SharedDoc from "@/components/SharedDoc";

export default async function SharedAnswerPage({ params }) {
  const { id } = await params;
  const { supabase } = await requireApproved();
  const { data } = await supabase.from("shared_answers").select("doc, created_at").eq("id", id).maybeSingle();
  const doc = cleanDoc(data?.doc);
  if (!doc) notFound();
  const when = new Date(data.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <p className="muted small no-print"><Link href="/ask">← Ask the library</Link></p>
      <h1>{doc.kind === "answer" ? "Shared answer" : `Shared: ${KIND_LABEL[doc.kind]}`}</h1>
      {doc.question && <p className="muted">Question: {doc.question}</p>}
      <p className="muted small">Shared {when}. Only approved Seed members can open this page. The assistant's answers are drafts; check the sources before relying on them.</p>
      <SharedDoc doc={doc} />
    </>
  );
}
