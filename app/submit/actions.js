"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireApproved } from "@/lib/auth";
import { cleanUrl, ids, int, text, withMsg } from "@/lib/forms";

export async function submitArticle(fd) {
  const { supabase, user } = await requireApproved();
  const url = cleanUrl(text(fd, "url"));
  const note = text(fd, "submission_note");
  if (!url || !note) redirect(withMsg("/submit", "Please include both the link and a note on why it belongs.", "error"));

  const { data: existing } = await supabase.rpc("article_url_status", { u: url });
  if (existing === "approved") redirect(withMsg("/submit", "Good find! That article is already in the library.", "error"));
  if (existing === "pending") redirect(withMsg("/submit", "Someone has already suggested that article, and it's waiting for review.", "error"));

  const { data, error } = await supabase.from("articles").insert({
    url,
    title: text(fd, "title"),
    source_id: int(fd, "source_id"),
    submission_note: note,
    status: "pending",
    origin: "partner",
    submitted_by: user.id,
  }).select("id").single();
  if (error) redirect(withMsg("/submit", `Something went wrong: ${error.message}`, "error"));

  const topics = ids(fd, "topic_ids");
  if (topics.length) {
    await supabase.from("article_topics").insert(topics.map((topic_id) => ({ article_id: data.id, topic_id })));
  }
  revalidatePath("/", "layout");
  redirect(withMsg("/submit", "Thanks! Your suggestion is in the review queue."));
}
