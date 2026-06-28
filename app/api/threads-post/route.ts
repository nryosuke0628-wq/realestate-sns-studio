import { NextRequest, NextResponse } from "next/server";

const THREADS_USER_ID = process.env.THREADS_USER_ID;
const THREADS_ACCESS_TOKEN = process.env.THREADS_ACCESS_TOKEN;

async function createContainer(text: string): Promise<string> {
  const res = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "TEXT",
        text,
        access_token: THREADS_ACCESS_TOKEN,
      }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "コンテナ作成失敗");
  return data.id;
}

async function publishContainer(containerId: string): Promise<string> {
  // Threads APIは投稿間に少し待機が必要
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(
    `https://graph.threads.net/v1.0/${THREADS_USER_ID}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: THREADS_ACCESS_TOKEN,
      }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "投稿失敗");
  return data.id;
}

export async function POST(request: NextRequest) {
  if (!THREADS_USER_ID || !THREADS_ACCESS_TOKEN) {
    return NextResponse.json(
      { error: "Threads APIキーが設定されていません（THREADS_USER_ID / THREADS_ACCESS_TOKEN）" },
      { status: 500 }
    );
  }

  try {
    const { text } = await request.json();
    if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });

    const containerId = await createContainer(text);
    const postId = await publishContainer(containerId);

    return NextResponse.json({ success: true, postId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "投稿に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
