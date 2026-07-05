"use client";

import { useState, useEffect, useRef } from "react";
import Teleprompter from "./Teleprompter";
import { LinkedText, CopyBtn, Spinner, ThreadsPanel } from "./StudioShared";
import type { AgentMessage, ChatSession, DebateStep } from "@/lib/studio-types";
import {
  currentGenre, callAPI, parseIdeas, parseThreads, extractBlock, extractIdeaTitle,
  parseScore, buildPerfContext, fetchLatestTrend, loadSessions, saveSessions,
  loadLibrary, saveLibraryItem, addBookmark,
} from "@/lib/studio-storage";

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
  const [viralOpen, setViralOpen] = useState(false);
  const [viralInput, setViralInput] = useState("");
  const [revOpen, setRevOpen] = useState(false);
  const [revComment, setRevComment] = useState("");
  const [revLoading, setRevLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [session.messages.length]);

  const push = (s: ChatSession) => onUpdate({ ...s });
  const addMsg = (s: ChatSession, msg: AgentMessage): ChatSession => ({ ...s, messages: [...s.messages, msg] });

  // 🚀 バズ投稿から逆算：貼り付けがあればそれを最優先、なければAIがジャンル横断収集
  const startViral = async () => {
    setIdeaRunning(true);
    let source = viralInput.trim();
    if (source) {
      setLabel("🚀 貼り付けたバズ投稿を分析中…");
      source = `【ユーザーが指定したバズ投稿（最優先の参考元）】\n${source}`;
    } else {
      setLabel("🚀 ジャンル横断でバズ投稿を収集中…");
      source = await callAPI("viral_collect");
    }
    let s = addMsg({ ...session, step: "trend" }, { agent: "trend", content: source });
    push(s);

    setLabel("💡 バズの型をこのジャンルのネタ案に変換中…");
    const ideaRes = await callAPI("viral_convert", source + buildPerfContext());
    const ideas = parseIdeas(ideaRes);
    s = { ...addMsg(s, { agent: "idea", content: ideaRes }), step: "ideas", ideas };
    push(s);
    setIdeaRunning(false);
  };

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
        body: JSON.stringify({ title: session.title, posts: session.finalThreads, genre: currentGenre() }),
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
        <div className="flex flex-col items-center justify-center flex-1 px-4 py-6 overflow-y-auto output-scroll">
          <p className="text-sm text-[#7b809c] mb-5 text-center">進め方を選んでください</p>
          <div className="stagger grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
            {/* 従来：トレンドから */}
            <button onClick={startDebate}
              className="card-hover text-left border border-[#e3e5ef] bg-white rounded-2xl p-5 hover:border-[#5b6cff]/60 transition-colors">
              <div className="text-3xl mb-2">🔍</div>
              <p className="display-type text-base text-[#171c33] mb-1">トレンドから探す</p>
              <p className="text-xs text-[#5a6080] leading-relaxed">ジャンルの最新トレンドを収集してネタ案3つを提案。いつもの流れ</p>
            </button>
            {/* 新：バズ投稿から逆算 */}
            <button onClick={() => setViralOpen(true)}
              className={`card-hover text-left border rounded-2xl p-5 transition-colors ${viralOpen ? "border-[#5b6cff] bg-[#eef0ff]" : "border-[#e3e5ef] bg-white hover:border-[#5b6cff]/60"}`}>
              <div className="text-3xl mb-2">🚀</div>
              <p className="display-type text-base text-[#171c33] mb-1">バズ投稿から逆算</p>
              <p className="text-xs text-[#5a6080] leading-relaxed">ジャンル問わず伸びてる投稿の「型」を分析して、このジャンルのネタに変換</p>
            </button>
          </div>

          {viralOpen && (
            <div className="anim-in w-full max-w-2xl mt-4 border border-[#5b6cff]/40 bg-white rounded-2xl p-4 space-y-3">
              <p className="text-xs text-[#5a6080] leading-relaxed">
                参考にしたいバズ投稿があれば貼ってください（複数OK）。
                <span className="text-red-500 font-semibold">⚠ InstagramのURLは中身を読み取れないため、URLだけでなく「何を話してる投稿か・フックの言葉・再生数」を一言添えてください。</span>
                その説明が最優先の参考元になります。空欄ならAIがジャンル横断で収集します。
              </p>
              <textarea value={viralInput} onChange={e => setViralInput(e.target.value)} rows={4}
                placeholder={"例：\n・https://www.instagram.com/reel/xxxx（美容系・50万再生）フックは「毛穴ケア、9割が間違ってます」\n・TikTokで見た「新卒1年目に戻れるなら」系の語りが伸びてた"}
                className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff] placeholder:text-[#a6abc2]" />
              <button onClick={startViral}
                className="w-full py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] text-white text-sm font-bold rounded-xl transition-colors">
                🚀 この方針でネタ案を作る
              </button>
            </div>
          )}
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

// ── Script Tab ────────────────────────────────────────────────────────
export default function ScriptTab() {
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
    <div className="flex h-full relative overflow-hidden">
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
