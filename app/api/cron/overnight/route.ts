import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { appSecret } from "@/lib/secret";

export const maxDuration = 300; // 討論フルパイプライン（AI呼び出し7回）は60秒を超えるため

// 🌙 深夜バッチ：ジャンルごとに「今日の3案→上位案を選定→討論フル実行→
// 台本・キャプション・Threads文案」を完成させ、サーバー側ライブラリに保存する。
// 朝アプリを開くと"pending_review"状態で並んでいる（内容の最終確認はユーザーが行う）。
async function callGenerate(origin: string, feature: string, input: string, genre: string): Promise<string> {
  const res = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-key": await appSecret(),
    },
    body: JSON.stringify({ feature, input, genre }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`${feature}: ${data.error}`);
  const reply = data.reply ?? "";
  if (!reply.trim()) throw new Error(`${feature}: 応答が空でした`);
  return reply;
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

  // ?genre=xxx なら単ジャンルのみ（作り直し用）。指定なしは3ジャンル並列
  const only = request.nextUrl.searchParams.get("genre");
  const genres = only && GENRES.includes(only) ? [only] : GENRES;
  // ?mode=video で従来の動画台本パイプライン。デフォルトはThreads投稿案（当面のメイン運用）
  const mode = request.nextUrl.searchParams.get("mode") === "video" ? "video" : "threads";
  // ✏️ 修正指示付き作り直し（Threadsモードのみ）
  const instruction = request.nextUrl.searchParams.get("instruction") ?? "";
  // auto=1: 承認をスキップして自動投稿キューへ直行（完全自動運用）／count=2: テーマ違いで2本生成
  const auto = request.nextUrl.searchParams.get("auto") === "1";
  const count = request.nextUrl.searchParams.get("count") === "2" ? 2 : 1;

  await Promise.all(genres.map(async (genre) => {
    try {
      if (mode === "threads") {
        // 🧵 Threads投稿案の生成（ニュース→バズ型→エビデンス付き連投）。count=2ならテーマ違いで2本
        const titles: string[] = [];
        for (let k = 0; k < count; k++) {
          let input = instruction
            ? `【修正指示】${instruction}\n今日のThreads連投を作成してください`
            : "今日のThreads連投を作成してください";
          if (k === 1) {
            input += `\n【重要】1本目「${titles[0] ?? ""}」とはテーマも型も変えること。1本目がニュース便乗なら2本目は普遍ネタ（あるある・逆張り・リスト型など）にする`;
          }
          const reply = await callGenerate(origin, "threads_daily", input, genre);
          const posts = parseThreads(reply);
          if (posts.length === 0) throw new Error("投稿の解析に失敗（THREADSマーカーなし）");
          const evMatch = reply.match(/EVIDENCE[：:]\s*([\s\S]*?)(?:\n\n|$)/);
          const evidence = evMatch ? evMatch[1].trim() : "📰 参考：記載なし";
          const firstLine = posts[0].replace(/^【投稿\d+[^】]*】\n?/, "").split("\n").find(l => l.trim()) ?? "Threads投稿";
          titles.push(firstLine.slice(0, 40));

          if (auto) {
            // 完全自動：承認なしで投稿キューへ直行（8時・19時のCronが1本ずつ投稿）
            const { error } = await supabase.from("threads_queue").insert({
              title: firstLine.slice(0, 40), posts, genre, status: "pending",
            });
            if (error) throw new Error(error.message);
          } else {
            const id = `threads-${genre}-${Date.now()}-${k}`;
            const { error } = await supabase.from("library_items").insert({
              id, genre, title: firstLine.slice(0, 40), script: reply,
              threads: posts, caption: evidence,
              status: "pending_review", source: "threads_daily",
            });
            if (error) throw new Error(error.message);
          }
        }
        results[genre] = { success: true, mode: "threads", auto, titles };
        return;
      }
      // ① 今日の3案（リーチ最大化目的で自動選定）。フォーマット揺れは1回リトライ
      let picksRes = await callGenerate(origin, "daily_picks", "【今日の目的】リーチ最大化", genre);
      let ideas = parseIdeas(picksRes);
      if (ideas.length === 0) {
        picksRes = await callGenerate(origin, "daily_picks", "【今日の目的】リーチ最大化\n※必ずPICKS_START〜PICKS_ENDマーカーで出力すること", genre);
        ideas = parseIdeas(picksRes);
      }
      if (ideas.length === 0) { results[genre] = { skipped: "案生成に失敗（2回試行）" }; return; }
      const best = ideas.reduce((a, b) => (extractScore(b) > extractScore(a) ? b : a));

      // ② 討論フル実行
      const draftRes = await callGenerate(origin, "script_draft", best, genre);
      const draft = extractBlock(draftRes, "SCRIPT_START", "SCRIPT_END") || draftRes;
      const [re1, re2] = await Promise.all([
        callGenerate(origin, "realestate_expert", draft, genre),
        callGenerate(origin, "sns_consultant", draft, genre),
      ]);
      // 深夜バッチは改訂ステップを省略し、レビュー指摘を最終台本に直接反映（実行時間短縮）
      const finalCtx = `【初稿台本】\n${draft}\n\n【専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}\n\n※上記レビューの指摘を全て反映して最終台本を仕上げること`;
      const finalRes = await callGenerate(origin, "final_script", finalCtx, genre);
      const finalScript = extractBlock(finalRes, "FINAL_START", "FINAL_END") || finalRes;

      // ③ キャプション・Threads
      const [thrRes, capRes] = await Promise.all([
        callGenerate(origin, "threads_master", finalScript, genre),
        callGenerate(origin, "caption_gen", finalScript, genre),
      ]);
      const threads = parseThreads(thrRes);
      const caption = extractBlock(capRes, "CAPTION_START", "CAPTION_END") || capRes;

      if (finalScript.trim().length < 100) throw new Error("最終台本が短すぎるため破棄（生成失敗の可能性）");

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
