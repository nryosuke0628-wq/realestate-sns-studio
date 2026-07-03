import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { DEBATE_PROMPTS } from "@/lib/agents-debate";

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

async function searchWeb(query: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
    const search = client.search(query, { maxResults: 2, searchDepth: "basic" });
    const result = await Promise.race([search, timeout]);
    if (!result) return "";
    return result.results.map((r) => `● ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 400)}`).join("\n\n");
  } catch { return ""; }
}

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// 複数クエリを並列検索して情報量を増やす（並列なので所要時間は1クエリ分）
const SEARCH_MAP: Record<string, string[]> = {
  trend_collect: [
    `不動産 Instagram リール バズ ${currentYear}年${currentMonth}月 再生数 人気`,
    `不動産 TikTok 宅建 一人暮らし 賃貸 バズ動画 ${currentYear}年`,
    `${currentYear}年${currentMonth}月 不動産 ニュース 住宅ローン 金利 市況`,
  ],
  news_realestate: [
    `${currentYear}年${currentMonth}月 最新ニュース 不動産 住宅ローン 金利`,
    `${currentYear}年${currentMonth}月 話題 ニュース トレンド`,
  ],
};

export async function POST(request: NextRequest) {
  try {
    const { feature, input, options } = await request.json();
    if (!feature) return NextResponse.json({ error: "feature required" }, { status: 400 });

    const promptMap: Record<string, string> = {
      ...DEBATE_PROMPTS,
      news_realestate: NEWS_PROMPT,
      buzz_analyze: BUZZ_ANALYZE_PROMPT,
      data_analyze: DATA_ANALYZE_PROMPT,
    };

    const today = new Date();
    let systemPrompt = `【最重要】今日は${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日です。「現在」「今」「最新」と書く場合は必ずこの年月を使うこと。学習データ上の古い日付（2025年など）を「現在」として書くことを禁止します。\n\n` + (promptMap[feature] ?? DEBATE_PROMPTS.trend_collect);

    if (SEARCH_MAP[feature]) {
      const allResults = await Promise.all(SEARCH_MAP[feature].map(q => searchWeb(q)));
      const results = allResults.filter(Boolean).join("\n\n");
      if (results) systemPrompt += `\n\n【リアルタイム検索結果】\n${results}`;
    }

    if (options && Object.keys(options).length > 0) {
      systemPrompt += `\n\n【条件】${JSON.stringify(options)}`;
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
