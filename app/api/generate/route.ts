import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { DEBATE_PROMPTS } from "@/lib/agents-debate";

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
    const result = await client.search(query, { maxResults: 3, searchDepth: "basic" });
    return result.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`).join("\n\n");
  } catch { return ""; }
}

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

const SEARCH_MAP: Record<string, string> = {
  trend_collect: `不動産 Instagram TikTok リール バズ ${currentYear}年${currentMonth}月 最新 再生数`,
  news_realestate: `${currentYear}年${currentMonth}月 最新ニュース 不動産 住宅ローン 金利`,
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

    let systemPrompt = promptMap[feature] ?? DEBATE_PROMPTS.trend_collect;

    if (SEARCH_MAP[feature]) {
      const results = await searchWeb(SEARCH_MAP[feature]);
      if (results) systemPrompt += `\n\n【リアルタイム検索結果】\n${results}`;
    }

    if (options && Object.keys(options).length > 0) {
      systemPrompt += `\n\n【条件】${JSON.stringify(options)}`;
    }

    const MAX_TOKENS: Record<string, number> = {
      trend_collect: 1000,
      idea_gen: 1200,
      script_draft: 1500,
      realestate_expert: 1000,
      sns_consultant: 1000,
      script_revision: 1500,
      final_script: 1800,
      threads_master: 1200,
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
