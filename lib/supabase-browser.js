import { createBrowserClient } from "@supabase/ssr";

// A Supabase connection in the browser, acting as whoever is signed in. Used to send PDFs straight to storage.
export const browserClient = () => createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
