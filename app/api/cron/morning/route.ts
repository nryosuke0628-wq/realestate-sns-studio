import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300; // trend+insights+overnightを直列実行するため

// 朝の定期処理をまとめて実行（Vercel無料枠のCron上限2本対策）
// 1. トレンド収集 → 2. Instagramインサイト取得 → 3. 深夜台本生成（今日の3案フル討論）
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
  try {
    // 完全自動運用：2本生成→1本目は即時投稿（朝8時）、2本目はキュー経由で19時に自動投稿
    const overnightRes = await fetch(`${origin}/api/cron/overnight?auto=1&count=2&post_first=1`, { headers });
    results.overnight = await overnightRes.json();
  } catch (e) {
    results.overnight = { error: e instanceof Error ? e.message : "failed" };
  }

  return NextResponse.json(results);
}
