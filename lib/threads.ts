// Threads API（Meta）投稿の共通ロジック。ジャンルごとに別アカウント（別トークン）で投稿する

import { getSupabase } from "./supabase";

interface ThreadsCreds { userId: string; token: string }

function suffixFor(genre: string): string {
  return genre === "coaching" ? "_COACHING" : genre === "sales" ? "_SALES" : "";
}

// 環境変数の対応：
//   realestate: THREADS_USER_ID / THREADS_ACCESS_TOKEN
//   coaching:   THREADS_USER_ID_COACHING / THREADS_ACCESS_TOKEN_COACHING
//   sales:      THREADS_USER_ID_SALES / THREADS_ACCESS_TOKEN_SALES
function envCredsFor(genre: string): ThreadsCreds | null {
  const suffix = suffixFor(genre);
  const token = process.env[`THREADS_ACCESS_TOKEN${suffix}`];
  if (!token) return null;
  // THREADS_USER_ID は任意。未設定ならユーザートークンで解決できる "me" を使う
  // （Threads API は /me/threads を受け付けるため、トークンだけで投稿できる）
  const userId = process.env[`THREADS_USER_ID${suffix}`] || "me";
  return { userId, token };
}

// 長期トークンは60日で失効するため、自動延長した最新トークンを Supabase の threads_tokens に保存している。
// 環境変数のトークンを貼り替えた場合（seed_token と不一致）は、環境変数側を正とする。
async function credsFor(genre: string): Promise<ThreadsCreds | null> {
  const env = envCredsFor(genre);
  if (!env) return null;
  const sb = getSupabase();
  if (!sb) return env;
  const { data } = await sb.from("threads_tokens").select("token, seed_token").eq("genre", genre).maybeSingle();
  if (data?.token && data.seed_token === env.token) return { ...env, token: data.token };
  return env;
}

export function threadsConfigured(genre = "realestate"): boolean {
  return envCredsFor(genre) !== null;
}

// 長期トークンの有効期限を延ばす（発行から24時間以上・失効前なら何度でも延長可、延長後また60日有効）。
// 朝のCronから毎日呼ぶが、実際にAPIを叩くのは前回延長から7日以上経った時だけ。
export async function refreshThreadsTokens(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return { skipped: "Supabase未設定" };
  const results: Record<string, string> = {};
  for (const genre of ["realestate", "coaching", "sales"]) {
    const env = envCredsFor(genre);
    if (!env) continue;
    try {
      const { data, error } = await sb.from("threads_tokens").select("token, seed_token, refreshed_at").eq("genre", genre).maybeSingle();
      if (error) throw new Error(error.message);
      const current = data?.seed_token === env.token ? data : null;
      const age = current ? Date.now() - new Date(current.refreshed_at).getTime() : Infinity;
      if (age < 7 * 24 * 60 * 60 * 1000) { results[genre] = "延長不要"; continue; }
      const token = current?.token ?? env.token;
      const res = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`);
      const json = await res.json();
      if (!json.access_token) throw new Error(json.error?.message ?? "延長失敗");
      const { error: upErr } = await sb.from("threads_tokens").upsert({
        genre, token: json.access_token, seed_token: env.token, refreshed_at: new Date().toISOString(),
      });
      if (upErr) throw new Error(upErr.message);
      results[genre] = `延長OK（残り${Math.round((json.expires_in ?? 0) / 86400)}日）`;
    } catch (e) {
      results[genre] = `エラー: ${e instanceof Error ? e.message : "failed"}`;
    }
  }
  return results;
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
  const creds = await credsFor(genre);
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
