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
    <pre className={className ?? "text-sm text-gray-200 whitespace-pre-wrap leading-relaxed"}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 underline hover:text-blue-300 break-all">
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
      className="text-xs px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors">
      {copied ? "✓ コピー済" : "コピー"}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-400">
      <svg className="animate-spin w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

const AGENT_META: Record<AgentMessage["agent"], { name: string; emoji: string; color: string }> = {
  trend:      { name: "トレンド収集",       emoji: "🌐", color: "border-blue-600/30 bg-blue-950/20" },
  idea:       { name: "ネタ案",             emoji: "💡", color: "border-yellow-600/30 bg-yellow-950/20" },
  draft:      { name: "台本作成者（初稿）",  emoji: "✍️", color: "border-gray-600/30 bg-gray-800/40" },
  realestate: { name: "不動産専門家上司",   emoji: "🏢", color: "border-red-600/30 bg-red-950/20" },
  sns:        { name: "SNSコンサル上司",    emoji: "📱", color: "border-purple-600/30 bg-purple-950/20" },
  writer:     { name: "台本作成者（改訂）",  emoji: "✍️", color: "border-green-600/30 bg-green-950/20" },
  final:      { name: "🏆 完成台本",        emoji: "🏆", color: "border-yellow-500/50 bg-yellow-900/20" },
};

function AgentBubble({ msg }: { msg: AgentMessage }) {
  const meta = AGENT_META[msg.agent] ?? { name: msg.agent, emoji: "🤖", color: "border-gray-600/30 bg-gray-800/40" };
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.content.length > 500;
  const preview = isLong && !expanded ? msg.content.slice(0, 400) + "…" : msg.content;
  return (
    <div className={`rounded-xl border p-4 ${meta.color}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
          <span>{meta.emoji}</span>{meta.name}
        </span>
        <div className="flex gap-1">
          {isLong && (
            <button onClick={() => setExpanded(!expanded)}
              className="text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700">
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
    <div className="border border-orange-500/40 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-orange-500/20 bg-orange-950/10">
        <div className="flex items-center gap-2">
          <span>🧵</span>
          <span className="font-semibold text-orange-400 text-sm">Threads 自動投稿</span>
          <span className="text-xs text-orange-400/50">{posts.length}投稿</span>
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
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-orange-400/70">投稿 {i + 1}</span>
                <div className="flex items-center gap-2">
                  <CopyBtn text={clean} />
                  <button onClick={() => postOne(i, post)} disabled={status === "posting" || status === "done"}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                      status === "done" ? "bg-green-900/40 text-green-400 border border-green-600/30" :
                      status === "error" ? "bg-red-900/40 text-red-400 border border-red-600/30" :
                      status === "posting" ? "bg-gray-700 text-gray-400" :
                      "bg-orange-600 hover:bg-orange-500 text-white"
                    }`}>
                    {status === "done" ? "✅ 済み" : status === "posting" ? "投稿中…" : status === "error" ? "❌ 再試行" : "投稿する"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{clean}</p>
              {status === "error" && errors[i] && <p className="text-xs text-red-400 mt-2">⚠ {errors[i]}</p>}
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
            done   ? "border-green-600/50 bg-green-900/20 text-green-400" :
            active ? "border-yellow-500/50 bg-yellow-900/20 text-yellow-400 animate-pulse" :
                     "border-gray-700 text-gray-600"
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
    <div className="border border-gray-700 bg-gray-900 rounded-2xl p-4 flex flex-col gap-3 hover:border-yellow-600/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-xs font-bold text-yellow-500 mb-1 block">案 {index + 1}</span>
          <p className="text-sm font-semibold text-gray-100 leading-snug">{title}</p>
        </div>
        <button onClick={onBookmark} title={bookmarked ? "保留済み" : "保留に追加"}
          className={`shrink-0 text-xl transition-colors ${bookmarked ? "text-yellow-400" : "text-gray-600 hover:text-yellow-400"}`}>
          {bookmarked ? "★" : "☆"}
        </button>
      </div>
      {expanded && (
        <LinkedText text={idea} className="text-xs text-gray-400 whitespace-pre-wrap leading-relaxed border-t border-gray-800 pt-3" />
      )}
      <div className="flex gap-2 mt-auto">
        <button onClick={() => setExpanded(!expanded)}
          className="flex-1 text-xs py-2 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 rounded-xl transition-colors">
          {expanded ? "閉じる ▲" : "詳細 ▼"}
        </button>
        <button onClick={onSelect}
          className="flex-1 text-xs py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl transition-colors">
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
    setScriptRunning(false);
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
          <p className="text-sm text-gray-500 mb-6">AIチームがバズる台本を作り上げます</p>
          <button onClick={startDebate}
            className="px-8 py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-2xl text-sm transition-colors">
            🎬 ディスカッション開始
          </button>
          <p className="text-xs text-gray-600 mt-3">トレンド収集 → ネタ案3案 → 選択 → 討論 → 最終台本 → Threads</p>
        </div>
      )}

      {/* ネタ案生成中 */}
      {isGenIdeas && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 px-4">
          <ProgressSteps step={session.step} />
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 w-full max-w-md">
            <Spinner label={label} />
          </div>
        </div>
      )}

      {/* ネタ案選択 */}
      {isSelectingIdea && (
        <div className="flex flex-col flex-1 gap-4 overflow-y-auto output-scroll pb-4">
          <p className="text-sm font-semibold text-yellow-400 shrink-0">
            💡 ネタ案を選んでください <span className="text-gray-500 font-normal text-xs ml-1">★で保留にも追加できます</span>
          </p>
          {session.ideas.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              ネタ案の読み込みに失敗しました。もう一度「新規」から試してください。
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 w-full max-w-md">
            <Spinner label={label} />
          </div>
        </div>
      )}

      {/* 完成 */}
      {isDone && (
        <div className="flex flex-col flex-1 gap-4 overflow-y-auto output-scroll pb-4">
          {/* 最終台本 */}
          <div className="border border-yellow-500/40 bg-yellow-900/10 rounded-2xl overflow-hidden shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-yellow-500/20">
              <span className="font-bold text-yellow-400 text-sm">🏆 完成台本</span>
              <div className="flex gap-2 items-center">
                <button onClick={() => setPrompterOpen(true)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-green-700/40 text-green-400 hover:border-green-500 transition-colors">
                  📖 プロンプター
                </button>
                <CopyBtn text={session.finalScript} />
              </div>
            </div>
            <LinkedText text={session.finalScript} className="p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed" />
          </div>

          {/* キャプション */}
          {session.caption && (
            <div className="border border-pink-500/30 bg-pink-950/10 rounded-2xl overflow-hidden shrink-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-pink-500/20">
                <span className="font-bold text-pink-400 text-sm">📝 キャプション＆ハッシュタグ</span>
                <CopyBtn text={session.caption} />
              </div>
              <pre className="p-4 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{session.caption}</pre>
            </div>
          )}

          {/* Threads */}
          {session.finalThreads.length > 0 && <ThreadsPanel posts={session.finalThreads} />}

          {/* 上司のやりとり（折りたたみ） */}
          <div className="border border-gray-800 rounded-2xl overflow-hidden shrink-0">
            <button onClick={() => setShowDebate(!showDebate)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors">
              <span>👥 上司のやりとりを{showDebate ? "隠す" : "見る"}</span>
              <span>{showDebate ? "▲" : "▼"}</span>
            </button>
            {showDebate && (
              <div className="p-4 space-y-3 border-t border-gray-800">
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
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button onClick={generate} disabled={loading}
          className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors">
          {loading ? "生成中…" : plan ? "📅 プランを作り直す" : "📅 今週のプランを生成"}
        </button>
        {plan && !loading && (
          <span className="text-xs text-gray-500">
            {new Date(plan.createdAt).toLocaleDateString("ja-JP")} 生成
            {trendInfo === "cron" && " ・今朝の自動収集トレンド使用"}
          </span>
        )}
      </div>

      {loading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 max-w-md">
          <Spinner label={label} />
        </div>
      )}

      {!loading && !plan && (
        <div className="text-center py-20 text-gray-600">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-sm">今週撮る5本分の投稿プランを一括生成します<br />各ネタは「台本化」ボタンでそのまま台本になります</p>
        </div>
      )}

      {!loading && plan && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plan.days.map((d, i) => (
            <div key={i} className={`border rounded-2xl p-4 flex flex-col gap-3 ${d.scripted ? "border-green-600/40 bg-green-950/10" : "border-gray-700 bg-gray-900"}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-yellow-500">{d.day || `${i + 1}本目`}</span>
                {d.scripted && <span className="text-xs text-green-400">✅ 台本化済み</span>}
              </div>
              <LinkedText text={d.idea} className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed flex-1" />
              <button onClick={() => makeScript(i)}
                className={`text-xs py-2 font-bold rounded-xl transition-colors ${d.scripted ? "border border-gray-700 text-gray-500 hover:text-gray-300" : "bg-yellow-600 hover:bg-yellow-500 text-black"}`}>
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
    <div className="flex h-[calc(100vh-96px)] relative overflow-hidden">
      {/* モバイルオーバーレイ */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* サイドバー */}
      <aside className={`
        absolute md:relative z-20 top-0 left-0 h-full
        w-60 md:w-52 bg-[#0a0d12] border-r border-gray-800 flex flex-col shrink-0
        transition-transform duration-200
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <div className="p-3 border-b border-gray-800 flex gap-2">
          <button onClick={createSession}
            className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-black text-xs font-bold rounded-lg transition-colors">
            ＋ 新規
          </button>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-gray-500 px-2 text-sm">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto output-scroll p-2 space-y-1">
          {sessions.length === 0 && <p className="text-xs text-gray-600 text-center py-4">チャットなし</p>}
          {sessions.map(s => (
            <div key={s.id} onClick={() => { setActiveId(s.id); setSidebarOpen(false); }}
              className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${activeId === s.id ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{s.title}</p>
                <p className="text-xs text-gray-600">{s.step === "done" ? "✅ 完了" : s.step !== "idle" ? "生成中…" : ""}</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 text-xs ml-1 transition-opacity shrink-0">✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* メイン */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-gray-300 text-sm px-2 py-1 rounded border border-gray-800 transition-colors shrink-0">☰</button>
          {active && <span className="text-sm text-gray-400 truncate">{active.title}</span>}
        </div>
        <div className="flex-1 overflow-hidden px-3 pt-4">
          {active ? (
            <DebateSession session={active} onUpdate={updateSession} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-5xl mb-4">🎬</div>
              <p className="text-sm mb-4">「新規」ボタンでチャットを作成</p>
              <button onClick={createSession} className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl text-sm">＋ 新しいチャット</button>
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
  filming: { label: "📷 撮影待ち", active: "bg-blue-900/50 text-blue-300 border-blue-600/40" },
  editing: { label: "🎬 編集中",   active: "bg-purple-900/50 text-purple-300 border-purple-600/40" },
  posted:  { label: "✅ 投稿済み", active: "bg-green-900/50 text-green-300 border-green-600/40" },
};

function LibraryCard({ item, onStatus, onDelete }: { item: LibraryItem; onStatus: (id: string, s: ProductionStatus) => void; onDelete: (id: string) => void }) {
  const [showScript, setShowScript] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [prompter, setPrompter] = useState(false);
  const statuses: ProductionStatus[] = ["filming", "editing", "posted"];

  return (
    <div className="border border-gray-800 bg-gray-900 rounded-2xl overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-100 leading-snug">{item.title}</p>
            <p className="text-xs text-gray-600 mt-0.5">{new Date(item.createdAt).toLocaleDateString("ja-JP")}</p>
          </div>
          <button onClick={() => onDelete(item.id)} className="text-gray-700 hover:text-red-500 text-xs transition-colors shrink-0">✕</button>
        </div>

        {/* 進捗ボタン */}
        <div className="flex gap-1.5 flex-wrap mb-3">
          {statuses.map(s => {
            const cfg = STATUS_CONFIG[s];
            const active = item.status === s;
            return (
              <button key={s} onClick={() => onStatus(item.id, active ? "none" : s)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${active ? `${cfg.active} border` : "border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600"}`}>
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
            className="w-full mb-3 bg-gray-800 border border-gray-700 text-gray-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-green-600/50 placeholder:text-gray-600"
          />
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowScript(!showScript)}
            className="flex-1 text-xs py-2 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 rounded-xl transition-colors">
            {showScript ? "台本を閉じる ▲" : "台本を見る ▼"}
          </button>
          <button onClick={() => setPrompter(true)}
            className="flex-1 text-xs py-2 border border-green-700/40 hover:border-green-500 text-green-400 rounded-xl transition-colors">
            📖 プロンプター
          </button>
          {item.threads.length > 0 && (
            <button onClick={() => setShowThreads(!showThreads)}
              className="flex-1 text-xs py-2 border border-orange-700/40 hover:border-orange-500 text-orange-400 rounded-xl transition-colors">
              🧵 Threads {showThreads ? "▲" : "▼"}
            </button>
          )}
        </div>
        {prompter && <Teleprompter script={item.script} onClose={() => setPrompter(false)} />}
      </div>

      {showScript && (
        <div className="border-t border-gray-800 p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={item.script} /></div>
          <LinkedText text={item.script} />
          {item.caption && (
            <div className="mt-4 pt-4 border-t border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-pink-400">📝 キャプション</span>
                <CopyBtn text={item.caption} />
              </div>
              <pre className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{item.caption}</pre>
            </div>
          )}
        </div>
      )}

      {showThreads && item.threads.length > 0 && (
        <div className="border-t border-gray-800 p-4">
          <ThreadsPanel posts={item.threads} />
        </div>
      )}
    </div>
  );
}

function LibraryTab() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkedIdea[]>([]);

  const reload = () => { setItems(loadLibrary()); setBookmarks(loadBookmarks()); };
  useEffect(() => { reload(); }, []);

  return (
    <div className="overflow-y-auto output-scroll h-[calc(100vh-96px)] px-3 md:px-6 py-5 space-y-8">
      {/* 保留ネタ案 */}
      {bookmarks.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-gray-200 mb-3">⭐ 保留ネタ案</h2>
          <div className="space-y-2">
            {bookmarks.map(b => (
              <div key={b.id} className="border border-yellow-700/30 bg-yellow-900/10 rounded-xl p-3 flex items-start gap-3">
                <LinkedText text={b.idea} className="text-xs text-gray-300 whitespace-pre-wrap flex-1 leading-relaxed" />
                <button onClick={() => { deleteBookmark(b.id); setBookmarks(loadBookmarks()); }}
                  className="text-gray-600 hover:text-red-500 text-xs shrink-0 mt-0.5">✕</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 台本ストック */}
      <section>
        <h2 className="text-sm font-bold text-gray-200 mb-3">🎬 台本ストック</h2>
        {items.length === 0 ? (
          <div className="text-center py-16 text-gray-600">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm">台本を生成するとここに自動保存されます</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
function FollowerChart({ history }: { history: { followers: number; created_at: string }[] }) {
  if (history.length < 2) return <p className="text-xs text-gray-600 py-6 text-center">データが2日分以上たまるとグラフが表示されます</p>;
  const W = 600, H = 160, PAD = 10;
  const vals = history.map(h => h.followers);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = Math.max(1, max - min);
  const pts = history.map((h, i) => {
    const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((h.followers - min) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
      <polyline points={pts} fill="none" stroke="#d4af37" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {history.map((h, i) => {
        const x = PAD + (i / (history.length - 1)) * (W - PAD * 2);
        const y = H - PAD - ((h.followers - min) / range) * (H - PAD * 2);
        return <circle key={i} cx={x} cy={y} r="3" fill="#d4af37" />;
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
      <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-8 max-w-2xl">
        <div className="text-4xl mb-4">📈</div>
        <h2 className="text-lg font-bold text-gray-100 mb-2">Instagram連携でダッシュボードが有効になります</h2>
        <p className="text-sm text-gray-400 mb-6 leading-relaxed">
          連携すると：フォロワー推移の自動記録 / 1万人達成日の予測 / 投稿ごとの再生・保存数の自動取得 / AIが実測データから学習してネタ精度が上がる
        </p>
        <div className="border border-gray-800 bg-gray-900 rounded-2xl p-5 space-y-4 text-sm text-gray-300">
          <p className="font-bold text-yellow-400">セットアップ手順（約10分）</p>
          <ol className="list-decimal list-inside space-y-2 leading-relaxed">
            <li>Instagramアプリ → 設定 → 「プロアカウントに切り替え」（無料）</li>
            <li>Facebookページを作成し、Instagramと連携（Meta Business Suite）</li>
            <li>developers.facebook.com でアプリ作成 → Graph API Explorer でアクセストークン取得</li>
            <li>VercelにIG_USER_ID / IG_ACCESS_TOKENを環境変数として追加</li>
            <li>Redeploy</li>
          </ol>
          <p className="text-xs text-gray-500">詳しい手順はチャットで「Instagram連携の手順を教えて」と聞いてください</p>
        </div>
      </div>
    );
  }

  const current = data.current ?? 0;
  const goal = data.goal ?? 10000;
  const pct = Math.min(100, (current / goal) * 100);

  return (
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-6">
      {/* 1万人ゴール */}
      <div className="border border-yellow-600/40 bg-yellow-900/10 rounded-2xl p-5">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <p className="text-xs text-gray-500 mb-1">現在のフォロワー</p>
            <p className="text-3xl font-black text-yellow-400">{current.toLocaleString()}<span className="text-sm text-gray-500 font-normal ml-2">/ {goal.toLocaleString()}人</span></p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">1日平均 <span className="text-green-400 font-bold">+{data.dailyGrowth ?? 0}</span></p>
            {data.projectedDate && (
              <p className="text-xs text-gray-400 mt-1">📅 達成予測：<span className="text-yellow-400 font-bold">{new Date(data.projectedDate).toLocaleDateString("ja-JP")}</span></p>
            )}
          </div>
        </div>
        <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-yellow-600 to-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-gray-600 mt-1.5">{pct.toFixed(1)}% 達成</p>
      </div>

      {/* フォロワー推移 */}
      <div className="border border-gray-800 bg-gray-900 rounded-2xl p-5">
        <p className="text-sm font-bold text-gray-200 mb-2">📈 フォロワー推移</p>
        <FollowerChart history={data.history ?? []} />
      </div>

      {/* 投稿パフォーマンス */}
      <div className="border border-gray-800 bg-gray-900 rounded-2xl p-5">
        <p className="text-sm font-bold text-gray-200 mb-3">🎬 投稿パフォーマンス（自動取得）</p>
        {(data.media ?? []).length === 0 ? (
          <p className="text-xs text-gray-600 py-4 text-center">明朝の自動取得後に表示されます</p>
        ) : (
          <div className="space-y-2">
            {(data.media ?? []).map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-gray-800 rounded-xl px-4 py-3">
                <a href={m.permalink ?? "#"} target="_blank" rel="noopener noreferrer"
                  className="flex-1 min-w-[180px] text-xs text-gray-300 hover:text-yellow-400 truncate transition-colors">
                  {(m.caption ?? "（キャプションなし）").slice(0, 40)}
                </a>
                <span className="text-xs text-gray-500">▶ {m.views?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-gray-500">📌 {m.saves?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-gray-500">❤️ {m.likes?.toLocaleString() ?? "-"}</span>
                <span className="text-xs text-gray-600">{m.posted_at ? new Date(m.posted_at).toLocaleDateString("ja-JP") : ""}</span>
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
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <button onClick={run} disabled={loading}
        className="mb-4 px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors">
        {loading ? "生成中…" : "🗞 今日の時事ネタ×不動産を生成"}
      </button>
      {output && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
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
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <div className="flex gap-2 mb-4">
        {(["buzz", "data"] as AnalyzeMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${mode === m ? "border-yellow-600 bg-yellow-900/30 text-yellow-400" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}>
            {m === "buzz" ? "🔥 バズ投稿分析" : "📊 データ分析"}
          </button>
        ))}
      </div>
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={5}
        placeholder={mode === "buzz" ? "バズった投稿のURL・本文・数字を貼り付け…" : "フォロワー数・いいね数・リーチ数などを入力…"}
        className="w-full bg-gray-900 border border-gray-800 text-gray-200 text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-yellow-600/50 mb-3" />
      <button onClick={run} disabled={loading || !input.trim()}
        className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors mb-4">
        {loading ? "分析中…" : "🔍 分析する"}
      </button>
      {output && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
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

  const tabs: { key: Tab; label: string }[] = [
    { key: "weekly",  label: "📅 週間プラン" },
    { key: "script",  label: "🎬 台本生成" },
    { key: "library", label: "📚 ライブラリ" },
    { key: "editor",  label: "🎞 自動編集" },
    { key: "dashboard", label: "📈 ダッシュボード" },
    { key: "news",    label: "🗞 時事ネタ" },
    { key: "analyze", label: "🔍 分析" },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <header className="border-b border-gray-800 bg-[#0a0d12] px-4 py-3">
        <span className="text-yellow-500 font-black text-sm tracking-wide">🏠 不動産SNSスタジオ</span>
      </header>
      <nav className="border-b border-gray-800 bg-[#0a0d12] overflow-x-auto scrollbar-hide">
        <div className="flex min-w-max">
          {tabs.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-5 py-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                tab === key ? "border-yellow-500 text-yellow-400" : "border-transparent text-gray-500 hover:text-gray-300"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </nav>
      {tab === "weekly"  && <WeeklyTab goScript={() => setTab("script")} />}
      {tab === "script"  && <ScriptTab />}
      {tab === "library" && <LibraryTab />}
      {tab === "editor"  && <EditorTab />}
      {tab === "dashboard" && <DashboardTab />}
      {tab === "news"    && <NewsTab />}
      {tab === "analyze" && <AnalyzeTab />}
    </div>
  );
}
