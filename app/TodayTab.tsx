"use client";

import { useState, useEffect } from "react";
import EditorTab from "./EditorTab";
import RecordingPrompter from "./RecordingPrompter";
import { currentGenre, saveLibraryItem, computeLibraryMetrics, fmtViews, type LibraryMetrics } from "@/lib/studio-storage";
import { useCountUp, FollowerChart } from "./DashboardTab";

interface FollowerData {
  connected: boolean; current?: number; goal?: number; dailyGrowth?: number;
  projectedDate?: string | null; history?: { followers: number; created_at: string }[];
}

// 🌅 Today：1日の作業がここで完結する画面
// 深夜生成された台本 → 承認 → プロンプター撮影（or 動画ドロップ）→ 自動編集 → 完成
interface OvernightItem {
  id: string; genre: string; title: string; script: string;
  threads: string[]; caption: string | null; status: string; source: string;
}

function saveToLocalLibrary(item: OvernightItem) {
  saveLibraryItem({
    id: item.id, title: item.title, script: item.script,
    threads: item.threads ?? [], caption: item.caption ?? undefined,
    status: "none", createdAt: Date.now(),
  });
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[#5a6080]">
      <svg className="animate-spin w-3.5 h-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-label="読み込み中">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

function StatNumber({ value }: { value: number }) {
  const animated = useCountUp(value);
  return <>{animated.toLocaleString()}</>;
}

function MiniStat({ en, jp, num, unit, sub, subClass }: {
  en: string; jp: string; num: string; unit?: string; sub: string; subClass?: string;
}) {
  return (
    <div className="px-4 py-4">
      <p className="text-[9px] text-[#9ba0b8] font-semibold tracking-widest uppercase">{en}</p>
      <p className="text-[10px] text-[#7b809c] mb-1">{jp}</p>
      <p className="text-2xl font-black text-[#171c33] leading-none">
        {num}<span className="text-xs font-bold text-[#7b809c] ml-1">{unit}</span>
      </p>
      <p className={`text-[10px] mt-1.5 font-semibold ${subClass ?? "text-[#9ba0b8]"}`}>{sub}</p>
    </div>
  );
}

export default function TodayTab() {
  const [items, setItems] = useState<OvernightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  // 承認後の撮影〜編集ステージ
  const [active, setActive] = useState<OvernightItem | null>(null);
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  // 修正指示
  const [revId, setRevId] = useState<string | null>(null);
  const [revText, setRevText] = useState("");
  const [metrics, setMetrics] = useState<LibraryMetrics | null>(null);
  const [followerData, setFollowerData] = useState<FollowerData | null>(null);

  const reload = () => {
    fetch(`/api/library?genre=${currentGenre()}`).then(r => r.json())
      .then(d => {
        setEnabled(d.enabled ?? false);
        setItems((d.items ?? []).filter((i: OvernightItem) => i.status === "pending_review"));
        setLoading(false);
      })
      .catch(() => { setEnabled(false); setLoading(false); });
  };
  useEffect(() => {
    reload();
    setMetrics(computeLibraryMetrics());
    fetch("/api/dashboard").then(r => r.json()).then(setFollowerData).catch(() => {});
  }, []);

  // ✅ 承認：ローカル保存＋Threadsキュー投入＋サーバー側から消して撮影ステージへ
  const approve = async (item: OvernightItem) => {
    saveToLocalLibrary(item);
    if ((item.threads ?? []).length > 0) {
      fetch("/api/threads-queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.title, posts: item.threads, genre: currentGenre() }),
      }).catch(() => {});
    }
    fetch(`/api/library?id=${item.id}`, { method: "DELETE" }).catch(() => {});
    setActive(item);
    reload();
  };

  const discard = async (id: string) => {
    await fetch(`/api/library?id=${id}`, { method: "DELETE" }).catch(() => {});
    reload();
  };

  // ✏️ 修正指示 → AIが台本を書き直してサーバー側を更新
  const revise = async (item: OvernightItem) => {
    if (!revText.trim()) return;
    setBusy("✍️ 修正指示を反映中…");
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature: "user_revision",
          input: `【現在の台本】\n${item.script}\n\n【ユーザーからの修正指示（最優先で反映）】\n${revText}`,
          genre: currentGenre(),
        }),
      });
      const data = await res.json();
      const text: string = data.reply ?? "";
      const s = text.indexOf("FINAL_START"), e = text.indexOf("FINAL_END");
      const newScript = s !== -1 && e !== -1 ? text.slice(s + "FINAL_START".length, e).trim() : text;
      await fetch("/api/library", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...item, script: newScript, status: "pending_review", source: "overnight" }),
      });
      setRevId(null); setRevText("");
      reload();
    } catch { /* 失敗時は元の台本のまま */ }
    setBusy("");
  };

  // 🔄 作り直し / 今すぐ生成（深夜バッチを単ジャンルで手動実行）
  const regenerate = async (discardId?: string) => {
    setBusy("🌙 AIチームが台本を作成中…（1〜2分かかります）");
    if (discardId) await fetch(`/api/library?id=${discardId}`, { method: "DELETE" }).catch(() => {});
    try {
      await fetch(`/api/cron/overnight?mode=video&genre=${currentGenre()}`);
    } catch { /* タイムアウトしても裏で完了することがある */ }
    reload();
    setBusy("");
  };

  // ── 撮影〜編集ステージ ──
  if (active) {
    return (
      <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[#9ba0b8]">承認済み・Threads予約完了 🧵</p>
            <h2 className="display-type text-lg text-[#171c33]">{active.title}</h2>
          </div>
          <button onClick={() => { setActive(null); setRecordedFile(null); }}
            className="btn-pop text-xs px-3 py-1.5 border border-[#d6d9e6] rounded-lg text-[#5a6080]">← 今日の一覧へ</button>
        </div>

        {!recordedFile && (
          <div className="stagger grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button onClick={() => setPrompterOpen(true)}
              className="card-hover text-left border border-[#5b6cff]/40 bg-[#eef0ff] rounded-2xl p-6">
              <div className="text-3xl mb-2">📹</div>
              <p className="display-type text-base text-[#171c33] mb-1">プロンプターで撮影</p>
              <p className="text-xs text-[#5a6080] leading-relaxed">インカメに自分を映しながら台本が流れます。録画完了でそのまま自動編集へ</p>
            </button>
            <label className="card-hover cursor-pointer text-left border border-[#e3e5ef] bg-white rounded-2xl p-6 block">
              <div className="text-3xl mb-2">⬇</div>
              <p className="display-type text-base text-[#171c33] mb-1">撮影済み動画を入れる</p>
              <p className="text-xs text-[#5a6080] leading-relaxed">iPhone純正カメラ等で撮った場合はこちら。選ぶだけで自動編集が始まります</p>
              <input type="file" accept="video/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) setRecordedFile(f); }} />
            </label>
          </div>
        )}

        {recordedFile && (
          <EditorTab presetNarration={active.script} injectedFile={recordedFile} />
        )}

        {prompterOpen && (
          <RecordingPrompter
            script={active.script}
            onClose={() => setPrompterOpen(false)}
            onRecorded={(f) => { setPrompterOpen(false); setRecordedFile(f); }}
          />
        )}
      </div>
    );
  }

  // ── 朝の承認ステージ ──
  const current = followerData?.current ?? 0;
  const goal = followerData?.goal ?? 10000;
  const pct = Math.min(100, (current / goal) * 100);
  const avg = metrics?.avgViews != null ? fmtViews(metrics.avgViews) : null;

  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-5">
      <div>
        <h2 className="display-type text-xl text-[#171c33]">Today<span className="text-[#5b6cff]">.</span></h2>
        <p className="text-xs text-[#9ba0b8] mt-0.5">寝ている間にAIチームが作った今日の台本。承認→撮影→あとは全部自動</p>
      </div>

      {/* 🔥 気合の入る数字ダッシュボード */}
      <div className="stagger grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* フォロワー・達成予測 */}
        <div className="card-hover border border-[#5b6cff]/40 bg-[#5b6cff]/10 rounded-2xl p-5">
          {followerData?.connected ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
                <div>
                  <p className="text-xs text-[#7b809c] mb-1">フォロワー</p>
                  <p className="text-3xl font-black text-[#5b6cff]">
                    <StatNumber value={current} />
                    <span className="text-sm text-[#7b809c] font-normal ml-2">/ {goal.toLocaleString()}人</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#7b809c]">1日平均 <span className="text-green-600 font-bold">+{followerData.dailyGrowth ?? 0}</span></p>
                  {followerData.projectedDate && (
                    <p className="text-xs text-[#5a6080] mt-1">📅 達成予測：<span className="text-[#5b6cff] font-bold">{new Date(followerData.projectedDate).toLocaleDateString("ja-JP")}</span></p>
                  )}
                </div>
              </div>
              <div className="h-2 bg-white rounded-full overflow-hidden mb-2">
                <div className="h-full bg-gradient-to-r from-[#5b6cff] to-[#8b96ff] rounded-full transition-all duration-1000 ease-out" style={{ width: `${pct}%` }} />
              </div>
              <FollowerChart history={followerData.history ?? []} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-4 text-center">
              <p className="text-2xl mb-1">📈</p>
              <p className="text-xs text-[#5a6080]">Instagram連携でフォロワー推移がここに表示されます</p>
            </div>
          )}
        </div>

        {/* ストック・撮影待ち・今週投稿・平均再生 */}
        <div className="grid grid-cols-2 border border-[#e3e5ef] bg-white rounded-2xl divide-x divide-y divide-[#e3e5ef] overflow-hidden">
          <MiniStat en="Stock" jp="ネタストック" num={metrics ? String(metrics.stock) : "—"}
            sub={metrics && metrics.stockNew > 0 ? `+${metrics.stockNew} 今週追加` : "保留＋未着手"}
            subClass={metrics && metrics.stockNew > 0 ? "text-green-600" : undefined} />
          <MiniStat en="To Shoot" jp="撮影待ち" num={metrics ? String(metrics.toShoot) : "—"}
            sub={metrics && metrics.toShoot > 0 ? "撮れば即投稿できます" : "撮影待ちなし"}
            subClass={metrics && metrics.toShoot > 0 ? "text-orange-500" : undefined} />
          <MiniStat en="Posted" jp="今週投稿" num={metrics ? String(metrics.posted) : "—"} unit={metrics ? `/ ${metrics.goal}` : ""}
            sub={metrics && metrics.posted >= metrics.goal ? "🎉 今週の目標達成！" : metrics ? `残り${metrics.goal - metrics.posted}本` : ""}
            subClass={metrics && metrics.posted >= metrics.goal ? "text-green-600" : undefined} />
          <MiniStat en="Avg Views" jp="平均再生" num={avg ? avg.num : "—"} unit={avg?.unit}
            sub={avg ? `実績${metrics?.perfCount}本から算出` : "投稿後に実績を記録すると表示"} />
        </div>
      </div>

      {busy && <div className="bg-white border border-[#e3e5ef] rounded-xl p-4"><Spinner label={busy} /></div>}
      {loading && !busy && <div className="bg-white border border-[#e3e5ef] rounded-xl p-4"><Spinner label="今日の台本を読み込み中…" /></div>}

      {!loading && !enabled && (
        <p className="text-xs text-red-500">⚠ サーバー接続に失敗しました。再読み込みしてください</p>
      )}

      {!loading && enabled && items.length === 0 && !busy && (
        <div className="border border-[#e3e5ef] bg-white rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🌙</div>
          <p className="text-sm text-[#5a6080] mb-4">今日の台本はまだありません。<br />毎朝6:00に自動生成されます</p>
          <button onClick={() => regenerate()}
            className="btn-pop px-6 py-2.5 bg-[#1c2340] hover:bg-[#2a3358] text-white text-sm font-bold rounded-xl">
            ⚡ 今すぐ生成する
          </button>
        </div>
      )}

      <div className="stagger space-y-4">
        {items.map(item => (
          <div key={item.id} className="card-hover border border-[#5b6cff]/40 bg-white rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs text-[#5b6cff] font-bold mb-0.5">🌙 深夜生成</p>
                <h3 className="display-type text-base text-[#171c33]">{item.title}</h3>
              </div>
              <button onClick={() => setOpenId(openId === item.id ? null : item.id)}
                className="btn-pop shrink-0 text-xs px-3 py-1.5 border border-[#d6d9e6] rounded-lg text-[#5a6080]">
                {openId === item.id ? "台本を閉じる ▲" : "台本を読む ▼"}
              </button>
            </div>

            {openId === item.id && (
              <pre className="text-xs text-[#2a3052] whitespace-pre-wrap leading-relaxed border-t border-[#e3e5ef] pt-3 mb-3">{item.script}</pre>
            )}

            <div className="flex flex-wrap gap-2">
              <button onClick={() => approve(item)}
                className="btn-pop flex-1 min-w-[150px] py-2.5 bg-[#1c2340] hover:bg-[#2a3358] text-white text-sm font-bold rounded-xl">
                ✅ 承認して撮影へ
              </button>
              <button onClick={() => { setRevId(revId === item.id ? null : item.id); setRevText(""); }}
                className="btn-pop px-4 py-2.5 border border-[#5b6cff]/50 text-[#5b6cff] text-sm font-bold rounded-xl">
                ✏️ 修正指示
              </button>
              <button onClick={() => regenerate(item.id)}
                className="btn-pop px-4 py-2.5 border border-[#d6d9e6] text-[#5a6080] text-sm rounded-xl">
                🔄 作り直し
              </button>
            </div>

            {revId === item.id && (
              <div className="anim-in mt-3 space-y-2">
                <textarea value={revText} onChange={e => setRevText(e.target.value)} rows={2}
                  placeholder="例：フックに具体的な金額を入れて／もっと初心者向けに／30秒に短縮"
                  className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-xs rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff] placeholder:text-[#a6abc2]" />
                <button onClick={() => revise(item)} disabled={!revText.trim() || !!busy}
                  className="btn-pop w-full py-2 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-xs font-bold rounded-xl">
                  🔁 この指示で書き直す
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
