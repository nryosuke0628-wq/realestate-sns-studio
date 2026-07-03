import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { igConfigured } from "@/lib/instagram";

export const dynamic = "force-dynamic";

const GOAL = 10000;

export async function GET() {
  const supabase = getSupabase();
  if (!supabase || !igConfigured()) {
    return NextResponse.json({ connected: false });
  }

  try {
    const [statsRes, mediaRes] = await Promise.all([
      supabase.from("ig_stats").select("followers, created_at").order("created_at", { ascending: true }).limit(90),
      supabase.from("ig_media").select("*").order("posted_at", { ascending: false }).limit(20),
    ]);

    const stats = statsRes.data ?? [];
    const media = mediaRes.data ?? [];

    const current = stats.length > 0 ? stats[stats.length - 1].followers : 0;

    // 直近7日間の平均増加ペースから1万人達成日を予測
    let dailyGrowth = 0;
    let projectedDate: string | null = null;
    if (stats.length >= 2) {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recent = stats.filter(s => new Date(s.created_at).getTime() >= weekAgo);
      const base = recent.length >= 2 ? recent : stats;
      const first = base[0], last = base[base.length - 1];
      const days = Math.max(1, (new Date(last.created_at).getTime() - new Date(first.created_at).getTime()) / 86400000);
      dailyGrowth = (last.followers - first.followers) / days;
      if (dailyGrowth > 0 && current < GOAL) {
        const daysLeft = Math.ceil((GOAL - current) / dailyGrowth);
        projectedDate = new Date(Date.now() + daysLeft * 86400000).toISOString();
      }
    }

    return NextResponse.json({
      connected: true,
      goal: GOAL,
      current,
      dailyGrowth: Math.round(dailyGrowth * 10) / 10,
      projectedDate,
      history: stats,
      media,
    });
  } catch {
    return NextResponse.json({ connected: false });
  }
}
