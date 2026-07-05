"use client";

import { useState, useEffect } from "react";
import { Spinner } from "./StudioShared";
import type { DashboardData } from "@/lib/studio-types";

// ── Dashboard Tab ─────────────────────────────────────────────────────
// 数値がカウントアップするフック
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function FollowerChart({ history }: { history: { followers: number; created_at: string }[] }) {
  if (history.length < 2) return <p className="text-xs text-[#9ba0b8] py-6 text-center">データが2日分以上たまるとグラフが表示されます</p>;
  const W = 600, H = 160, PAD = 10;
  const vals = history.map(h => h.followers);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = Math.max(1, max - min);
  const xy = (h: { followers: number }, i: number) => ({
    x: PAD + (i / (history.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((h.followers - min) / range) * (H - PAD * 2),
  });
  const pts = history.map((h, i) => { const { x, y } = xy(h, i); return `${x},${y}`; }).join(" ");
  const first = xy(history[0], 0), last = xy(history[history.length - 1], history.length - 1);
  const areaPts = `${first.x},${H - PAD} ${pts} ${last.x},${H - PAD}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b6cff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#5b6cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill="url(#areaGrad)" className="fade-area" />
      <polyline points={pts} fill="none" stroke="#5b6cff" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="draw-line" />
      {history.map((h, i) => {
        const { x, y } = xy(h, i);
        return (
          <circle key={i} cx={x} cy={y} r="4" fill="#5b6cff" className="hover:opacity-70 cursor-pointer">
            <title>{`${new Date(h.created_at).toLocaleDateString("ja-JP")}：${h.followers.toLocaleString()}人`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export default function DashboardTab() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard").then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8"><Spinner label="読み込み中…" /></div>;

  if (!data?.connected) {
    return (
      <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-8 max-w-2xl">
        <div className="text-4xl mb-4">📈</div>
        <h2 className="text-lg font-bold text-[#171c33] mb-2">Instagram連携でダッシュボードが有効になります</h2>
        <p className="text-sm text-[#5a6080] mb-6 leading-relaxed">
          連携すると：フォロワー推移の自動記録 / 1万人達成日の予測 / 投稿ごとの再生・保存数の自動取得 / AIが実測データから学習してネタ精度が上がる
        </p>
        <div className="border border-[#e3e5ef] bg-white rounded-2xl p-5 space-y-4 text-sm text-[#2a3052]">
          <p className="font-bold text-[#5b6cff]">セットアップ手順（約10分）</p>
          <ol className="list-decimal list-inside space-y-2 leading-relaxed">
            <li>Instagramアプリ → 設定 → 「プロアカウントに切り替え」（無料）</li>
            <li>Facebookページを作成し、Instagramと連携（Meta Business Suite）</li>
            <li>developers.facebook.com でアプリ作成 → Graph API Explorer でアクセストークン取得</li>
            <li>VercelにIG_USER_ID / IG_ACCESS_TOKENを環境変数として追加</li>
            <li>Redeploy</li>
          </ol>
          <p className="text-xs text-[#7b809c]">詳しい手順はチャットで「Instagram連携の手順を教えて」と聞いてください</p>
        </div>
      </div>
    );
  }

  return <DashboardBody data={data} />;
}

function DashboardBody({ data }: { data: DashboardData }) {
  const current = data.current ?? 0;
  const goal = data.goal ?? 10000;
  const pct = Math.min(100, (current / goal) * 100);
  const animated = useCountUp(current);
  const [barPct, setBarPct] = useState(0);
  useEffect(() => { const t = setTimeout(() => setBarPct(pct), 150); return () => clearTimeout(t); }, [pct]);
  const daysLeft = data.projectedDate
    ? Math.max(0, Math.ceil((new Date(data.projectedDate).getTime() - Date.now()) / 86400000))
    : null;
  const maxViews = Math.max(1, ...(data.media ?? []).map(m => m.views ?? 0));

  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-6">
      {/* 1万人ゴール */}
      <div className="border border-[#5b6cff]/40 bg-[#5b6cff]/10 rounded-2xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <p className="text-xs text-[#7b809c] mb-1">現在のフォロワー</p>
            <p className="text-3xl font-black text-[#5b6cff]">{animated.toLocaleString()}<span className="text-sm text-[#7b809c] font-normal ml-2">/ {goal.toLocaleString()}人</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[#7b809c]">1日平均 <span className="text-green-600 font-bold">+{data.dailyGrowth ?? 0}</span></p>
            {data.projectedDate && (
              <p className="text-xs text-[#5a6080] mt-1">📅 達成予測：<span className="text-[#5b6cff] font-bold">{new Date(data.projectedDate).toLocaleDateString("ja-JP")}</span>
                {daysLeft !== null && <span className="ml-1.5 text-[#5b6cff] font-bold">あと{daysLeft}日</span>}</p>
            )}
          </div>
        </div>
        <div className="h-2.5 bg-[#f1f2f7] rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-[#5b6cff] to-[#8b96ff] rounded-full transition-all duration-1000 ease-out" style={{ width: `${barPct}%` }} />
        </div>
        <p className="text-xs text-[#9ba0b8] mt-1.5">{pct.toFixed(1)}% 達成</p>
      </div>

      {/* フォロワー推移 */}
      <div className="border border-[#e3e5ef] bg-white rounded-2xl p-5">
        <p className="text-sm font-bold text-[#1e2440] mb-2">📈 フォロワー推移</p>
        <FollowerChart history={data.history ?? []} />
      </div>

      {/* 投稿パフォーマンス */}
      <div className="border border-[#e3e5ef] bg-white rounded-2xl p-5">
        <p className="text-sm font-bold text-[#1e2440] mb-3">🎬 投稿パフォーマンス（自動取得）</p>
        {(data.media ?? []).length === 0 ? (
          <p className="text-xs text-[#9ba0b8] py-4 text-center">明朝の自動取得後に表示されます</p>
        ) : (
          <div className="space-y-2">
            {(data.media ?? []).map(m => (
              <div key={m.id} className="relative overflow-hidden flex flex-wrap items-center gap-x-4 gap-y-1 border border-[#e3e5ef] rounded-xl px-4 py-3">
                <div className="absolute inset-y-0 left-0 bg-[#5b6cff]/10 transition-all duration-700" style={{ width: `${((m.views ?? 0) / maxViews) * 100}%` }} />
                <a href={m.permalink ?? "#"} target="_blank" rel="noopener noreferrer"
                  className="flex-1 min-w-[180px] text-xs text-[#2a3052] hover:text-[#5b6cff] truncate transition-colors">
                  {(m.caption ?? "（キャプションなし）").slice(0, 40)}
                </a>
                <span className="text-xs text-[#7b809c]">▶ {m.views?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-[#7b809c]">📌 {m.saves?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-[#7b809c]">❤️ {m.likes?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-[#9ba0b8]">{m.posted_at ? new Date(m.posted_at).toLocaleDateString("ja-JP") : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
