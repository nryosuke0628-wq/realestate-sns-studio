import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 朝の定期処理をまとめて実行（Vercel無料枠のCron上限2本対策）
// 1. トレンド収集 → 2. Instagramインサイト取得
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const origin = request.nextUrl.origin;
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers["authorization"] = `Bearer ${process.env.CRON_SECRET}`;

  const results: Record<string, unknown> = {};
  try {
    const trendRes = await fetch(`${origin}/api/cron/trend`, { headers });
    results.trend = await trendRes.json();
  } catch (e) {
    results.trend = { error: e instanceof Error ? e.message : "failed" };
  }
  try {
    const insightsRes = await fetch(`${origin}/api/cron/insights`, { headers });
    results.insights = await insightsRes.json();
  } catch (e) {
    results.insights = { error: e instanceof Error ? e.message : "failed" };
  }

  return NextResponse.json(results);
}
