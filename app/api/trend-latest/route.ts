import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 直近24時間以内に自動収集されたトレンドレポートを返す（なければ null）
export async function GET() {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ report: null });

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("trend_reports")
      .select("report, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    return NextResponse.json({
      report: data?.[0]?.report ?? null,
      createdAt: data?.[0]?.created_at ?? null,
    });
  } catch {
    return NextResponse.json({ report: null });
  }
}
