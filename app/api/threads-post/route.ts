import { NextRequest, NextResponse } from "next/server";
import { postToThreads, threadsConfigured } from "@/lib/threads";

export async function POST(request: NextRequest) {
  if (!threadsConfigured()) {
    return NextResponse.json(
      { error: "Threads APIキーが設定されていません（THREADS_USER_ID / THREADS_ACCESS_TOKEN）" },
      { status: 500 }
    );
  }

  try {
    const { text } = await request.json();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    const postId = await postToThreads(text);
    return NextResponse.json({ success: true, postId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "投稿に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
