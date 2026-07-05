// Threads API（Meta）投稿の共通ロジック。ジャンルごとに別アカウント（別トークン）で投稿する

interface ThreadsCreds { userId: string; token: string }

// 環境変数の対応：
//   realestate: THREADS_USER_ID / THREADS_ACCESS_TOKEN
//   coaching:   THREADS_USER_ID_COACHING / THREADS_ACCESS_TOKEN_COACHING
//   ai:         THREADS_USER_ID_AI / THREADS_ACCESS_TOKEN_AI
function credsFor(genre: string): ThreadsCreds | null {
  const suffix = genre === "coaching" ? "_COACHING" : genre === "ai" ? "_AI" : "";
  const userId = process.env[`THREADS_USER_ID${suffix}`];
  const token = process.env[`THREADS_ACCESS_TOKEN${suffix}`];
  return userId && token ? { userId, token } : null;
}

export function threadsConfigured(genre = "realestate"): boolean {
  return credsFor(genre) !== null;
}

async function createContainer(text: string, creds: ThreadsCreds): Promise<string> {
  const res = await fetch(
    `https://graph.threads.net/v1.0/${creds.userId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ media_type: "TEXT", text, access_token: creds.token }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "コンテナ作成失敗");
  return data.id;
}

async function publishContainer(containerId: string, creds: ThreadsCreds): Promise<string> {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch(
    `https://graph.threads.net/v1.0/${creds.userId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: containerId, access_token: creds.token }),
    }
  );
  const data = await res.json();
  if (!data.id) throw new Error(data.error?.message ?? "投稿失敗");
  return data.id;
}

export async function postToThreads(text: string, genre = "realestate"): Promise<string> {
  const creds = credsFor(genre);
  if (!creds) throw new Error("このジャンルのThreadsアカウントが未連携です");
  const containerId = await createContainer(text, creds);
  return publishContainer(containerId, creds);
}

// 投稿本文の整形（生成時のラベル・文字数表記を除去）
export function cleanThreadsPost(text: string): string {
  return text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/（約\d+文字）/, "").trim();
}
