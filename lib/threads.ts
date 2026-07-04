// Threads API（Meta）投稿の共通ロジック

export function threadsConfigured(): boolean {
  return !!(process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN);
}

async function createContainer(text: string): Promise<string> {
  const res = await fetch(
    `https://graph.threads.net/v1.0/${process.env.THREADS_USER_ID}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "TEXT", text, access_token: process.env.THREADS_ACCESS_TOKEN }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "コンテナ作成失敗");
  return data.id;
}

async function publishContainer(containerId: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(
    `https://graph.threads.net/v1.0/${process.env.THREADS_USER_ID}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: process.env.THREADS_ACCESS_TOKEN }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "投稿失敗");
  return data.id;
}

export async function postToThreads(text: string): Promise<string> {
  const containerId = await createContainer(text);
  return publishContainer(containerId);
}

// 投稿本文の整形（生成時のラベル・文字数表記を除去）
export function cleanThreadsPost(text: string): string {
  return text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/（約\d+文字）/, "").trim();
}
