import { requireAdmin } from "@/lib/auth";
import AttachPdfs from "@/components/AttachPdfs";

export const maxDuration = 300;

export default async function AttachPage() {
  await requireAdmin();
  return (
    <section className="card">
      <h1>Link PDFs to existing articles</h1>
      <p className="muted">Choose a folder of PDFs. Each one is matched to the library article with the same title that has no stored PDF, then linked to it. Its text is added too if the article has none. Files that don't match any article are skipped and not kept.</p>
      <AttachPdfs />
    </section>
  );
}
