import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { postThreadChain, threadsConfigured, cleanThreadsPost } from "@/lib/threads";

export const maxDuration = 60;

const GENRES = ["realestate", "coaching", "sales"] as const;

// 毎日19:00 JSTに実行：ジャンルごとにキューの先頭1件（5連投稿）を自動投稿。
// Threads未連携のジャンルはスキップし、キューに滞留させる（連携後に自動で流れ始める）
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });

  const results: Record<string, unknown> = {};

  for (const genre of GENRES) {
    if (!threadsConfigured(genre)) { results[genre] = "Threads未連携"; continue; }

    const { data } = await supabase
      .from("threads_queue")
      .select("id, posts")
      .eq("status", "pending")
      .eq("genre", genre)
      .order("created_at", { ascending: true })
      .limit(1);

    if (!data || data.length === 0) { results[genre] = "キューが空"; continue; }

    const item = data[0];
    try {
      const posts: string[] = (item.posts as string[]).map(cleanThreadsPost);
      // 1本目を親、続きはその返信としてぶら下げ、1つの連投スレッドにする
      await postThreadChain(posts, genre);
      await supabase.from("threads_queue")
        .update({ status: "posted", posted_at: new Date().toISOString() })
        .eq("id", item.id);
      results[genre] = { success: true, posted: posts.length };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "投稿失敗";
      await supabase.from("threads_queue").update({ status: "error", error: msg }).eq("id", item.id);
      results[genre] = { error: msg };
    }
  }

  return NextResponse.json(results);
}
