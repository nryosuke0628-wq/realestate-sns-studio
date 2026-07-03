import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { igConfigured, fetchAccount, fetchRecentMediaWithInsights } from "@/lib/instagram";

export const maxDuration = 60;

// 毎日実行：フォロワー数の推移と各投稿のインサイトをSupabaseに蓄積
export async function GET(request: NextRequest) {
  if (process.env.CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  if (!igConfigured()) return NextResponse.json({ error: "Instagram未連携（IG_USER_ID / IG_ACCESS_TOKEN）" }, { status: 500 });

  try {
    const account = await fetchAccount();
    const { error: statsError } = await supabase.from("ig_stats").insert({
      followers: account.followers,
      following: account.following,
      media_count: account.mediaCount,
    });
    if (statsError) throw new Error(statsError.message);

    const media = await fetchRecentMediaWithInsights(15);
    if (media.length > 0) {
      const { error: mediaError } = await supabase.from("ig_media").upsert(
        media.map(m => ({
          id: m.id,
          caption: m.caption,
          media_type: m.media_type,
          permalink: m.permalink,
          posted_at: m.timestamp || null,
          likes: m.likes,
          comments: m.comments,
          views: m.views,
          reach: m.reach,
          saves: m.saves,
          shares: m.shares,
          updated_at: new Date().toISOString(),
        }))
      );
      if (mediaError) throw new Error(mediaError.message);
    }

    return NextResponse.json({ success: true, followers: account.followers, mediaUpdated: media.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "インサイト取得に失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
