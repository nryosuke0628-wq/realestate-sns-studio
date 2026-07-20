import { NextRequest, NextResponse } from "next/server";
import { postToThreads, threadsConfigured } from "@/lib/threads";

export async function POST(request: NextRequest) {
  try {
    const { text, genre, replyToId } = await request.json();
    const g = typeof genre === "string" && genre ? genre : "realestate";
    if (!threadsConfigured(g)) {
      return NextResponse.json(
        { error: "このジャンルのThreadsアカウントが未連携です（不動産: THREADS_ACCESS_TOKEN、コーチングは_COACHING・営業は_SALESサフィックス付きで設定）" },
        { status: 500 }
      );
    }
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
    // replyToId があれば、その投稿への返信として投稿する（連投チェーン用）
    const postId = await postToThreads(text, g, typeof replyToId === "string" && replyToId ? replyToId : undefined);
    return NextResponse.json({ success: true, postId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "投稿に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
