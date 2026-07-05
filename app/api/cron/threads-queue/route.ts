import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { postToThreads, threadsConfigured, cleanThreadsPost } from "@/lib/threads";

export const maxDuration = 60;

// 毎日19:00 JSTに実行：キューの先頭1件（5連投稿）を自動投稿
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  if (!threadsConfigured()) return NextResponse.json({ skipped: "Threads未連携" });

  const { data } = await supabase
    .from("threads_queue")
    .select("id, posts")
    .eq("status", "pending")
    .eq("genre", "realestate") // コーチング用Threadsは専用アカウント連携後に対応
    .order("created_at", { ascending: true })
    .limit(1);

  if (!data || data.length === 0) return NextResponse.json({ skipped: "キューが空" });

  const item = data[0];
  try {
    const posts: string[] = item.posts;
    for (let i = 0; i < posts.length; i++) {
      await postToThreads(cleanThreadsPost(posts[i]));
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, 2500));
    }
    await supabase.from("threads_queue")
      .update({ status: "posted", posted_at: new Date().toISOString() })
      .eq("id", item.id);
    return NextResponse.json({ success: true, posted: posts.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "投稿失敗";
    await supabase.from("threads_queue").update({ status: "error", error: msg }).eq("id", item.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
