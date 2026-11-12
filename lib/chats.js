// This person's saved conversations about articles (private to them). Returns { [articleId]: messages }.
// If the table isn't set up yet, returns nothing instead of failing.
export async function loadChats(supabase, userId, articleIds) {
  if (!userId || !articleIds.length) return {};
  const { data, error } = await supabase.from("article_chats").select("article_id, messages")
    .eq("user_id", userId).in("article_id", articleIds);
  if (error) return {};
  return Object.fromEntries((data ?? []).map((r) => [r.article_id, r.messages]));
}
