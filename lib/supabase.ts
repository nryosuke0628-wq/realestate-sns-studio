import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定の間は null を返し、
// アプリはSupabaseなしでも動く（トレンドは都度検索にフォールバック）
export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key);
  return client;
}
