// Threads API（Meta）投稿の共通ロジック。ジャンルごとに別アカウント（別トークン）で投稿する

interface ThreadsCreds { userId: string; token: string }

// 環境変数の対応：
//   realestate: THREADS_USER_ID / THREADS_ACCESS_TOKEN
//   coaching:   THREADS_USER_ID_COACHING / THREADS_ACCESS_TOKEN_COACHING
//   sales:      THREADS_USER_ID_SALES / THREADS_ACCESS_TOKEN_SALES
function credsFor(genre: string): ThreadsCreds | null {
  const suffix = genre === "coaching" ? "_COACHING" : genre === "sales" ? "_SALES" : "";
  const token = process.env[`THREADS_ACCESS_TOKEN${suffix}`];
  if (!token) return null;
  // THREADS_USER_ID は任意。未設定ならユーザートークンで解決できる "me" を使う
  // （Threads API は /me/threads を受け付けるため、トークンだけで投稿できる）
  const userId = process.env[`THREADS_USER_ID${suffix}`] || "me";
  return { userId, token };
}

export function threadsConfigured(genre = "realestate"): boolean {
  return credsFor(genre) !== null;
}

async function createContainer(text: string, creds: ThreadsCreds, replyToId?: string): Promise<string> {
  const res = await fetch(
    `https://graph.threads.net/v1.0/${creds.userId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_type: "TEXT",
        text,
        // replyToId があれば、その投稿への返信として作成する（連投＝セルフリプライ）
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        access_token: creds.token,
      }),
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

export async function postToThreads(text: string, genre = "realestate", replyToId?: string): Promise<string> {
  const creds = credsFor(genre);
  if (!creds) throw new Error("このジャンルのThreadsアカウントが未連携です");
  const containerId = await createContainer(text, creds, replyToId);
  return publishContainer(containerId, creds);
}

// 複数投稿を「連投（セルフリプライ）」として1本のスレッドに投稿する。
// 1件目を親、2件目以降は直前の投稿への返信としてぶら下げる。投稿IDの配列を返す。
export async function postThreadChain(posts: string[], genre = "realestate"): Promise<string[]> {
  const ids: string[] = [];
  let parentId: string | undefined;
  for (let i = 0; i < posts.length; i++) {
    const id = await postToThreads(posts[i], genre, parentId);
    ids.push(id);
    parentId = id; // 次の投稿はこの投稿への返信にする
    if (i < posts.length - 1) await new Promise((r) => setTimeout(r, 2500));
  }
  return ids;
}

// 投稿本文の整形（生成時のラベル・文字数表記を除去）
export function cleanThreadsPost(text: string): string {
  return text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/（約\d+文字）/, "").trim();
}
