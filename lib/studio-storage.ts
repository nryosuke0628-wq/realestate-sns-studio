import type { ChatSession, LibraryItem, ProductionStatus, WeeklyPlan, BookmarkedIdea } from "./studio-types";

export function currentGenre(): string {
  if (typeof window === "undefined") return "realestate";
  return localStorage.getItem("studio_genre") ?? "realestate";
}

// ジャンルごとにデータを完全分離（不動産・コーチング・AIは別アカウント運用のため）
export function gKey(base: string): string {
  const g = currentGenre();
  return g === "realestate" ? base : `${base}_${g}`;
}

export async function callAPI(feature: string, input = "", options = {}): Promise<string> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature, input, options, genre: currentGenre() }),
  });
  const data = await res.json();
  return data.reply ?? data.error ?? "";
}

export function parseIdeas(text: string): string[] {
  const s = text.indexOf("IDEA_START"), e = text.indexOf("IDEA_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "IDEA_START".length, e).split("IDEA_SPLIT").map(t => t.trim()).filter(Boolean);
}

export function parseThreads(text: string): string[] {
  const s = text.indexOf("THREADS_START"), e = text.indexOf("THREADS_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "THREADS_START".length, e).trim().split("THREADS_SPLIT").map(t => t.trim()).filter(Boolean);
}

export function extractBlock(text: string, start: string, end: string): string {
  const s = text.indexOf(start), e = text.indexOf(end);
  if (s === -1 || e === -1) return "";
  return text.slice(s + start.length, e).trim();
}

export function extractIdeaTitle(idea: string): string {
  const match = idea.match(/タイトル[：:]\s*(.+)/);
  return match ? match[1].trim() : idea.slice(0, 40).replace(/\n/g, " ");
}

// レビューの「**合計**：85点/100点」から点数を抽出
export function parseScore(review: string): number | null {
  const match = review.match(/合計[^\d]*(\d+)\s*点/);
  return match ? parseInt(match[1], 10) : null;
}

export function parsePlan(text: string): { day: string; idea: string; scripted: boolean }[] {
  const s = text.indexOf("PLAN_START"), e = text.indexOf("PLAN_END");
  if (s === -1 || e === -1) return [];
  return text.slice(s + "PLAN_START".length, e).split("PLAN_SPLIT").map(t => t.trim()).filter(Boolean)
    .map(idea => {
      const dayMatch = idea.match(/【(.+?)】/);
      return { day: dayMatch ? dayMatch[1] : "", idea, scripted: false };
    });
}

// Cronが毎朝収集したトレンドレポート（24h以内）を取得。なければnull
export async function fetchLatestTrend(): Promise<string | null> {
  try {
    const res = await fetch("/api/trend-latest");
    const data = await res.json();
    return data.report ?? null;
  } catch { return null; }
}

// 過去の投稿実績を学習コンテキストとして組み立て
export function buildPerfContext(): string {
  const posted = loadLibrary().filter(i => i.status === "posted" && i.performance).slice(0, 5);
  return posted.length > 0
    ? `\n\n【自分の過去投稿の実績】\n${posted.map(i => `・「${i.title}」→ ${i.performance}`).join("\n")}\n※実績が良いテーマ・切り口の傾向を優先すること`
    : "";
}

// ── Storage ───────────────────────────────────────────────────────────
export function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(gKey("debate_sessions")) ?? "[]"); } catch { return []; }
}
export function saveSessions(s: ChatSession[]) { localStorage.setItem(gKey("debate_sessions"), JSON.stringify(s)); }

export function loadLibrary(): LibraryItem[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(gKey("script_library")) ?? "[]"); } catch { return []; }
}
export function saveLibraryItem(item: LibraryItem) {
  const next = [item, ...loadLibrary().filter(i => i.id !== item.id)];
  localStorage.setItem(gKey("script_library"), JSON.stringify(next));
}
export function updateLibraryStatus(id: string, status: ProductionStatus) {
  localStorage.setItem(gKey("script_library"), JSON.stringify(loadLibrary().map(i =>
    i.id === id ? { ...i, status, postedAt: status === "posted" ? (i.postedAt ?? Date.now()) : i.postedAt } : i)));
}
export function deleteLibraryItem(id: string) {
  localStorage.setItem(gKey("script_library"), JSON.stringify(loadLibrary().filter(i => i.id !== id)));
}
export function updateLibraryPerformance(id: string, performance: string) {
  localStorage.setItem(gKey("script_library"), JSON.stringify(loadLibrary().map(i => i.id === id ? { ...i, performance } : i)));
}

export function loadWeeklyPlan(): WeeklyPlan | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem(gKey("weekly_plan")) ?? "null"); } catch { return null; }
}
export function saveWeeklyPlan(plan: WeeklyPlan) { localStorage.setItem(gKey("weekly_plan"), JSON.stringify(plan)); }

// 週間プランのネタから台本生成セッションを作成（台本生成タブに引き継ぐ）
export function createSessionFromIdea(idea: string): void {
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

export function loadBookmarks(): BookmarkedIdea[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(gKey("bookmarked_ideas")) ?? "[]"); } catch { return []; }
}
export function addBookmark(idea: string) {
  const item: BookmarkedIdea = { id: Date.now().toString(), idea, createdAt: Date.now() };
  localStorage.setItem(gKey("bookmarked_ideas"), JSON.stringify([item, ...loadBookmarks()]));
}
export function deleteBookmark(id: string) {
  localStorage.setItem(gKey("bookmarked_ideas"), JSON.stringify(loadBookmarks().filter(i => i.id !== id)));
}
