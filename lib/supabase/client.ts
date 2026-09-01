import { createBrowserClient } from "@supabase/ssr";

export function createClient(url = process.env.NEXT_PUBLIC_SUPABASE_URL || "", key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "") {
  return createBrowserClient(url, key);
}
