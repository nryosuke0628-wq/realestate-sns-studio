import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 60;

// 🌙 深夜バッチ：ジャンルごとに「今日の3案→上位案を選定→討論フル実行→
// 台本・キャプション・Threads文案」を完成させ、サーバー側ライブラリに保存する。
// 朝アプリを開くと"pending_review"状態で並んでいる（内容の最終確認はユーザーが行う）。
async function callGenerate(origin: string, feature: string, input: string, genre: string): Promise<string> {
  const res = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": process.env.APP_PASSWORD_SECRET ?? "studio-static-secret-v1",
    },
    body: JSON.stringify({ feature, input, genre }),
  });
  const data = await res.json();
  return data.reply ?? "";
}

function extractBlock(text: string, start: string, end: string): string {
  const s = text.indexOf(start), e = text.indexOf(end);
  if (s === -1 || e === -1) return "";
  return text.slice(s + start.length, e).trim();
}
function parseIdeas(text: string): string[] {
  const s = text.indexOf("IDEA_START") !== -1 ? "IDEA_START" : "PICKS_START";
  const e = text.indexOf("IDEA_END") !== -1 ? "IDEA_END" : "PICKS_END";
  const si = text.indexOf(s), ei = text.indexOf(e);
  if (si === -1 || ei === -1) return [];
  const splitter = s === "IDEA_START" ? "IDEA_SPLIT" : "PICK_SPLIT";
  return text.slice(si + s.length, ei).split(splitter).map(t => t.trim()).filter(Boolean);
}
function parseThreads(text: string): string[] {
  const s = text.indexOf("THREADS_START"), e = text.indexOf("THREADS_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "THREADS_START".length, e).trim().split("THREADS_SPLIT").map(t => t.trim()).filter(Boolean);
}
function extractScore(text: string): number {
  const m = text.match(/スコア[：:]\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}
function titleOf(idea: string): string {
  const m = idea.match(/タイトル[：:]\s*(.+)/);
  return m ? m[1].trim().slice(0, 30) : idea.slice(0, 30).replace(/\n/g, " ");
}

const GENRES = ["realestate", "coaching", "sales"];

export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });

  const origin = request.nextUrl.origin;
  const results: Record<string, unknown> = {};

  // ?genre=xxx なら単ジャンルのみ（Todayタブの「作り直し」用）。指定なしは3ジャンル並列
  const only = request.nextUrl.searchParams.get("genre");
  const genres = only && GENRES.includes(only) ? [only] : GENRES;

  await Promise.all(genres.map(async (genre) => {
    try {
      // ① 今日の3案（リーチ最大化目的で自動選定）
      const picksRes = await callGenerate(origin, "daily_picks", "【今日の目的】リーチ最大化", genre);
      const ideas = parseIdeas(picksRes);
      if (ideas.length === 0) { results[genre] = { skipped: "案生成に失敗" }; return; }
      const best = ideas.reduce((a, b) => (extractScore(b) > extractScore(a) ? b : a));

      // ② 討論フル実行
      const draftRes = await callGenerate(origin, "script_draft", best, genre);
      const draft = extractBlock(draftRes, "SCRIPT_START", "SCRIPT_END") || draftRes;
      const [re1, re2] = await Promise.all([
        callGenerate(origin, "realestate_expert", draft, genre),
        callGenerate(origin, "sns_consultant", draft, genre),
      ]);
      const revCtx = `【初稿台本】\n${draft}\n\n【専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}`;
      const revRes = await callGenerate(origin, "script_revision", revCtx, genre);
      const revised = extractBlock(revRes, "REVISED_START", "REVISED_END") || revRes;
      const finalCtx = `【改訂台本】\n${revised}\n\n【専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}`;
      const finalRes = await callGenerate(origin, "final_script", finalCtx, genre);
      const finalScript = extractBlock(finalRes, "FINAL_START", "FINAL_END") || finalRes;

      // ③ キャプション・Threads
      const [thrRes, capRes] = await Promise.all([
        callGenerate(origin, "threads_master", finalScript, genre),
        callGenerate(origin, "caption_gen", finalScript, genre),
      ]);
      const threads = parseThreads(thrRes);
      const caption = extractBlock(capRes, "CAPTION_START", "CAPTION_END") || capRes;

      // ④ サーバー側ライブラリへ保存（朝の目視確認待ち = pending_review）
      const id = `overnight-${genre}-${Date.now()}`;
      const { error } = await supabase.from("library_items").insert({
        id, genre, title: titleOf(best), script: finalScript, threads, caption,
        status: "pending_review", source: "overnight",
      });
      if (error) throw new Error(error.message);
      results[genre] = { success: true, title: titleOf(best) };
    } catch (e) {
      results[genre] = { error: e instanceof Error ? e.message : "失敗" };
    }
  }));

  return NextResponse.json(results);
}
