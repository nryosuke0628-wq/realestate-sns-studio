"use client";

import { useState, useEffect, useRef } from "react";
import EditorTab from "./EditorTab";
import Teleprompter from "./Teleprompter";

// ── Types ─────────────────────────────────────────────────────────────
type Tab = "weekly" | "script" | "library" | "editor" | "dashboard" | "news" | "analyze";

interface DashboardData {
  connected: boolean;
  goal?: number;
  current?: number;
  dailyGrowth?: number;
  projectedDate?: string | null;
  history?: { followers: number; created_at: string }[];
  media?: {
    id: string; caption: string | null; permalink: string | null;
    views: number | null; reach: number | null; saves: number | null;
    likes: number | null; comments: number | null; posted_at: string | null;
  }[];
}
type AnalyzeMode = "buzz" | "data";
type DebateStep = "idle" | "trend" | "ideas" | "draft" | "review1" | "review2" | "revision" | "final" | "threads" | "done";
type ProductionStatus = "none" | "filming" | "editing" | "posted";

interface AgentMessage {
  agent: "trend" | "idea" | "draft" | "realestate" | "sns" | "writer" | "final";
  content: string;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  step: DebateStep;
  messages: AgentMessage[];
  ideas: string[];
  bookmarkedIdeas: number[];
  selectedIdea: number | null;
  finalScript: string;
  finalThreads: string[];
  caption?: string; // 自動生成されたキャプション＋ハッシュタグ
  approved?: boolean; // 「このまま使う」で確定済みか
}

interface LibraryItem {
  id: string;
  title: string;
  script: string;
  threads: string[];
  status: ProductionStatus;
  createdAt: number;
  performance?: string; // 投稿後の実績メモ（再生数・保存数など）
  caption?: string;
}

interface WeeklyPlan {
  createdAt: number;
  days: { day: string; idea: string; scripted: boolean }[];
}

interface BookmarkedIdea {
  id: string;
  idea: string;
  createdAt: number;
}

// ── API & Parsers ─────────────────────────────────────────────────────
async function callAPI(feature: string, input = "", options = {}): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, input, options }),
  });
  const data = await res.json();
  return data.reply ?? data.error ?? "";
}

function parseIdeas(text: string): string[] {
  const s = text.indexOf("IDEA_START"), e = text.indexOf("IDEA_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "IDEA_START".length, e).split("IDEA_SPLIT").map(t => t.trim()).filter(Boolean);
}

function parseThreads(text: string): string[] {
  const s = text.indexOf("THREADS_START"), e = text.indexOf("THREADS_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "THREADS_START".length, e).trim().split("THREADS_SPLIT").map(t => t.trim()).filter(Boolean);
}

function extractBlock(text: string, start: string, end: string): string {
  const s = text.indexOf(start), e = text.indexOf(end);
  if (s === -1 || e === -1) return "";
  return text.slice(s + start.length, e).trim();
}

function extractIdeaTitle(idea: string): string {
  const match = idea.match(/タイトル[：:]\s*(.+)/);
  return match ? match[1].trim() : idea.slice(0, 40).replace(/\n/g, " ");
}

// レビューの「**合計**：85点/100点」から点数を抽出
function parseScore(review: string): number | null {
  const match = review.match(/合計[^\d]*(\d+)\s*点/);
  return match ? parseInt(match[1], 10) : null;
}

function parsePlan(text: string): { day: string; idea: string; scripted: boolean }[] {
  const s = text.indexOf("PLAN_START"), e = text.indexOf("PLAN_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "PLAN_START".length, e).split("PLAN_SPLIT").map(t => t.trim()).filter(Boolean)
    .map(idea => {
      const dayMatch = idea.match(/【(.+?)】/);
      return { day: dayMatch ? dayMatch[1] : "", idea, scripted: false };
    });
}

// Cronが毎朝収集したトレンドレポート（24h以内）を取得。なければnull
async function fetchLatestTrend(): Promise<string | null> {
  try {
    const res = await fetch("/api/trend-latest");
    const data = await res.json();
    return data.report ?? null;
  } catch { return null; }
}

// 過去の投稿実績を学習コンテキストとして組み立て
function buildPerfContext(): string {
  const posted = loadLibrary().filter(i => i.status === "posted" && i.performance).slice(0, 5);
  return posted.length > 0
    ? `\n\n【自分の過去投稿の実績】\n${posted.map(i => `・「${i.title}」→ ${i.performance}`).join("\n")}\n※実績が良いテーマ・切り口の傾向を優先すること`
    : "";
}

// ── Storage ───────────────────────────────────────────────────────────
function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("debate_sessions") ?? "[]"); } catch { return []; }
}
function saveSessions(s: ChatSession[]) { localStorage.setItem("debate_sessions", JSON.stringify(s)); }

function loadLibrary(): LibraryItem[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("script_library") ?? "[]"); } catch { return []; }
}
function saveLibraryItem(item: LibraryItem) {
  const next = [item, ...loadLibrary().filter(i => i.id !== item.id)];
  localStorage.setItem("script_library", JSON.stringify(next));
}
function updateLibraryStatus(id: string, status: ProductionStatus) {
  localStorage.setItem("script_library", JSON.stringify(loadLibrary().map(i => i.id === id ? { ...i, status } : i)));
}
function deleteLibraryItem(id: string) {
  localStorage.setItem("script_library", JSON.stringify(loadLibrary().filter(i => i.id !== id)));
}
function updateLibraryPerformance(id: string, performance: string) {
  localStorage.setItem("script_library", JSON.stringify(loadLibrary().map(i => i.id === id ? { ...i, performance } : i)));
}

function loadWeeklyPlan(): WeeklyPlan | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("weekly_plan") ?? "null"); } catch { return null; }
}
function saveWeeklyPlan(plan: WeeklyPlan) { localStorage.setItem("weekly_plan", JSON.stringify(plan)); }

// 週間プランのネタから台本生成セッションを作成（台本生成タブに引き継ぐ）
function createSessionFromIdea(idea: string): void {
  const sessions = loadSessions();
  const s: ChatSession = {
    id: Date.now().toString(),
    title: extractIdeaTitle(idea).slice(0, 24),
    createdAt: Date.now(), step: "ideas",
    messages: [], ideas: [idea], bookmarkedIdeas: [], selectedIdea: null,
    finalScript: "", finalThreads: [],
  };
  saveSessions([s, ...sessions]);
}

function loadBookmarks(): BookmarkedIdea[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("bookmarked_ideas") ?? "[]"); } catch { return []; }
}
function addBookmark(idea: string) {
  const item: BookmarkedIdea = { id: Date.now().toString(), idea, createdAt: Date.now() };
  localStorage.setItem("bookmarked_ideas", JSON.stringify([item, ...loadBookmarks()]));
}
function deleteBookmark(id: string) {
  localStorage.setItem("bookmarked_ideas", JSON.stringify(loadBookmarks().filter(i => i.id !== id)));
}

// ── Small Components ──────────────────────────────────────────────────
// テキスト中のURLをタップ可能なリンクに変換して表示
function LinkedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(https?:\/\/[^\s)）」】、。]+)/g);
  return (
    <pre className={className ?? "text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed"}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-600 break-all">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </pre>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs px-2 py-0.5 rounded border border-[#d6d9e6] text-[#5a6080] hover:text-[#1e2440] hover:border-[#5b6cff] transition-colors">
      {copied ? "✓ コピー済" : "コピー"}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#5a6080]">
      <svg className="animate-spin w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

const AGENT_META: Record<AgentMessage["agent"], { name: string; emoji: string; color: string }> = {
  trend:      { name: "トレンド収集",       emoji: "🌐", color: "border-blue-200 bg-blue-50" },
  idea:       { name: "ネタ案",             emoji: "💡", color: "border-[#5b6cff]/30 bg-[#eef0ff]/20" },
  draft:      { name: "台本作成者（初稿）",  emoji: "✍️", color: "border-gray-600/30 bg-[#f1f2f7]/40" },
  realestate: { name: "不動産専門家上司",   emoji: "🏢", color: "border-red-300 bg-red-50" },
  sns:        { name: "SNSコンサル上司",    emoji: "📱", color: "border-purple-200 bg-purple-50" },
  writer:     { name: "台本作成者（改訂）",  emoji: "✍️", color: "border-green-300 bg-green-50" },
  final:      { name: "🏆 完成台本",        emoji: "🏆", color: "border-[#5b6cff]/50 bg-[#5b6cff]/20" },
};

function AgentBubble({ msg }: { msg: AgentMessage }) {
  const meta = AGENT_META[msg.agent] ?? { name: msg.agent, emoji: "🤖", color: "border-gray-600/30 bg-[#f1f2f7]/40" };
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.content.length > 500;
  const preview = isLong && !expanded ? msg.content.slice(0, 400) + "…" : msg.content;
  return (
    <div className={`anim-in rounded-xl border p-4 ${meta.color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#2a3052]">
          <span>{meta.emoji}</span>{meta.name}
        </span>
        <div className="flex gap-1">
          {isLong && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-xs text-[#7b809c] hover:text-[#2a3052] px-1.5 py-0.5 rounded border border-[#d6d9e6]">
              {expanded ? "折りたたむ" : "全文表示"}
            </button>
          )}
          <CopyBtn text={msg.content} />
        </div>
      </div>
      <LinkedText text={preview} />
    </div>
  );
}

// ── Threads Panel ─────────────────────────────────────────────────────
function ThreadsPanel({ posts }: { posts: string[] }) {
  const [statuses, setStatuses] = useState<Record<number, "idle" | "posting" | "done" | "error">>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  const postOne = async (i: number, text: string) => {
    setStatuses(p => ({ ...p, [i]: "posting" }));
    try {
      const clean = text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
      const res = await fetch("/api/threads-post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "投稿失敗");
      setStatuses(p => ({ ...p, [i]: "done" }));
    } catch (e) {
      setStatuses(p => ({ ...p, [i]: "error" }));
      setErrors(p => ({ ...p, [i]: e instanceof Error ? e.message : "エラー" }));
    }
  };

  const postAll = async () => {
    for (let i = 0; i < posts.length; i++) {
      await postOne(i, posts[i]);
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
  };

  return (
    <div className="border border-orange-300 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-orange-200 bg-orange-50">
        <div className="flex items-center gap-2">
          <span>🧵</span>
          <span className="font-semibold text-orange-500 text-sm">Threads 自動投稿</span>
          <span className="text-xs text-orange-500/50">{posts.length}投稿</span>
        </div>
        <button onClick={postAll} className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg transition-colors">
          ⚡ 全て投稿
        </button>
      </div>
      <div className="p-3 space-y-3">
        {posts.map((post, i) => {
          const clean = post.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
          const status = statuses[i] ?? "idle";
          return (
            <div key={i} className="bg-white border border-[#e3e5ef] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-orange-500">投稿 {i + 1}</span>
                <div className="flex items-center gap-2">
                  <CopyBtn text={clean} />
                  <button onClick={() => postOne(i, post)} disabled={status === "posting" || status === "done"}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                      status === "done" ? "bg-green-100 text-green-600 border border-green-300" :
                      status === "error" ? "bg-red-100 text-red-500 border border-red-300" :
                      status === "posting" ? "bg-[#e7e9f2] text-[#5a6080]" :
                      "bg-orange-600 hover:bg-orange-500 text-white"
                    }`}>
                    {status === "done" ? "✅ 済み" : status === "posting" ? "投稿中…" : status === "error" ? "❌ 再試行" : "投稿する"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed">{clean}</p>
              {status === "error" && errors[i] && <p className="text-xs text-red-500 mt-2">⚠ {errors[i]}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Progress Steps ────────────────────────────────────────────────────
const STEP_DEFS = [
  { key: "trend",    label: "トレンド収集" },
  { key: "ideas",    label: "ネタ案生成" },
  { key: "draft",    label: "初稿作成" },
  { key: "review1",  label: "専門家レビュー" },
  { key: "revision", label: "台本改訂" },
  { key: "final",    label: "最終台本" },
  { key: "threads",  label: "Threads生成" },
];
const STEP_ORDER = ["idle","trend","ideas","draft","review1","review2","revision","final","threads","done"];

function ProgressSteps({ step }: { step: DebateStep }) {
  const cur = STEP_ORDER.indexOf(step);
  return (
    <div className="flex flex-wrap gap-1.5">
      {STEP_DEFS.map(({ key, label }) => {
        const idx = STEP_ORDER.indexOf(key);
        const done = cur > idx;
        const active = cur === idx;
        return (
          <span key={key} className={`text-xs px-2.5 py-1 rounded-full border ${
            done   ? "border-green-600/50 bg-green-900/20 text-green-600" :
            active ? "border-[#5b6cff]/50 bg-[#5b6cff]/20 text-[#5b6cff] animate-pulse" :
                     "border-[#d6d9e6] text-[#9ba0b8]"
          }`}>
            {done ? "✓ " : active ? "▶ " : ""}{label}
          </span>
        );
      })}
    </div>
  );
}

// ── Idea Card ─────────────────────────────────────────────────────────
function IdeaCard({ idea, index, onSelect, onBookmark, bookmarked }: {
  idea: string; index: number; onSelect: () => void; onBookmark: () => void; bookmarked: boolean;
}) {
  const title = extractIdeaTitle(idea);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-[#d6d9e6] bg-white rounded-2xl p-4 flex flex-col gap-3 hover:border-[#5b6cff]/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-[#5b6cff] mb-1 block">案 {index + 1}</span>
          <p className="text-sm font-semibold text-[#171c33] leading-snug">{title}</p>
        </div>
        <button onClick={onBookmark} title={bookmarked ? "保留済み" : "保留に追加"}
          className={`shrink-0 text-xl transition-colors ${bookmarked ? "text-[#5b6cff]" : "text-[#9ba0b8] hover:text-[#5b6cff]"}`}>
          {bookmarked ? "★" : "☆"}
        </button>
      </div>
      {expanded && (
        <LinkedText text={idea} className="text-xs text-[#5a6080] whitespace-pre-wrap leading-relaxed border-t border-[#e3e5ef] pt-3" />
      )}
      <div className="flex gap-2 mt-auto">
        <button onClick={() => setExpanded(!expanded)}
          className="flex-1 text-xs py-2 border border-[#d6d9e6] hover:border-[#5b6cff] text-[#5a6080] hover:text-[#1e2440] rounded-xl transition-colors">
          {expanded ? "閉じる ▲" : "詳細 ▼"}
        </button>
        <button onClick={onSelect}
          className="flex-1 text-xs py-2 btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white font-bold rounded-xl transition-colors">
          この案で作成
        </button>
      </div>
    </div>
  );
}

// ── Debate Session ────────────────────────────────────────────────────
function DebateSession({ session, onUpdate }: { session: ChatSession; onUpdate: (s: ChatSession) => void }) {
  const [ideaRunning, setIdeaRunning] = useState(false);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [label, setLabel] = useState("");
  const [showDebate, setShowDebate] = useState(false);
  const [prompterOpen, setPrompterOpen] = useState(false);
  const [revOpen, setRevOpen] = useState(false);
  const [revComment, setRevComment] = useState("");
  const [revLoading, setRevLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session.messages.length]);

  const push = (s: ChatSession) => onUpdate({ ...s });
  const addMsg = (s: ChatSession, msg: AgentMessage): ChatSession => ({ ...s, messages: [...s.messages, msg] });

  const startDebate = async () => {
    setIdeaRunning(true);
    setLabel("🌐 トレンドを確認中…");
    // 毎朝Cronが自動収集したレポートがあれば使う（数秒で完了）。なければその場で検索
    let trendRes = await fetchLatestTrend();
    if (!trendRes) {
      setLabel("🌐 トレンドを収集中…");
      trendRes = await callAPI("trend_collect");
    }
    let s = addMsg({ ...session, step: "trend" }, { agent: "trend", content: trendRes });
    push(s);

    setLabel("💡 ネタ案を3つ生成中…");
    const ideaRes = await callAPI("idea_gen", trendRes + buildPerfContext());
    const ideas = parseIdeas(ideaRes);
    s = { ...addMsg(s, { agent: "idea", content: ideaRes }), step: "ideas", ideas };
    push(s);
    setIdeaRunning(false);
  };

  const toggleBookmark = (idx: number) => {
    const list = session.bookmarkedIdeas ?? [];
    const already = list.includes(idx);
    if (!already) addBookmark(session.ideas[idx]);
    onUpdate({ ...session, bookmarkedIdeas: already ? list.filter(i => i !== idx) : [...list, idx] });
  };

  const selectIdea = async (idx: number) => {
    setScriptRunning(true);
    let s: ChatSession = { ...session, selectedIdea: idx };

    setLabel("✍️ 初稿台本を作成中…");
    const draftRes = await callAPI("script_draft", session.ideas[idx]);
    const draftScript = extractBlock(draftRes, "SCRIPT_START", "SCRIPT_END") || draftRes;
    s = addMsg({ ...s, step: "draft" }, { agent: "draft", content: draftRes });
    push(s);

    setLabel("🏢📱 専門家2名が同時レビュー中…");
    const [re1, re2] = await Promise.all([
      callAPI("realestate_expert", draftScript),
      callAPI("sns_consultant", draftScript),
    ]);
    s = addMsg({ ...s, step: "review1" }, { agent: "realestate", content: re1 });
    s = addMsg({ ...s, step: "review2" }, { agent: "sns", content: re2 });
    push(s);

    setLabel("✍️ 台本作成者が改訂中…");
    const ctx = `【初稿台本】\n${draftScript}\n\n【不動産専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}`;
    const revRes = await callAPI("script_revision", ctx);
    let revScript = extractBlock(revRes, "REVISED_START", "REVISED_END") || revRes;
    s = addMsg({ ...s, step: "revision" }, { agent: "writer", content: revRes });
    push(s);

    // どちらかのレビューが85点未満なら、改訂版をもう1往復レビューさせる
    let finalRe1 = re1, finalRe2 = re2;
    const score1 = parseScore(re1), score2 = parseScore(re2);
    if ((score1 !== null && score1 < 85) || (score2 !== null && score2 < 85)) {
      setLabel("🔁 点数が基準未満のため再レビュー中…");
      const [re1b, re2b] = await Promise.all([
        callAPI("realestate_expert", revScript),
        callAPI("sns_consultant", revScript),
      ]);
      s = addMsg(s, { agent: "realestate", content: `【2回目レビュー】\n${re1b}` });
      s = addMsg(s, { agent: "sns", content: `【2回目レビュー】\n${re2b}` });
      push(s);

      setLabel("✍️ 2回目の指摘を反映して再改訂中…");
      const ctx2 = `【改訂台本】\n${revScript}\n\n【不動産専門家 2回目レビュー】\n${re1b}\n\n【SNSコンサル 2回目レビュー】\n${re2b}`;
      const revRes2 = await callAPI("script_revision", ctx2);
      revScript = extractBlock(revRes2, "REVISED_START", "REVISED_END") || revRes2;
      s = addMsg(s, { agent: "writer", content: `【再改訂】\n${revRes2}` });
      push(s);
      finalRe1 = re1b; finalRe2 = re2b;
    }

    setLabel("🏆 最終台本を仕上げ中…");
    const finalCtx = `【改訂台本】\n${revScript}\n\n【不動産専門家レビュー】\n${finalRe1}\n\n【SNSコンサルレビュー】\n${finalRe2}`;
    const finalRes = await callAPI("final_script", finalCtx);
    const finalScript = extractBlock(finalRes, "FINAL_START", "FINAL_END") || finalRes;
    s = addMsg({ ...s, step: "final", finalScript }, { agent: "final", content: finalRes });
    push(s);

    setLabel("🧵📝 Threads＆キャプションを生成中…");
    const [thrRes, capRes] = await Promise.all([
      callAPI("threads_master", finalScript),
      callAPI("caption_gen", finalScript),
    ]);
    const finalThreads = parseThreads(thrRes);
    const caption = extractBlock(capRes, "CAPTION_START", "CAPTION_END") || capRes;
    s = { ...s, step: "done", finalThreads, caption };
    push(s);

    saveLibraryItem({ id: s.id, title: extractIdeaTitle(session.ideas[idx]), script: finalScript, threads: finalThreads, caption, status: "none", createdAt: Date.now() });
    // Threadsキュー投入は「✅ このまま使う」で確定したときに行う（修正の余地を残すため）
    setScriptRunning(false);
    setLabel("");
  };

  // ✅ このまま使う：確定してThreads自動投稿キューへ
  const approve = async () => {
    if (!session.approved && session.finalThreads.length > 0) {
      fetch("/api/threads-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: session.title, posts: session.finalThreads }),
      }).catch(() => {});
    }
    onUpdate({ ...session, approved: true });
  };

  // ✏️ 修正指示を反映して再生成（キャプション・Threadsも作り直し）
  const submitRevision = async () => {
    if (!revComment.trim()) return;
    setRevLoading(true);
    setLabel("✍️ 修正指示を反映して再生成中…");
    try {
      const input = `【現在の台本】\n${session.finalScript}\n\n【ユーザーからの修正指示（最優先で反映）】\n${revComment}`;
      const revRes = await callAPI("user_revision", input);
      const newScript = extractBlock(revRes, "FINAL_START", "FINAL_END") || revRes;

      setLabel("🧵📝 キャプション＆Threadsを作り直し中…");
      const [thrRes, capRes] = await Promise.all([
        callAPI("threads_master", newScript),
        callAPI("caption_gen", newScript),
      ]);
      const newThreads = parseThreads(thrRes);
      const newCaption = extractBlock(capRes, "CAPTION_START", "CAPTION_END") || capRes;

      let s = addMsg(session, { agent: "writer", content: `【あなたの修正指示】${revComment}\n\n${revRes}` });
      s = {
        ...s,
        finalScript: newScript,
        finalThreads: newThreads.length > 0 ? newThreads : s.finalThreads,
        caption: newCaption,
        approved: false,
      };
      push(s);

      // ライブラリも修正版で更新（進捗ステータス・実績メモは維持）
      const existing = loadLibrary().find(i => i.id === s.id);
      saveLibraryItem({
        id: s.id, title: s.title, script: newScript,
        threads: s.finalThreads, caption: newCaption,
        status: existing?.status ?? "none",
        createdAt: existing?.createdAt ?? Date.now(),
        performance: existing?.performance,
      });
      setRevComment("");
      setRevOpen(false);
    } catch {
      setLabel("");
    }
    setRevLoading(false);
    setLabel("");
  };

  const bookmarked = session.bookmarkedIdeas ?? [];
  const isIdle = session.step === "idle" && !ideaRunning;
  const isGenIdeas = ideaRunning;
  const isSelectingIdea = session.step === "ideas" && !scriptRunning;
  const isGenScript = scriptRunning;
  const isDone = session.step === "done";

  return (
    <div className="flex flex-col h-full gap-4">
      {/* アイドル */}
      {isIdle && (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-4">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-sm text-[#7b809c] mb-6">AIチームがバズる台本を作り上げます</p>
          <button onClick={startDebate}
            className="px-8 py-3 btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white font-bold rounded-2xl text-sm transition-colors">
            🎬 ディスカッション開始
          </button>
          <p className="text-xs text-[#9ba0b8] mt-3">トレンド収集 → ネタ案3案 → 選択 → 討論 → 最終台本 → Threads</p>
        </div>
      )}

      {/* ネタ案生成中 */}
      {isGenIdeas && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4">
          <ProgressSteps step={session.step} />
          <div className="bg-white border border-[#e3e5ef] rounded-xl p-4 w-full max-w-md">
            <Spinner label={label} />
          </div>
        </div>
      )}

      {/* ネタ案選択 */}
      {isSelectingIdea && (
        <div className="flex flex-col flex-1 gap-4 overflow-y-auto output-scroll pb-4">
          <p className="text-sm font-semibold text-[#5b6cff] shrink-0">
            💡 ネタ案を選んでください <span className="text-[#7b809c] font-normal text-xs ml-1">★で保留にも追加できます</span>
          </p>
          {session.ideas.length === 0 ? (
            <div className="text-center py-8 text-[#7b809c] text-sm">
              ネタ案の読み込みに失敗しました。もう一度「新規」から試してください。
            </div>
          ) : (
            <div className="stagger grid grid-cols-1 sm:grid-cols-3 gap-3">
              {session.ideas.map((idea, i) => (
                <IdeaCard key={i} idea={idea} index={i}
                  onSelect={() => selectIdea(i)}
                  onBookmark={() => toggleBookmark(i)}
                  bookmarked={bookmarked.includes(i)}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* 台本生成中 */}
      {isGenScript && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4">
          <ProgressSteps step={session.step} />
          <div className="bg-white border border-[#e3e5ef] rounded-xl p-4 w-full max-w-md">
            <Spinner label={label} />
          </div>
        </div>
      )}

      {/* 完成 */}
      {isDone && (
        <div className="flex flex-col flex-1 gap-4 overflow-y-auto output-scroll pb-4">
          {/* 最終台本 */}
          <div className="border border-[#5b6cff]/40 bg-[#5b6cff]/10 rounded-2xl overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#5b6cff]/20">
              <span className="font-bold text-[#5b6cff] text-sm">🏆 完成台本</span>
              <div className="flex gap-2 items-center">
                <button onClick={() => setPrompterOpen(true)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-green-300 text-green-600 hover:border-green-500 transition-colors">
                  📖 プロンプター
                </button>
                <CopyBtn text={session.finalScript} />
              </div>
            </div>
            <LinkedText text={session.finalScript} className="p-4 text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed" />
          </div>

          {/* 確定 or 修正 */}
          <div className="shrink-0 space-y-3">
            <div className="flex gap-2">
              <button onClick={approve} disabled={session.approved || revLoading}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                  session.approved
                    ? "bg-green-100 text-green-600 border border-green-300"
                    : "bg-green-600 hover:bg-green-500 text-white"
                }`}>
                {session.approved ? "✅ 確定済み（Threads予約完了）" : "✅ このまま使う"}
              </button>
              <button onClick={() => setRevOpen(!revOpen)} disabled={revLoading}
                className="flex-1 py-2.5 text-sm font-bold rounded-xl border border-[#5b6cff]/50 text-[#5b6cff] hover:bg-[#5b6cff]/20 transition-colors">
                ✏️ 修正を入れる {revOpen ? "▲" : "▼"}
              </button>
            </div>

            {revOpen && (
              <div className="border border-[#5b6cff]/30 bg-white rounded-2xl p-4 space-y-3">
                <p className="text-xs text-[#5a6080]">修正してほしい点を自由に書いてください。台本作成者があなたの指示を最優先で反映し、キャプション・Threadsも作り直します。</p>
                <textarea value={revComment} onChange={e => setRevComment(e.target.value)} rows={3}
                  placeholder="例：フックが弱いので具体的な金額を入れて／もっと初心者向けの言葉にして／30秒に短縮して"
                  className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff]/50" />
                {revLoading ? (
                  <div className="py-1"><Spinner label={label} /></div>
                ) : (
                  <button onClick={submitRevision} disabled={!revComment.trim()}
                    className="w-full py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                    🔁 この指示で再生成する
                  </button>
                )}
              </div>
            )}
          </div>

          {/* キャプション */}
          {session.caption && (
            <div className="border border-pink-200 bg-pink-50 rounded-2xl overflow-hidden shrink-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-pink-500/20">
                <span className="font-bold text-pink-600 text-sm">📝 キャプション＆ハッシュタグ</span>
                <CopyBtn text={session.caption} />
              </div>
              <pre className="p-4 text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed">{session.caption}</pre>
            </div>
          )}

          {/* Threads */}
          {session.finalThreads.length > 0 && <ThreadsPanel posts={session.finalThreads} />}

          {/* 上司のやりとり（折りたたみ） */}
          <div className="border border-[#e3e5ef] rounded-2xl overflow-hidden shrink-0">
            <button onClick={() => setShowDebate(!showDebate)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#5a6080] hover:text-[#1e2440] hover:bg-[#f1f2f7]/50 transition-colors">
              <span>👥 上司のやりとりを{showDebate ? "隠す" : "見る"}</span>
              <span>{showDebate ? "▲" : "▼"}</span>
            </button>
            {showDebate && (
              <div className="p-4 space-y-3 border-t border-[#e3e5ef]">
                {session.messages.map((msg, i) => <AgentBubble key={i} msg={msg} />)}
              </div>
            )}
          </div>

          <div ref={bottomRef} />
        </div>
      )}

      {prompterOpen && session.finalScript && (
        <Teleprompter script={session.finalScript} onClose={() => setPrompterOpen(false)} />
      )}
    </div>
  );
}

// ── Weekly Plan Tab ───────────────────────────────────────────────────
function WeeklyTab({ goScript }: { goScript: () => void }) {
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
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
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

// ── Script Tab ────────────────────────────────────────────────────────
function ScriptTab() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
  }, []);

  const createSession = () => {
    const id = Date.now().toString();
    const s: ChatSession = { id, title: `台本 #${sessions.length + 1}`, createdAt: Date.now(), step: "idle", messages: [], ideas: [], bookmarkedIdeas: [], selectedIdea: null, finalScript: "", finalThreads: [] };
    const updated = [s, ...sessions];
    setSessions(updated); saveSessions(updated); setActiveId(id); setSidebarOpen(false);
  };

  const updateSession = (updated: ChatSession) => {
    setSessions(prev => { const next = prev.map(s => s.id === updated.id ? updated : s); saveSessions(next); return next; });
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next); saveSessions(next);
    if (activeId === id) setActiveId(next.length > 0 ? next[0].id : null);
  };

  const active = sessions.find(s => s.id === activeId);

  return (
    <div className="flex h-[calc(100vh-185px)] relative overflow-hidden">
      {/* モバイルオーバーレイ */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* サイドバー */}
      <aside className={`
        absolute md:relative z-20 top-0 left-0 h-full
        w-60 md:w-52 bg-white border-r border-[#e3e5ef] flex flex-col shrink-0
        transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <div className="p-3 border-b border-[#e3e5ef] flex gap-2">
          <button onClick={createSession}
            className="flex-1 py-2 btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white text-xs font-bold rounded-lg transition-colors">
            ＋ 新規
          </button>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-[#7b809c] px-2 text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto output-scroll p-2 space-y-1">
          {sessions.length === 0 && <p className="text-xs text-[#9ba0b8] text-center py-4">チャットなし</p>}
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveId(s.id); setSidebarOpen(false); }}
              className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${activeId === s.id ? "bg-[#f1f2f7] text-white" : "text-[#5a6080] hover:bg-[#f1f2f7]/50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{s.title}</p>
                <p className="text-xs text-[#9ba0b8]">{s.step === "done" ? "✅ 完了" : s.step !== "idle" ? "生成中…" : ""}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-[#9ba0b8] hover:text-red-600 text-xs ml-1 transition-opacity shrink-0">✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* メイン */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e3e5ef] shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-[#7b809c] hover:text-[#2a3052] text-sm px-2 py-1 rounded border border-[#e3e5ef] transition-colors shrink-0">☰</button>
          {active && <span className="text-sm text-[#5a6080] truncate">{active.title}</span>}
        </div>
        <div className="flex-1 overflow-hidden px-3 pt-4">
          {active ? (
            <DebateSession session={active} onUpdate={updateSession} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-[#9ba0b8]">
              <div className="text-5xl mb-4">🎬</div>
              <p className="text-sm mb-4">「新規」ボタンでチャットを作成</p>
              <button onClick={createSession} className="px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white font-bold rounded-xl text-sm">＋ 新しいチャット</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
    </div>
  );
}

interface QueueItem {
  id: number; title: string; posts: string[]; status: string; error: string | null;
  created_at: string; posted_at: string | null;
}

function ThreadsQueueSection() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [enabled, setEnabled] = useState(true);

  const reload = () => {
    fetch("/api/threads-queue").then(r => r.json())
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
      <p className="text-xs text-[#9ba0b8] mb-3">毎日19:00に上から1件ずつ自動投稿されます</p>
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

function LibraryTab() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkedIdea[]>([]);

  const reload = () => { setItems(loadLibrary()); setBookmarks(loadBookmarks()); };
  useEffect(() => { reload(); }, []);

  return (
    <div className="overflow-y-auto output-scroll h-[calc(100vh-185px)] px-3 md:px-6 py-5 space-y-8">
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

function DashboardTab() {
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

// ── News Tab ──────────────────────────────────────────────────────────
function NewsTab() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const run = async () => { setLoading(true); setOutput(""); setOutput(await callAPI("news_realestate")); setLoading(false); };
  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <button onClick={run} disabled={loading}
        className="mb-4 px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">
        {loading ? "生成中…" : "🗞 今日の時事ネタ×不動産を生成"}
      </button>
      {output && (
        <div className="bg-white border border-[#e3e5ef] rounded-2xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <LinkedText text={output} />
        </div>
      )}
    </div>
  );
}

// ── Analyze Tab ───────────────────────────────────────────────────────
function AnalyzeTab() {
  const [mode, setMode] = useState<AnalyzeMode>("buzz");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const run = async () => { if (!input.trim()) return; setLoading(true); setOutput(""); setOutput(await callAPI(mode === "buzz" ? "buzz_analyze" : "data_analyze", input)); setLoading(false); };
  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <div className="flex gap-2 mb-4">
        {(["buzz", "data"] as AnalyzeMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${mode === m ? "border-[#5b6cff] bg-[#5b6cff]/30 text-[#5b6cff]" : "border-[#d6d9e6] text-[#5a6080] hover:border-[#5b6cff]"}`}>
            {m === "buzz" ? "🔥 バズ投稿分析" : "📊 データ分析"}
          </button>
        ))}
      </div>
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={5}
        placeholder={mode === "buzz" ? "バズった投稿のURL・本文・数字を貼り付け…" : "フォロワー数・いいね数・リーチ数などを入力…"}
        className="w-full bg-white border border-[#e3e5ef] text-[#1e2440] text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff]/50 mb-3" />
      <button onClick={run} disabled={loading || !input.trim()}
        className="px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors mb-4">
        {loading ? "分析中…" : "🔍 分析する"}
      </button>
      {output && (
        <div className="bg-white border border-[#e3e5ef] rounded-2xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <LinkedText text={output} />
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState<Tab>("script");
  const [dark, setDark] = useState(false);

  // 初回はOS設定に追従、以降はlocalStorageの選択を維持
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initial = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(initial);
    document.documentElement.classList.toggle("dark", initial);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const tabs: { key: Tab; en: string; jp: string }[] = [
    { key: "weekly",    en: "Plan",    jp: "週間プラン" },
    { key: "script",    en: "Script",  jp: "台本生成" },
    { key: "library",   en: "Stock",   jp: "ライブラリ" },
    { key: "editor",    en: "Edit",    jp: "自動編集" },
    { key: "dashboard", en: "Growth",  jp: "ダッシュボード" },
    { key: "news",      en: "News",    jp: "時事ネタ" },
    { key: "analyze",   en: "Analyze", jp: "分析" },
  ];

  return (
    <div className="min-h-screen bg-transparent">
      {/* エディトリアル・ヘッダー */}
      <header className="px-5 md:px-8 pt-5 pb-1 flex items-end justify-between">
        <div>
          <h1 className="display-type text-3xl md:text-4xl text-white leading-none">
            R agent <span className="text-[#8b96ff]">SNS studio.</span>
          </h1>
          <p className="text-[11px] text-white/50 mt-1.5 font-medium tracking-wide">不動産アカウントを、仕組みで伸ばす。</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:block text-[10px] text-white/30 font-medium tracking-widest uppercase">Real Estate Growth Engine</span>
          <button onClick={toggleTheme} aria-label="テーマ切替"
            className="btn-pop w-9 h-9 rounded-full border border-white/15 text-base flex items-center justify-center hover:border-white/40 transition-colors">
            <span className="inline-block transition-transform duration-500" style={{ transform: dark ? "rotate(360deg)" : "rotate(0deg)" }}>
              {dark ? "🌙" : "☀️"}
            </span>
          </button>
        </div>
      </header>

      {/* スライド式ナビ：英語見出し＋日本語サブ */}
      <nav className="px-3 md:px-6 overflow-x-auto scrollbar-hide">
        <div className="flex min-w-max gap-1">
          {tabs.map(({ key, en, jp }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative px-4 py-2.5 text-left transition-colors whitespace-nowrap ${
                tab === key ? "" : "opacity-45 hover:opacity-80"
              }`}>
              <span className="display-type block text-base leading-tight text-white">{en}</span>
              <span className="block text-[10px] text-white/50 font-medium">{jp}</span>
              {tab === key && <span className="absolute left-3 right-3 bottom-0 h-[3px] rounded-full bg-[#8b96ff]" />}
            </button>
          ))}
        </div>
      </nav>
      <main key={tab} className="anim-in mx-2 md:mx-6 mt-3 mb-6 bg-white rounded-[28px] shadow-2xl shadow-black/40 overflow-hidden">
        {tab === "weekly"  && <WeeklyTab goScript={() => setTab("script")} />}
        {tab === "script"  && <ScriptTab />}
        {tab === "library" && <LibraryTab />}
        {tab === "editor"  && <EditorTab />}
        {tab === "dashboard" && <DashboardTab />}
        {tab === "news"    && <NewsTab />}
        {tab === "analyze" && <AnalyzeTab />}
      </main>
    </div>
  );
}
