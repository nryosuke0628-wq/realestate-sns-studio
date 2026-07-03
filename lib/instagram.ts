// Instagram Graph API ヘルパー
// 必要な環境変数: IG_USER_ID（InstagramビジネスアカウントのID）, IG_ACCESS_TOKEN（長期アクセストークン）

const BASE = "https://graph.facebook.com/v21.0";

export function igConfigured(): boolean {
  return !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN);
}

export interface IgAccount {
  followers: number;
  following: number | null;
  mediaCount: number | null;
}

export interface IgMedia {
  id: string;
  caption: string;
  media_type: string;
  permalink: string;
  timestamp: string;
  likes: number | null;
  comments: number | null;
  views: number | null;
  reach: number | null;
  saves: number | null;
  shares: number | null;
}

async function igFetch(path: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}access_token=${process.env.IG_ACCESS_TOKEN}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "Instagram APIエラー");
  return data;
}

export async function fetchAccount(): Promise<IgAccount> {
  const data = await igFetch(`/${process.env.IG_USER_ID}?fields=followers_count,follows_count,media_count`);
  return {
    followers: Number(data.followers_count ?? 0),
    following: data.follows_count != null ? Number(data.follows_count) : null,
    mediaCount: data.media_count != null ? Number(data.media_count) : null,
  };
}

// メディア単体のインサイト。リールと画像でメトリクス名が違うため段階的にフォールバック
async function fetchInsights(mediaId: string): Promise<Partial<IgMedia>> {
  const metricSets = [
    "views,reach,saved,shares",
    "plays,reach,saved,shares",
    "impressions,reach,saved",
  ];
  for (const metrics of metricSets) {
    try {
      const data = await igFetch(`/${mediaId}/insights?metric=${metrics}`);
      const out: Record<string, number> = {};
      for (const m of (data.data as { name: string; values: { value: number }[] }[]) ?? []) {
        out[m.name] = m.values?.[0]?.value ?? 0;
      }
      return {
        views: out.views ?? out.plays ?? out.impressions ?? null,
        reach: out.reach ?? null,
        saves: out.saved ?? null,
        shares: out.shares ?? null,
      };
    } catch { /* 次のメトリクスセットで再試行 */ }
  }
  return {};
}

export async function fetchRecentMediaWithInsights(limit = 15): Promise<IgMedia[]> {
  const data = await igFetch(
    `/${process.env.IG_USER_ID}/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=${limit}`
  );
  const items = (data.data as Record<string, unknown>[]) ?? [];
  const result: IgMedia[] = [];
  for (const m of items) {
    const insights = await fetchInsights(String(m.id));
    result.push({
      id: String(m.id),
      caption: String(m.caption ?? "").slice(0, 200),
      media_type: String(m.media_type ?? ""),
      permalink: String(m.permalink ?? ""),
      timestamp: String(m.timestamp ?? ""),
      likes: m.like_count != null ? Number(m.like_count) : null,
      comments: m.comments_count != null ? Number(m.comments_count) : null,
      views: insights.views ?? null,
      reach: insights.reach ?? null,
      saves: insights.saves ?? null,
      shares: insights.shares ?? null,
    });
  }
  return result;
}
