"use client";

import { useState, useEffect } from "react";
import { LinkedText, Spinner } from "./StudioShared";
import type { WeeklyPlan } from "@/lib/studio-types";
import {
  callAPI, buildPerfContext, fetchLatestTrend, parsePlan,
  loadWeeklyPlan, saveWeeklyPlan, createSessionFromIdea,
} from "@/lib/studio-storage";

// ── Weekly Plan Tab ───────────────────────────────────────────────────
export default function WeeklyTab({ goScript }: { goScript: () => void }) {
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const [trendInfo, setTrendInfo] = useState<"cron" | "live" | null>(null);

  useEffect(() => { setPlan(loadWeeklyPlan()); }, []);

  const generate = async () => {
    setLoading(true);
    setLabel("🌐 トレンドを確認中…");
    let trend = await fetchLatestTrend();
    if (trend) {
      setTrendInfo("cron");
    } else {
      setLabel("🌐 トレンドを収集中…");
      trend = await callAPI("trend_collect");
      setTrendInfo("live");
    }

    setLabel("📅 今週の投稿プラン5本分を生成中…");
    const res = await callAPI("weekly_plan", trend + buildPerfContext());
    const days = parsePlan(res);
    const newPlan: WeeklyPlan = { createdAt: Date.now(), days };
    setPlan(newPlan);
    saveWeeklyPlan(newPlan);
    setLoading(false);
    setLabel("");
  };

  const makeScript = (i: number) => {
    if (!plan) return;
    createSessionFromIdea(plan.days[i].idea);
    const updated = { ...plan, days: plan.days.map((d, j) => j === i ? { ...d, scripted: true } : d) };
    setPlan(updated);
    saveWeeklyPlan(updated);
    goScript();
  };

  return (
    <div className="h-full overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button onClick={generate} disabled={loading}
          className="px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">
          {loading ? "生成中…" : plan ? "📅 プランを作り直す" : "📅 今週のプランを生成"}
        </button>
        {plan && !loading && (
          <span className="text-xs text-[#7b809c]">
            {new Date(plan.createdAt).toLocaleDateString("ja-JP")} 生成
            {trendInfo === "cron" && " ・今朝の自動収集トレンド使用"}
          </span>
        )}
      </div>

      {loading && (
        <div className="bg-white border border-[#e3e5ef] rounded-xl p-4 max-w-md">
          <Spinner label={label} />
        </div>
      )}

      {!loading && !plan && (
        <div className="text-center py-20 text-[#9ba0b8]">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-sm">今週撮る5本分の投稿プランを一括生成します<br />各ネタは「台本化」ボタンでそのまま台本になります</p>
        </div>
      )}

      {!loading && plan && (
        <div className="stagger grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plan.days.map((d, i) => (
            <div key={i} className={`border rounded-2xl p-4 flex flex-col gap-3 ${d.scripted ? "border-green-300 bg-green-50" : "border-[#d6d9e6] bg-white"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#5b6cff]">{d.day || `${i + 1}本目`}</span>
                {d.scripted && <span className="text-xs text-green-600">✅ 台本化済み</span>}
              </div>
              <LinkedText text={d.idea} className="text-xs text-[#2a3052] whitespace-pre-wrap leading-relaxed flex-1" />
              <button onClick={() => makeScript(i)}
                className={`text-xs py-2 font-bold rounded-xl transition-colors ${d.scripted ? "border border-[#d6d9e6] text-[#7b809c] hover:text-[#2a3052]" : "btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white"}`}>
                {d.scripted ? "もう一度台本化" : "🎬 台本化する"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
