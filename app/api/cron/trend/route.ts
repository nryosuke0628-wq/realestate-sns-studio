import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { getSupabase } from "@/lib/supabase";
import { DEBATE_PROMPTS } from "@/lib/agents-debate";

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function searchWeb(query: string, domains?: string[]): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
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

export async function GET(request: NextRequest) {
  // Vercel Cronからの呼び出しを検証（CRON_SECRET設定時のみ）
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase未設定（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）" }, { status: 500 });
  }

  try {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const queries: { q: string; domains?: string[] }[] = [
      { q: `不動産 リール 賃貸 マイホーム 内見`, domains: ["instagram.com"] },
      { q: `不動産 宅建 住宅ローン 一人暮らし reel`, domains: ["instagram.com"] },
      { q: `${year}年${month}月 不動産 ニュース 住宅ローン 金利 市況` },
    ];
    const allResults = await Promise.all(queries.map(({ q, domains }) => searchWeb(q, domains)));
    const results = allResults.filter(Boolean).join("\n\n");

    const today = new Date();
    const systemPrompt =
      `【最重要】今日は${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日です。「現在」「今」「最新」と書く場合は必ずこの年月を使うこと。\n\n` +
      DEBATE_PROMPTS.trend_collect +
      (results ? `\n\n【リアルタイム検索結果】\n${results}` : "");

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: "user", content: "実行してください" }],
    });
    const report = response.content[0].type === "text" ? response.content[0].text : "";

    const { error } = await supabase.from("trend_reports").insert({ report });
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, length: report.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "トレンド収集に失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
