import { NextResponse } from "next/server";
import { requireApproved } from "@/lib/auth";

// Opens an article's stored PDF. The article is read with the viewer's own permissions, so internal articles stay hidden
// from public accounts; the PDF itself is handed over through a short-lived private link.
export async function GET(request, { params }) {
  const { id: raw } = await params;
  const id = Number(raw);
  const { supabase } = await requireApproved();
  const { data: a } = Number.isInteger(id)
    ? await supabase.from("articles").select("pdf_path").eq("id", id).maybeSingle()
    : { data: null };
  if (!a?.pdf_path) return new NextResponse("That PDF couldn't be found.", { status: 404 });
  const { data, error } = await supabase.storage.from("article-pdfs").createSignedUrl(a.pdf_path, 300);
  if (error || !data?.signedUrl) return new NextResponse("That PDF couldn't be opened just now.", { status: 502 });
  return NextResponse.redirect(data.signedUrl);
}
