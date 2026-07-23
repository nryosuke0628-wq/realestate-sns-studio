"use client";

import { useState, useEffect } from "react";
import { currentGenre } from "@/lib/studio-storage";
import { ThreadsQueueSection } from "./LibraryTab";

// 🧵 Threads：当面のメイン画面。深夜生成された「エビデンス付き投稿案」を
// 承認→19時に自動投稿（または今すぐ投稿）するだけの運用に最適化
interface ThreadsDraft {
  id: string; genre: string; title: string; script: string;
  threads: string[]; caption: string | null; status: string; source: string;
  created_at?: string;
}

function cleanPost(text: string): string {
  return text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/（約\d+文字）/, "").trim();
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

export default function ThreadsTab() {
  const [items, setItems] = useState<ThreadsDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [revId, setRevId] = useState<string | null>(null);
  const [revText, setRevText] = useState("");
  const [notice, setNotice] = useState("");
  // 今すぐ投稿の進行状況
  const [postingId, setPostingId] = useState<string | null>(null);
  const [postProgress, setPostProgress] = useState("");
  const [queueKey, setQueueKey] = useState(0);

  const reload = () => {
    fetch(`/api/library?genre=${currentGenre()}`).then(r => r.json())
      .then(d => {
        setEnabled(d.enabled ?? false);
        setItems((d.items ?? []).filter((i: ThreadsDraft) => i.source === "threads_daily" && i.status === "pending_review"));
        setLoading(false);
      })
      .catch(() => { setEnabled(false); setLoading(false); });
  };
  useEffect(() => { reload(); }, []);

  // ✅ 承認して19:00の自動投稿キューへ
  const approve = async (item: ThreadsDraft) => {
    await fetch("/api/threads-queue", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: item.title, posts: item.threads, genre: currentGenre() }),
    }).catch(() => {});
    await fetch(`/api/library?id=${item.id}`, { method: "DELETE" }).catch(() => {});
    setNotice("✅ 予約しました。今日19:00に自動投稿されます");
    reload(); setQueueKey(k => k + 1);
  };

  // ⚡ 今すぐ投稿（連投を順番にThreadsへ）
  const postNow = async (item: ThreadsDraft) => {
    setPostingId(item.id);
    try {
      for (let i = 0; i < item.threads.length; i++) {
        setPostProgress(`投稿中 ${i + 1}/${item.threads.length}…`);
        const res = await fetch("/api/threads-post", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: cleanPost(item.threads[i]), genre: currentGenre() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "投稿失敗");
        if (i < item.threads.length - 1) await new Promise(r => setTimeout(r, 2500));
      }
      await fetch(`/api/library?id=${item.id}`, { method: "DELETE" }).catch(() => {});
      setNotice("🎉 Threadsに投稿しました！");
      reload();
    } catch (e) {
      setNotice(`⚠ ${e instanceof Error ? e.message : "投稿に失敗しました"}`);
    }
    setPostingId(null); setPostProgress("");
  };

  const discard = async (id: string) => {
    await fetch(`/api/library?id=${id}`, { method: "DELETE" }).catch(() => {});
    reload();
  };

  // ✏️ 修正指示つき作り直し / 🔄 作り直し / ⚡ 今すぐ生成
  const regenerate = async (opts?: { discardId?: string; instruction?: string }) => {
    setBusy("🧵 今日のニュースからThreads投稿を作成中…（30秒ほど）");
    setRevId(null); setRevText("");
    if (opts?.discardId) await fetch(`/api/library?id=${opts.discardId}`, { method: "DELETE" }).catch(() => {});
    try {
      const q = opts?.instruction ? `&instruction=${encodeURIComponent(opts.instruction)}` : "";
      await fetch(`/api/cron/overnight?mode=threads&genre=${currentGenre()}${q}`);
    } catch { /* タイムアウトしても裏で完了することがある */ }
    reload();
    setBusy("");
  };

  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="display-type text-xl text-[#171c33]">Threads<span className="text-[#5b6cff]">.</span></h2>
          <p className="text-xs text-[#9ba0b8] mt-0.5">毎朝6時、ニュースとバズの型からエビデンス付き投稿案が届きます。承認するだけで19時に自動投稿</p>
        </div>
        <button onClick={() => regenerate()} disabled={!!busy}
          className="btn-pop px-4 py-2 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-xs font-bold rounded-xl">
          ⚡ 新しい投稿案を生成
        </button>
      </div>

      {notice && <p className="anim-in text-xs font-semibold text-[#5b6cff]">{notice}</p>}
      {busy && <div className="bg-white border border-[#e3e5ef] rounded-xl p-4"><Spinner label={busy} /></div>}
      {loading && !busy && <div className="bg-white border border-[#e3e5ef] rounded-xl p-4"><Spinner label="今日の投稿案を読み込み中…" /></div>}
      {!loading && !enabled && <p className="text-xs text-red-500">⚠ サーバー接続に失敗しました。再読み込みしてください</p>}

      {!loading && enabled && items.length === 0 && !busy && (
        <div className="border border-[#e3e5ef] bg-white rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">🧵</div>
          <p className="text-sm text-[#5a6080] mb-4">今日の投稿案はまだありません。<br />毎朝6:00に自動生成されます</p>
          <button onClick={() => regenerate()}
            className="btn-pop px-6 py-2.5 bg-[#1c2340] hover:bg-[#2a3358] text-white text-sm font-bold rounded-xl">
            ⚡ 今すぐ生成する
          </button>
        </div>
      )}

      {/* 今日の投稿案 */}
      <div className="stagger space-y-4">
        {items.map(item => (
          <div key={item.id} className="card-hover border border-[#5b6cff]/40 bg-white rounded-2xl p-4 md:p-5">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="text-xs text-[#5b6cff] font-bold mb-1">🧵 {item.threads.length}連投稿</p>
                <h3 className="display-type text-base text-[#171c33] leading-snug">{item.title}</h3>
              </div>
              <button onClick={() => setOpenId(openId === item.id ? null : item.id)}
                className="btn-pop shrink-0 text-xs px-3 py-1.5 border border-[#d6d9e6] rounded-lg text-[#5a6080]">
                {openId === item.id ? "閉じる ▲" : "全文 ▼"}
              </button>
            </div>

            {/* 📰 エビデンス */}
            {item.caption && (
              <p className="text-[11px] text-[#5a6080] bg-[#f1f2f7] border border-[#e3e5ef] rounded-lg px-3 py-2 mb-3 leading-relaxed break-all">
                {item.caption}
              </p>
            )}

            {/* 投稿プレビュー（1件目は常に表示） */}
            <div className="space-y-2 mb-3">
              {(openId === item.id ? item.threads : item.threads.slice(0, 1)).map((p, i) => (
                <div key={i} className="border border-[#e3e5ef] rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-[#9ba0b8] font-bold mb-1">投稿 {i + 1}</p>
                  <p className="text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed">{cleanPost(p)}</p>
                </div>
              ))}
              {openId !== item.id && item.threads.length > 1 && (
                <p className="text-[10px] text-[#9ba0b8]">…続き{item.threads.length - 1}件は「全文▼」で</p>
              )}
            </div>

            {/* アクション（モバイルでも押しやすい大きめボタン） */}
            <div className="grid grid-cols-2 md:flex gap-2">
              <button onClick={() => approve(item)} disabled={postingId === item.id}
                className="btn-pop md:flex-1 py-2.5 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-xs font-bold rounded-xl">
                ✅ 19時に予約
              </button>
              <button onClick={() => postNow(item)} disabled={postingId !== null}
                className="btn-pop md:flex-1 py-2.5 border border-[#5b6cff] text-[#5b6cff] hover:bg-[#5b6cff]/10 disabled:opacity-40 text-xs font-bold rounded-xl">
                {postingId === item.id ? postProgress || "投稿中…" : "⚡ 今すぐ投稿"}
              </button>
              <button onClick={() => { setRevId(revId === item.id ? null : item.id); setRevText(""); }}
                className="btn-pop py-2.5 px-3 border border-[#d6d9e6] text-[#5a6080] text-xs font-bold rounded-xl">
                ✏️ 修正
              </button>
              <button onClick={() => discard(item.id)}
                className="btn-pop py-2.5 px-3 border border-red-200 text-red-500 text-xs rounded-xl">
                ✕ 却下
              </button>
            </div>

            {revId === item.id && (
              <div className="anim-in mt-3 space-y-2">
                <textarea value={revText} onChange={e => setRevText(e.target.value)} rows={2}
                  placeholder="例：もっと攻めた逆張りで／数字を増やして／絵文字なしで"
                  className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-xs rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff] placeholder:text-[#a6abc2]" />
                <button onClick={() => regenerate({ discardId: item.id, instruction: revText })} disabled={!revText.trim() || !!busy}
                  className="btn-pop w-full py-2 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-xs font-bold rounded-xl">
                  🔁 この指示で作り直す
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 予約キュー */}
      <div key={queueKey}>
        <ThreadsQueueSection />
      </div>
    </div>
  );
}
