"use client";

import { useState, useEffect } from "react";
import Teleprompter from "./Teleprompter";
import EditorTab from "./EditorTab";
import { LinkedText, CopyBtn, ThreadsPanel } from "./StudioShared";
import type { LibraryItem, ProductionStatus, BookmarkedIdea } from "@/lib/studio-types";
import {
  currentGenre, loadLibrary, updateLibraryStatus, deleteLibraryItem, updateLibraryPerformance,
  loadBookmarks, deleteBookmark,
} from "@/lib/studio-storage";

// ── Library Tab ───────────────────────────────────────────────────────
const STATUS_CONFIG: Record<ProductionStatus, { label: string; active: string }> = {
  none:    { label: "未着手",      active: "" },
  filming: { label: "📷 撮影待ち", active: "bg-blue-900/50 text-blue-600 border-blue-600/40" },
  editing: { label: "🎬 編集中",   active: "bg-purple-900/50 text-purple-300 border-purple-600/40" },
  posted:  { label: "✅ 投稿済み", active: "bg-green-900/50 text-green-300 border-green-300" },
};

function LibraryCard({ item, onStatus, onDelete }: { item: LibraryItem; onStatus: (id: string, s: ProductionStatus) => void; onDelete: (id: string) => void }) {
  const [showScript, setShowScript] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [prompter, setPrompter] = useState(false);
  const [editing, setEditing] = useState(false);
  const statuses: ProductionStatus[] = ["filming", "editing", "posted"];

  return (
    <div className="card-hover border border-[#e3e5ef] bg-white rounded-2xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[#171c33] leading-snug">{item.title}</p>
            <p className="text-xs text-[#9ba0b8] mt-0.5">{new Date(item.createdAt).toLocaleDateString("ja-JP")}</p>
          </div>
          <button onClick={() => onDelete(item.id)} className="text-[#c3c7d8] hover:text-red-600 text-xs transition-colors shrink-0">✕</button>
        </div>

        {/* 進捗ボタン */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          {statuses.map(s => {
            const cfg = STATUS_CONFIG[s];
            const active = item.status === s;
            return (
              <button key={s} onClick={() => onStatus(item.id, active ? "none" : s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${active ? `${cfg.active} border` : "border-[#d6d9e6] text-[#7b809c] hover:text-[#2a3052] hover:border-[#5b6cff]/60"}`}>
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* 投稿済みなら実績メモ入力欄（次回のネタ案生成でAIが学習） */}
        {item.status === "posted" && (
          <input
            type="text"
            defaultValue={item.performance ?? ""}
            onBlur={(e) => updateLibraryPerformance(item.id, e.target.value)}
            placeholder="実績を入力（例：再生1.2万・保存320）→ 次回生成でAIが学習"
            className="w-full mb-3 bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-green-600/50 placeholder:text-[#a6abc2]"
          />
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowScript(!showScript)}
            className="flex-1 text-xs py-2 border border-[#d6d9e6] hover:border-[#5b6cff] text-[#5a6080] hover:text-[#1e2440] rounded-xl transition-colors">
            {showScript ? "台本を閉じる ▲" : "台本を見る ▼"}
          </button>
          <button onClick={() => setPrompter(true)}
            className="flex-1 text-xs py-2 border border-green-300 hover:border-green-500 text-green-600 rounded-xl transition-colors">
            📖 プロンプター
          </button>
          <button onClick={() => setEditing(e => !e)}
            className="flex-1 text-xs py-2 border border-[#5b6cff]/50 hover:border-[#5b6cff] text-[#5b6cff] rounded-xl transition-colors">
            🎬 {editing ? "編集を閉じる" : "動画を編集"}
          </button>
          {item.threads.length > 0 && (
            <button onClick={() => setShowThreads(!showThreads)}
              className="flex-1 text-xs py-2 border border-orange-300 hover:border-orange-400 text-orange-500 rounded-xl transition-colors">
              🧵 Threads {showThreads ? "▲" : "▼"}
            </button>
          )}
        </div>
        {prompter && <Teleprompter script={item.script} onClose={() => setPrompter(false)} />}
      </div>

      {showScript && (
        <div className="border-t border-[#e3e5ef] p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={item.script} /></div>
          <LinkedText text={item.script} />
          {item.caption && (
            <div className="mt-4 pt-4 border-t border-[#e3e5ef]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-pink-600">📝 キャプション</span>
                <CopyBtn text={item.caption} />
              </div>
              <pre className="text-sm text-[#2a3052] whitespace-pre-wrap leading-relaxed">{item.caption}</pre>
            </div>
          )}
        </div>
      )}

      {showThreads && item.threads.length > 0 && (
        <div className="border-t border-[#e3e5ef] p-4">
          <ThreadsPanel posts={item.threads} />
        </div>
      )}
      {editing && (
        <div className="border-t border-[#e3e5ef] p-4">
          <EditorTab presetNarration={item.script} />
        </div>
      )}
    </div>
  );
}

interface QueueItem {
  id: number; title: string; posts: string[]; status: string; error: string | null;
  created_at: string; posted_at: string | null;
}

export function ThreadsQueueSection() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [enabled, setEnabled] = useState(true);

  const reload = () => {
    fetch(`/api/threads-queue?genre=${currentGenre()}`).then(r => r.json())
      .then(d => { setItems(d.items ?? []); setEnabled(d.enabled ?? false); })
      .catch(() => setEnabled(false));
  };
  useEffect(() => { reload(); }, []);

  if (!enabled || items.length === 0) return null;

  const statusBadge = (s: string) =>
    s === "posted" ? <span className="text-xs text-green-600">✅ 投稿済み</span> :
    s === "error"  ? <span className="text-xs text-red-500">❌ エラー</span> :
                     <span className="text-xs text-orange-500">⏳ 待機中</span>;

  return (
    <section>
      <h2 className="text-sm font-bold text-[#1e2440] mb-1">🧵 Threads自動投稿キュー</h2>
      <p className="text-xs text-[#9ba0b8] mb-3">{currentGenre() !== "realestate" ? "⚠ このジャンル用Threadsアカウントの連携までは投稿されず、キューに貯まります（連携後は毎日19:00に自動投稿）" : "毎日19:00に上から1件自動投稿されます（朝の1本目は生成時に即時投稿）"}</p>
      <div className="space-y-2">
        {items.map(q => (
          <div key={q.id} className="flex items-center gap-3 border border-[#e3e5ef] bg-white rounded-xl px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#1e2440] truncate">{q.title}</p>
              <p className="text-xs text-[#9ba0b8]">{q.posts.length}連投稿 ・ {new Date(q.created_at).toLocaleDateString("ja-JP")}</p>
              {q.error && <p className="text-xs text-red-500 truncate">⚠ {q.error}</p>}
            </div>
            {statusBadge(q.status)}
            <button
              onClick={async () => { await fetch(`/api/threads-queue?id=${q.id}`, { method: "DELETE" }); reload(); }}
              className="text-[#9ba0b8] hover:text-red-600 text-xs shrink-0 transition-colors">✕</button>
          </div>
        ))}
      </div>
    </section>
  );
}

interface ResearchItem { id: number; genre: string; content: string; source: string | null; created_at: string }

function ResearchBankSection() {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = () => {
    fetch(`/api/research?genre=${currentGenre()}`).then(r => r.json())
      .then(d => { setItems(d.items ?? []); setEnabled(d.enabled ?? false); })
      .catch(() => setEnabled(false));
  };
  useEffect(() => { reload(); }, []);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    await fetch("/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ genre: currentGenre(), content: input.trim() }),
    }).catch(() => {});
    setInput(""); setSaving(false); reload();
  };

  if (!enabled) return null;

  return (
    <section>
      <h2 className="text-sm font-bold text-[#1e2440] mb-1">📦 リサーチ銀行</h2>
      <p className="text-xs text-[#9ba0b8] mb-3">ここに貯めたバズ投稿の実測データは、ネタ案・バズ逆算・週間プランの生成時に毎回自動で参照されます（直近2週間分）</p>
      <div className="flex gap-2 mb-3">
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
          placeholder="例：@tamu_hudousan「不動産取得税の罠」55.9万再生。フックは「家を買ったあとに届くその通知〜」。白い紙を持って歩き語り"
          className="flex-1 bg-white border border-[#d6d9e6] text-[#1e2440] text-xs rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff] placeholder:text-[#a6abc2]" />
        <button onClick={save} disabled={saving || !input.trim()}
          className="btn-pop px-4 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-xs font-bold rounded-xl shrink-0">
          {saving ? "…" : "📥 登録"}
        </button>
      </div>
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map(r => (
            <div key={r.id} className="flex items-start gap-3 border border-[#e3e5ef] bg-white rounded-xl px-4 py-3">
              <p className="flex-1 text-xs text-[#2a3052] leading-relaxed">{r.content}</p>
              <span className="text-xs text-[#9ba0b8] shrink-0">{new Date(r.created_at).toLocaleDateString("ja-JP")}</span>
              <button onClick={async () => { await fetch(`/api/research?id=${r.id}`, { method: "DELETE" }); reload(); }}
                className="text-[#c3c7d8] hover:text-red-500 text-xs shrink-0 transition-colors">✕</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function LibraryTab() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkedIdea[]>([]);

  const reload = () => { setItems(loadLibrary()); setBookmarks(loadBookmarks()); };
  useEffect(() => { reload(); }, []);

  return (
    <div className="overflow-y-auto output-scroll h-[calc(100vh-185px)] px-3 md:px-6 py-5 space-y-8">
      <ResearchBankSection />
      <ThreadsQueueSection />
      {/* 保留ネタ案 */}
      {bookmarks.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-[#1e2440] mb-3">⭐ 保留ネタ案</h2>
          <div className="space-y-2">
            {bookmarks.map(b => (
              <div key={b.id} className="border border-[#c9cffc]/30 bg-[#5b6cff]/10 rounded-xl p-3 flex items-start gap-3">
                <LinkedText text={b.idea} className="text-xs text-[#2a3052] whitespace-pre-wrap flex-1 leading-relaxed" />
                <button onClick={() => { deleteBookmark(b.id); setBookmarks(loadBookmarks()); }}
                  className="text-[#9ba0b8] hover:text-red-600 text-xs shrink-0 mt-0.5">✕</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 台本ストック */}
      <section>
        <h2 className="text-sm font-bold text-[#1e2440] mb-3">🎬 台本ストック</h2>
        {items.length === 0 ? (
          <div className="text-center py-16 text-[#9ba0b8]">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm">台本を生成するとここに自動保存されます</p>
          </div>
        ) : (
          <div className="stagger grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map(item => (
              <LibraryCard key={item.id} item={item}
                onStatus={(id, s) => { updateLibraryStatus(id, s); setItems(loadLibrary()); }}
                onDelete={(id) => { deleteLibraryItem(id); setItems(loadLibrary()); }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
