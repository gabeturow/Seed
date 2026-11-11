import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const isConfigured = Boolean(
  SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes("your-project")
);

// A Supabase connection that acts as whoever is signed in (via their login cookie).
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a page render, where cookies are read-only. The proxy refreshes them instead.
        }
      },
    },
  });
}
