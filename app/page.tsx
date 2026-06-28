"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────
type Tab = "script" | "news" | "analyze";
type AnalyzeMode = "buzz" | "data";
type DebateStep = "idle" | "trend" | "ideas" | "draft" | "review1" | "review2" | "revision" | "final" | "threads" | "done";

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
  selectedIdea: number | null;
  finalScript: string;
  finalThreads: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────
async function callAPI(feature: string, input = "", options = {}): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, input, options }),
  });
  const data = await res.json();
  return data.reply ?? "エラーが発生しました";
}

function parseIdeas(text: string): string[] {
  const s = text.indexOf("IDEA_START"), e = text.indexOf("IDEA_END");
  if (s === -1 || e === -1) return [text];
  return text.slice(s + "IDEA_START".length, e).trim().split("IDEA_SPLIT").map(t => t.trim()).filter(Boolean);
}

function extractBlock(text: string, start: string, end: string): string {
  const s = text.indexOf(start), e = text.indexOf(end);
  if (s === -1 || e === -1) return text;
  return text.slice(s + start.length, e).trim();
}

function parseThreads(text: string): string[] {
  const s = text.indexOf("THREADS_START"), e = text.indexOf("THREADS_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "THREADS_START".length, e).trim().split("THREADS_SPLIT").map(t => t.trim()).filter(Boolean);
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem("debate_sessions", JSON.stringify(sessions));
}

function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem("debate_sessions") ?? "[]");
  } catch { return []; }
}

// ── UI Components ─────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}
      className="text-xs px-2 py-1 rounded border border-yellow-600/30 text-yellow-500/70 hover:bg-yellow-600/10 transition-colors whitespace-nowrap">
      {done ? "✅" : "📋"}
    </button>
  );
}

function Spinner({ label = "処理中..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-yellow-500/60 text-sm py-1">
      <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

const AGENT_META: Record<AgentMessage["agent"], { name: string; emoji: string; color: string }> = {
  trend:      { name: "トレンド収集",      emoji: "🌐", color: "border-blue-600/30 bg-blue-950/20" },
  idea:       { name: "ネタ案",            emoji: "💡", color: "border-yellow-600/30 bg-yellow-950/20" },
  draft:      { name: "台本作成者（初稿）", emoji: "✍️", color: "border-gray-600/30 bg-gray-800/40" },
  realestate: { name: "不動産専門家上司",  emoji: "🏢", color: "border-red-600/30 bg-red-950/20" },
  sns:        { name: "SNSコンサル上司",   emoji: "📱", color: "border-purple-600/30 bg-purple-950/20" },
  writer:     { name: "台本作成者（改訂）", emoji: "✍️", color: "border-green-600/30 bg-green-950/20" },
  final:      { name: "🏆 完成台本",       emoji: "🏆", color: "border-yellow-500/50 bg-yellow-900/20" },
};

function AgentBubble({ msg }: { msg: AgentMessage }) {
  const meta = AGENT_META[msg.agent];
  const [expanded, setExpanded] = useState(true);
  const isLong = msg.content.length > 600;
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
      <pre className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{preview}</pre>
    </div>
  );
}

// ── Threads Panel ────────────────────────────────────────────────────
function ThreadsPanel({ posts }: { posts: string[] }) {
  const [statuses, setStatuses] = useState<Record<number, "idle" | "posting" | "done" | "error">>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  const postOne = async (i: number, text: string) => {
    setStatuses(p => ({ ...p, [i]: "posting" }));
    try {
      const clean = text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
      const res = await fetch("/api/threads-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean }),
      });
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
    <div className="border border-orange-500/40 bg-[#0f1117] rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-orange-500/20 bg-orange-950/10">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧵</span>
          <span className="font-semibold text-orange-400 text-sm">Threads 自動投稿</span>
          <span className="text-xs text-orange-400/50">{posts.length}投稿</span>
        </div>
        <button
          onClick={postAll}
          className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg transition-colors"
        >
          ⚡ 全て投稿する
        </button>
      </div>

      <div className="p-4 space-y-3">
        {posts.map((post, i) => {
          const clean = post.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
          const status = statuses[i] ?? "idle";
          return (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-orange-400/70">投稿 {i + 1}</span>
                <div className="flex items-center gap-2">
                  <CopyBtn text={clean} />
                  <button
                    onClick={() => postOne(i, post)}
                    disabled={status === "posting" || status === "done"}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                      status === "done" ? "bg-green-900/40 text-green-400 border border-green-600/30" :
                      status === "error" ? "bg-red-900/40 text-red-400 border border-red-600/30" :
                      status === "posting" ? "bg-gray-700 text-gray-400" :
                      "bg-orange-600 hover:bg-orange-500 text-white"
                    }`}
                  >
                    {status === "done" ? "✅ 投稿済み" :
                     status === "posting" ? "投稿中..." :
                     status === "error" ? "❌ 再試行" :
                     "投稿する"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{clean}</p>
              {status === "error" && errors[i] && (
                <p className="text-xs text-red-400 mt-2">⚠ {errors[i]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Debate Script Tab ─────────────────────────────────────────────────
function DebateSession({ session, onUpdate }: {
  session: ChatSession;
  onUpdate: (s: ChatSession) => void;
}) {
  const [running, setRunning] = useState(false);
  const [currentLabel, setCurrentLabel] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.messages]);

  const push = (updated: ChatSession) => onUpdate({ ...updated });

  const addMsg = (session: ChatSession, msg: AgentMessage): ChatSession => ({
    ...session,
    messages: [...session.messages, msg],
  });

  const startDebate = async () => {
    setRunning(true);

    // STEP 1: トレンド収集
    setCurrentLabel("🌐 トレンドを収集中...");
    const trendRes = await callAPI("trend_collect");
    let s = addMsg({ ...session, step: "trend" }, { agent: "trend", content: trendRes });
    push(s);

    // STEP 2: ネタ案生成
    setCurrentLabel("💡 ネタ案を生成中...");
    const ideaRes = await callAPI("idea_gen", trendRes);
    const ideas = parseIdeas(ideaRes);
    s = { ...addMsg(s, { agent: "idea", content: ideaRes }), step: "ideas", ideas };
    push(s);
    setRunning(false);
  };

  const selectIdea = async (idx: number) => {
    setRunning(true);
    let s: ChatSession = { ...session, selectedIdea: idx };

    // STEP 3: 初稿台本
    setCurrentLabel("✍️ 初稿台本を作成中...");
    const draftRes = await callAPI("script_draft", session.ideas[idx]);
    const draftScript = extractBlock(draftRes, "SCRIPT_START", "SCRIPT_END") || draftRes;
    s = addMsg({ ...s, step: "draft" }, { agent: "draft", content: draftRes });
    push(s);

    // STEP 4: 不動産専門家レビュー
    setCurrentLabel("🏢 不動産専門家が確認中...");
    const re1 = await callAPI("realestate_expert", draftScript);
    s = addMsg({ ...s, step: "review1" }, { agent: "realestate", content: re1 });
    push(s);

    // STEP 5: SNSコンサルレビュー
    setCurrentLabel("📱 SNSコンサルタントが確認中...");
    const re2 = await callAPI("sns_consultant", draftScript);
    s = addMsg({ ...s, step: "review2" }, { agent: "sns", content: re2 });
    push(s);

    // STEP 6: 台本作成者が改訂
    setCurrentLabel("✍️ 台本作成者が改訂中...");
    const context = `【初稿台本】\n${draftScript}\n\n【不動産専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}`;
    const revRes = await callAPI("script_revision", context);
    const revScript = extractBlock(revRes, "REVISED_START", "REVISED_END") || revRes;
    s = addMsg({ ...s, step: "revision" }, { agent: "writer", content: revRes });
    push(s);

    // STEP 7: 最終台本
    setCurrentLabel("🏆 最終台本を仕上げ中...");
    const finalCtx = `【改訂台本】\n${revScript}\n\n【不動産専門家レビュー】\n${re1}\n\n【SNSコンサルレビュー】\n${re2}`;
    const finalRes = await callAPI("final_script", finalCtx);
    const finalScript = extractBlock(finalRes, "FINAL_START", "FINAL_END") || finalRes;
    s = addMsg({ ...s, step: "final", finalScript }, { agent: "final", content: finalRes });
    push(s);

    // STEP 8: Threads専門上司
    setCurrentLabel("🧵 Threads投稿を生成中...");
    const thrRes = await callAPI("threads_master", finalScript);
    const threads = parseThreads(thrRes);
    s = { ...s, step: "done", finalThreads: threads };
    push(s);

    setRunning(false);
    setCurrentLabel("");
  };

  const isIdle = session.step === "idle";
  const hasIdeas = session.ideas.length > 0;
  const isDone = session.step === "done";

  return (
    <div className="flex flex-col h-full">
      {/* メッセージ一覧 */}
      <div className="flex-1 overflow-y-auto output-scroll space-y-4 pb-4">
        {session.messages.length === 0 && (
          <div className="text-center py-16 text-gray-600">
            <div className="text-4xl mb-3">🎬</div>
            <p className="text-sm">「ディスカッション開始」を押すと<br />AIチームが台本を作り上げます</p>
          </div>
        )}
        {session.messages.map((msg, i) => (
          <AgentBubble key={i} msg={msg} />
        ))}

        {/* ネタ案選択UI */}
        {hasIdeas && session.selectedIdea === null && !running && (
          <div className="border border-yellow-600/40 bg-gray-900 rounded-xl p-4">
            <p className="text-sm font-semibold text-yellow-400 mb-3">💡 ネタ案を選んでください</p>
            <div className="space-y-2">
              {session.ideas.map((idea, i) => (
                <button key={i} onClick={() => selectIdea(i)}
                  className="w-full text-left p-3 rounded-xl border border-gray-700 bg-gray-800 hover:border-yellow-600/60 hover:bg-gray-700 transition-all">
                  <span className="text-yellow-500 font-bold text-xs mr-2">案{i + 1}</span>
                  <span className="text-sm text-gray-200">{idea.slice(0, 80)}...</span>
                </button>
              ))}
            </div>
          </div>
        )}


        {running && <div className="bg-gray-900 border border-gray-800 rounded-xl p-4"><Spinner label={currentLabel} /></div>}
        <div ref={bottomRef} />
      </div>

      {/* Threadsパネル（チャットとは独立した専用エリア） */}
      {isDone && session.finalThreads.length > 0 && (
        <div className="border-t border-gray-800 pt-4 mt-2 max-h-[45vh] overflow-y-auto output-scroll">
          <ThreadsPanel posts={session.finalThreads} />
        </div>
      )}

      {/* アクションボタン */}
      {isIdle && !running && (
        <div className="pt-4 border-t border-gray-800">
          <button onClick={startDebate}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
            🎬 ディスカッション開始
          </button>
          <p className="text-xs text-gray-600 text-center mt-2">
            トレンド収集 → ネタ案 → 初稿 → 不動産専門家・SNSコンサル討論 → 最終台本 → Threads
          </p>
        </div>
      )}
    </div>
  );
}

// ── Script Tab with sidebar ───────────────────────────────────────────
function ScriptTab() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    if (loaded.length > 0) setActiveId(loaded[0].id);
  }, []);

  const createSession = () => {
    const id = Date.now().toString();
    const newSession: ChatSession = {
      id, title: `台本 #${sessions.length + 1}`,
      createdAt: Date.now(), step: "idle",
      messages: [], ideas: [], selectedIdea: null,
      finalScript: "", finalThreads: [],
    };
    const updated = [newSession, ...sessions];
    setSessions(updated);
    saveSessions(updated);
    setActiveId(id);
  };

  const updateSession = (updated: ChatSession) => {
    setSessions(prev => {
      const next = prev.map(s => s.id === updated.id ? updated : s);
      saveSessions(next);
      return next;
    });
  };

  const deleteSession = (id: string) => {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next);
    saveSessions(next);
    if (activeId === id) setActiveId(next.length > 0 ? next[0].id : null);
  };

  const activeSession = sessions.find(s => s.id === activeId);

  const stepLabels: Record<DebateStep, string> = {
    idle: "", trend: "収集中", ideas: "ネタ選択中", draft: "初稿作成",
    review1: "専門家レビュー", review2: "SNSレビュー", revision: "改訂中",
    final: "最終台本", threads: "Threads生成", done: "✅ 完了",
  };

  return (
    <div className="flex h-[calc(100vh-110px)] gap-0">
      {/* サイドバー */}
      <div className={`${sidebarOpen ? "w-56" : "w-0"} transition-all duration-200 overflow-hidden shrink-0 border-r border-gray-800 flex flex-col bg-[#0a0d12]`}>
        <div className="p-3 border-b border-gray-800">
          <button onClick={createSession}
            className="w-full py-2 bg-yellow-600 hover:bg-yellow-500 text-black text-sm font-bold rounded-lg transition-colors flex items-center justify-center gap-1">
            ＋ 新しいチャット
          </button>
        </div>
        <div className="flex-1 overflow-y-auto output-scroll p-2 space-y-1">
          {sessions.length === 0 && (
            <p className="text-xs text-gray-600 text-center py-4">チャットがありません</p>
          )}
          {sessions.map(s => (
            <div key={s.id}
              onClick={() => setActiveId(s.id)}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${activeId === s.id ? "bg-gray-800 text-white" : "text-gray-400 hover:bg-gray-800/50"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{s.title}</p>
                {s.step !== "idle" && (
                  <p className="text-xs text-gray-600 truncate">{stepLabels[s.step]}</p>
                )}
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-500 text-xs ml-1 transition-opacity">✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* メインエリア */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1 rounded border border-gray-800 transition-colors">
            {sidebarOpen ? "◀" : "▶"}
          </button>
          {activeSession && (
            <span className="text-sm text-gray-400">{activeSession.title}</span>
          )}
        </div>

        <div className="flex-1 overflow-hidden px-4 pt-4">
          {activeSession ? (
            <DebateSession session={activeSession} onUpdate={updateSession} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-5xl mb-4">🎬</div>
              <p className="text-sm mb-4">「新しいチャット」を作成してください</p>
              <button onClick={createSession}
                className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl transition-colors text-sm">
                ＋ 新しいチャットを作成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: 時事ネタ ───────────────────────────────────────────────────
function NewsTab() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const run = async () => {
    setLoading(true); setOutput("");
    const res = await callAPI("news_realestate");
    setOutput(res); setLoading(false);
  };
  return (
    <div className="space-y-4 max-w-3xl mx-auto py-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <p className="text-sm text-gray-400 mb-4">ボタン1つで今日のニュースをWeb検索し、不動産×時事の投稿案を3つ自動生成します。</p>
        <button onClick={run} disabled={loading}
          className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 text-black font-bold rounded-xl transition-colors flex items-center justify-center gap-2">
          {loading ? <Spinner label="ニュース収集中..." /> : "📰 今日のネタを生成する"}
        </button>
      </div>
      {output && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <pre className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed output-scroll max-h-[500px] overflow-y-auto">{output}</pre>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: 分析ツール ─────────────────────────────────────────────────
function AnalyzeTab() {
  const [mode, setMode] = useState<AnalyzeMode>("buzz");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const [buzzInput, setBuzzInput] = useState("");
  const [dataInput, setDataInput] = useState({
    followers: "", genre: "balanced",
    posts: Array(5).fill({ likes: "", saves: "", views: "" }),
  });

  const runBuzz = async () => {
    if (!buzzInput.trim()) return;
    setLoading(true); setOutput("");
    setOutput(await callAPI("buzz_analyze", buzzInput));
    setLoading(false);
  };

  const runData = async () => {
    setLoading(true); setOutput("");
    const summary = `フォロワー数：${dataInput.followers}\nジャンル：${dataInput.genre}\n直近5投稿：\n${dataInput.posts.map((p, i) => `投稿${i + 1}：いいね${p.likes}/保存${p.saves}/再生${p.views}`).join("\n")}`;
    setOutput(await callAPI("data_analyze", summary));
    setLoading(false);
  };

  const updatePost = (idx: number, key: string, val: string) => {
    setDataInput(prev => {
      const posts = [...prev.posts];
      posts[idx] = { ...posts[idx], [key]: val };
      return { ...prev, posts };
    });
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto py-4">
      <div className="flex gap-2">
        {(["buzz", "data"] as AnalyzeMode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setOutput(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m ? "bg-yellow-600 text-black" : "bg-gray-800 text-gray-400 hover:text-gray-200"}`}>
            {m === "buzz" ? "🔍 バズ投稿を分析" : "📊 数値データを分析"}
          </button>
        ))}
      </div>

      {mode === "buzz" ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <textarea value={buzzInput} onChange={e => setBuzzInput(e.target.value)}
            placeholder="バズった投稿のURL or テキストを貼り付け"
            className="w-full min-h-32 p-3 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 placeholder-gray-600 resize-none outline-none focus:border-yellow-600/60" />
          <button onClick={runBuzz} disabled={loading || !buzzInput.trim()}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 text-black font-bold rounded-xl transition-colors">
            {loading ? "分析中..." : "🔍 分析する"}
          </button>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">フォロワー数</label>
              <input value={dataInput.followers} onChange={e => setDataInput(p => ({ ...p, followers: e.target.value }))}
                placeholder="1200" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 outline-none focus:border-yellow-600/60" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">ジャンル</label>
              <select value={dataInput.genre} onChange={e => setDataInput(p => ({ ...p, genre: e.target.value }))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 outline-none">
                <option value="balanced">両方</option>
                <option value="buyer">購入層向け</option>
                <option value="seller">売却層向け</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-2">直近5投稿のデータ</label>
            <div className="space-y-2">
              {dataInput.posts.map((p, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  {(["likes", "saves", "views"] as const).map(k => (
                    <input key={k} value={p[k]} onChange={e => updatePost(i, k, e.target.value)}
                      placeholder={k === "likes" ? `投稿${i + 1} いいね` : k === "saves" ? "保存" : "再生"}
                      className="px-2 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-yellow-600/60" />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <button onClick={runData} disabled={loading || !dataInput.followers}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 text-black font-bold rounded-xl transition-colors">
            {loading ? "分析中..." : "📊 分析する"}
          </button>
        </div>
      )}

      {output && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <pre className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed output-scroll max-h-[500px] overflow-y-auto">{output}</pre>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState<Tab>("script");

  const tabs = [
    { id: "script" as Tab, emoji: "🎬", label: "ネタ・台本生成" },
    { id: "news" as Tab, emoji: "📰", label: "時事ネタ×不動産" },
    { id: "analyze" as Tab, emoji: "🔍", label: "分析ツール" },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">
      <header className="border-b border-gray-800 bg-[#0f1117]/95 backdrop-blur sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-yellow-600 flex items-center justify-center text-lg">🏠</div>
          <div>
            <h1 className="font-bold text-white text-base leading-none">
              不動産SNSスタジオ <span className="text-yellow-500">v3</span>
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">AIチームが議論して完璧な台本を仕上げる</p>
          </div>
        </div>
        <div className="px-4 flex gap-0 border-b border-gray-800">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-all ${tab === t.id ? "border-yellow-500 text-yellow-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              <span>{t.emoji}</span><span>{t.label}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {tab === "script" && <ScriptTab />}
        {tab === "news" && <NewsTab />}
        {tab === "analyze" && <AnalyzeTab />}
      </div>
    </div>
  );
}
