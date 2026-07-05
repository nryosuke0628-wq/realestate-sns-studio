// ジャンル横断で使う共通型（page.tsx / TodayTab / ScriptTab / LibraryTab などから利用）
export type Genre = "realestate" | "coaching" | "sales";

export interface DashboardData {
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
export type AnalyzeMode = "buzz" | "data";
export type DebateStep = "idle" | "trend" | "ideas" | "draft" | "review1" | "review2" | "revision" | "final" | "threads" | "done";
export type ProductionStatus = "none" | "filming" | "editing" | "posted";

export interface AgentMessage {
  agent: "trend" | "idea" | "draft" | "realestate" | "sns" | "writer" | "final";
  content: string;
}

export interface ChatSession {
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

export interface LibraryItem {
  id: string;
  title: string;
  script: string;
  threads: string[];
  status: ProductionStatus;
  createdAt: number;
  performance?: string; // 投稿後の実績メモ（再生数・保存数など）
  caption?: string;
  postedAt?: number; // 「投稿済み」にした日時（今日の3案タブの週間カウント用）
}

export interface WeeklyPlan {
  createdAt: number;
  days: { day: string; idea: string; scripted: boolean }[];
}

export interface BookmarkedIdea {
  id: string;
  idea: string;
  createdAt: number;
}
