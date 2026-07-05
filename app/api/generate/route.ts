import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { DEBATE_PROMPTS } from "@/lib/agents-debate";
import { COACHING_PROMPTS } from "@/lib/agents-coaching";
import { AI_PROMPTS } from "@/lib/agents-ai";
import { getSupabase } from "@/lib/supabase";

export const maxDuration = 60; // Vercel Pro: 60s, Hobby: 10s

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const NEWS_PROMPT = `あなたは不動産Instagram運用のプロフェッショナルです。Web検索で今日の時事ニュースを収集し、不動産テーマと掛け合わせた投稿案を3つ生成してください。

## 【今日の時事ネタ×不動産 投稿案】

━━━━━━━━━━━━━━
### 案①
**時事ネタ**：〇〇（出典：〇〇）
**不動産との掛け合わせ**：〇〇
**ターゲット**：購入層 / 売却層
**Reelsフック**：「〇〇」
**Threads投稿1**：〇〇
**Threads投稿2**：〇〇
**Threads投稿3（CTA）**：〇〇
━━━━━━━━━━━━━━
### 案②（同形式）
━━━━━━━━━━━━━━
### 案③（同形式）

日本語で出力。`;

const BUZZ_ANALYZE_PROMPT = `あなたは不動産Instagram運用のプロフェッショナルです。ユーザーが貼り付けたバズ投稿を分析してください。

## 📊 バズ投稿分析
**フックパターン**：〇〇
**構成**：〇〇
**効いた言葉・表現**：〇〇
**ターゲット**：〇〇
**なぜバズったか**：〇〇

---
## 🎯 自分のアカウント用に転用するなら
**タイトル案**：〇〇
**フック案**：「〇〇」
**撮影イメージ**：〇〇（1人トーク形式）
**本文構成案**：
・〇〇
・〇〇
・〇〇

日本語で出力。`;

const DATA_ANALYZE_PROMPT = `あなたは不動産Instagram専門のSNSアナリストです。数値データを分析し具体的な改善提案を出してください。

## 📈 アカウント分析レポート
**エンゲージメント率**：〇〇%（業界平均比：〇〇）
**現状の強み**：〇〇
**改善ポイント**：〇〇

---
## 📊 直近5投稿の傾向
- **最もパフォーマンスが高い投稿の特徴**：〇〇
- **伸び悩んでいる投稿の共通点**：〇〇

---
## 🚀 次の一手（具体的なアクション）
1. 〇〇
2. 〇〇
3. 〇〇

日本語で出力。`;

async function searchWeb(query: string, domains?: string[]): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    const search = client.search(query, {
      maxResults: 3,
      searchDepth: "basic",
      ...(domains ? { includeDomains: domains } : {}),
    });
    const result = await Promise.race([search, timeout]);
    if (!result) return "";
    return result.results.map((r) => `● ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 400)}`).join("\n\n");
  } catch { return ""; }
}

// 入力内のURLから本文取得を試みる（viral_convert用）。Instagramは取得不可のことが多い
async function extractUrlContents(input: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  const urls = (input.match(/https?:\/\/[^\s)）」】、。]+/g) ?? []).slice(0, 3);
  if (urls.length === 0) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
    const result = await Promise.race([client.extract(urls), timeout]);
    if (!result || !("results" in result)) return "";
    return result.results
      .filter(r => r.rawContent)
      .map(r => `● ${r.url}\n${String(r.rawContent).slice(0, 800)}`)
      .join("\n\n");
  } catch { return ""; }
}

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// 複数クエリを並列検索して情報量を増やす（並列なので所要時間は1クエリ分）
// 参考投稿はInstagramドメイン限定で検索し、note等の記事URLが混ざるのを防ぐ
const SEARCH_MAP: Record<string, { q: string; domains?: string[] }[]> = {
  trend_collect: [
    { q: `不動産 リール バズった 再生数 万回 分析`, domains: ["instagram.com"] },
    { q: `不動産 リール TikTok バズ 再生回数 万 事例 ${currentYear}年` },
    { q: `${currentYear}年${currentMonth}月 不動産 ニュース 住宅ローン 金利 市況` },
  ],
  // コーチングジャンル用トレンド検索
  trend_collect_coaching: [
    { q: `自己啓発 マインドセット リール バズ 再生数 万`, domains: ["instagram.com"] },
    { q: `コーチング 習慣化 TikTok ショート動画 バズった 再生回数 ${currentYear}年` },
    { q: `${currentYear}年 自己啓発 トレンド テーマ 人気` },
  ],
  // AI活用ジャンル用トレンド検索
  trend_collect_ai: [
    { q: `ChatGPT AI活用 リール バズ 再生数 万`, domains: ["instagram.com"] },
    { q: `生成AI 活用術 TikTok ショート動画 バズった 再生回数 ${currentYear}年` },
    { q: `${currentYear}年${currentMonth}月 生成AI ニュース 新機能 話題` },
  ],
  // 今日の3案（ジャンル別に鮮度の高い検索を注入）
  daily_picks: [
    { q: `不動産 リール バズった 再生数 万回`, domains: ["instagram.com"] },
    { q: `${currentYear}年${currentMonth}月 不動産 ニュース 住宅ローン 金利` },
  ],
  daily_picks_coaching: [
    { q: `自己啓発 マインドセット リール バズ 再生数 万`, domains: ["instagram.com"] },
    { q: `${currentYear}年 自己啓発 習慣化 トレンド テーマ` },
  ],
  daily_picks_ai: [
    { q: `ChatGPT AI活用 リール バズ 再生数 万`, domains: ["instagram.com"] },
    { q: `${currentYear}年${currentMonth}月 生成AI ニュース 新機能 話題` },
  ],
  // ジャンル不問のバズ収集（バズ逆算モード用）
  viral_collect: [
    { q: `TikTok リール バズった動画 再生数 万回 トーク 分析 ${currentYear}年` },
    { q: `ショート動画 バズ 事例 再生回数 100万 フック 構成` },
    { q: `Instagram リール 伸びた 投稿 分析 再生数`, domains: ["instagram.com"] },
  ],
  news_realestate: [
    { q: `${currentYear}年${currentMonth}月 最新ニュース 不動産 住宅ローン 金利` },
    { q: `${currentYear}年${currentMonth}月 話題 ニュース トレンド` },
  ],
};

export async function POST(request: NextRequest) {
  try {
    const { feature, input, options, genre } = await request.json();
    if (!feature) return NextResponse.json({ error: "feature required" }, { status: 400 });

    // ジャンル切替：コーチング/AIは専用人格で上書き（無いキーは共通にフォールバック）
    const promptMap: Record<string, string> = {
      ...DEBATE_PROMPTS,
      ...(genre === "coaching" ? COACHING_PROMPTS : genre === "ai" ? AI_PROMPTS : {}),
      news_realestate: NEWS_PROMPT,
      buzz_analyze: BUZZ_ANALYZE_PROMPT,
      data_analyze: DATA_ANALYZE_PROMPT,
    };

    const today = new Date();
    let systemPrompt = `【最重要】今日は${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日です。「現在」「今」「最新」と書く場合は必ずこの年月を使うこと。学習データ上の古い日付（2025年など）を「現在」として書くことを禁止します。\n\n` + (promptMap[feature] ?? DEBATE_PROMPTS.trend_collect);

    // バズ逆算モード：貼られたURLの本文取得を試みる
    if (feature === "viral_convert" && typeof input === "string" && input.includes("http")) {
      const extracted = await extractUrlContents(input);
      if (extracted) {
        systemPrompt += `\n\n【URLから取得できた内容】\n${extracted}`;
      } else {
        systemPrompt += `\n\n【注意】URLの中身は取得できなかった。ユーザーが書いた説明文と、URLから分かる情報のみを使うこと。取得できなかったことを出力の冒頭で正直に一言伝え、内容の推測で投稿を「見たかのように」語ることは禁止。`;
      }
    }

    // ジャンル専用の検索クエリがあればそちらを使う（例: trend_collect_coaching / daily_picks_ai）
    const searchKey = SEARCH_MAP[`${feature}_${genre}`] ? `${feature}_${genre}` : feature;
    if (SEARCH_MAP[searchKey]) {
      const allResults = await Promise.all(SEARCH_MAP[searchKey].map(({ q, domains }) => searchWeb(q, domains)));
      const results = allResults.filter(Boolean).join("\n\n");
      if (results) systemPrompt += `\n\n【リアルタイム検索結果】\n${results}`;
    }

    if (options && Object.keys(options).length > 0) {
      systemPrompt += `\n\n【条件】${JSON.stringify(options)}`;
    }

    // 📦 リサーチ銀行：直近2週間の実測リサーチをネタ系生成に自動注入
    if (feature === "idea_gen" || feature === "viral_convert" || feature === "weekly_plan" || feature === "daily_picks") {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
          const { data } = await supabase
            .from("research_bank")
            .select("content, source, created_at")
            .eq("genre", genre === "coaching" || genre === "ai" ? genre : "realestate")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(6);
          if (data && data.length > 0) {
            const lines = data.map(r => `・${r.content}${r.source ? `（出典: ${r.source}）` : ""}`).join("\n");
            systemPrompt += `\n\n【リサーチ銀行（実際に確認済みのバズ投稿データ・最優先の参考元）】\n${lines}\n※このデータは実測値なので、検索結果より優先して参考にすること`;
          }
        } catch { /* リサーチ銀行が未設定でも生成は続行 */ }
      }
    }

    // ネタ案・週間プラン・今日の3案生成時は、実際のInstagramインサイト（保存数上位）を学習材料に加える
    if (feature === "idea_gen" || feature === "weekly_plan" || feature === "daily_picks") {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data } = await supabase
            .from("ig_media")
            .select("caption, views, saves, likes")
            .order("saves", { ascending: false, nullsFirst: false })
            .limit(5);
          if (data && data.length > 0) {
            const lines = data.map(m =>
              `・「${(m.caption ?? "").slice(0, 50)}」 再生${m.views ?? "?"} 保存${m.saves ?? "?"} いいね${m.likes ?? "?"}`
            ).join("\n");
            systemPrompt += `\n\n【自アカウントの実測インサイト（保存数上位）】\n${lines}\n※保存数が多い投稿のテーマ・切り口の傾向を分析し、ネタ選定に反映すること`;
          }
        } catch { /* インサイト未取得でも生成は続行 */ }
      }
    }

    const MAX_TOKENS: Record<string, number> = {
      trend_collect: 1000,
      idea_gen: 2000,
      script_draft: 1800,
      realestate_expert: 1200,
      sns_consultant: 1200,
      script_revision: 1800,
      final_script: 2000,
      threads_master: 1500,
      weekly_plan: 2500,
      caption_gen: 800,
      translate_captions: 1500,
      user_revision: 2000,
      viral_collect: 1200,
      viral_convert: 2000,
      daily_picks: 1800,
    };

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: MAX_TOKENS[feature] ?? 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: input || "実行してください" }],
    });

    const reply = response.content[0].type === "text" ? response.content[0].text : "";
    return NextResponse.json({ reply });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}
