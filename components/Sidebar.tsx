"use client";

import { AgentId } from "@/lib/agents";

interface QuickAction {
  label: string;
  agentId: AgentId;
  message?: string;
  template?: string;
}

const quickActions: QuickAction[] = [
  {
    label: "📰 今週のトレンド調査",
    agentId: "research",
    message: "今週の不動産市場とSNSトレンドを調査して、Instagram発信に使えるネタをまとめてください。",
  },
  {
    label: "💡 コンテンツ案を5つ出す",
    agentId: "content",
    message: "購入層・売却層向けのInstagram Reelsコンテンツ案を5つ提案してください。",
  },
  {
    label: "🎬 Reels台本を作る",
    agentId: "script",
    message: "購入層向けの60秒Reels台本を1本作成してください。テーマは「マイホーム購入で後悔しないポイント」でお願いします。",
  },
  {
    label: "📊 投稿戦略を立てる",
    agentId: "consultant",
    message: "不動産Instagramアカウントのフォロワーを伸ばすための投稿戦略を教えてください。現在フォロワー数は少ない状態からスタートです。",
  },
  {
    label: "✏️ 投稿内容を壁打ち",
    agentId: "review",
    template: "以下の投稿内容をレビューしてください。\n\n【投稿内容】\n（ここに投稿内容を貼り付けてください）\n\n【対象ターゲット】\n購入層 / 売却層（どちらか選んでください）",
  },
  {
    label: "🔥 フックを改善する",
    agentId: "script",
    template: "以下のReelsのフック（冒頭0-3秒）を改善してください。\n\n【現在のフック】\n（ここにフックを貼り付けてください）\n\n【ターゲット】\n購入層 / 売却層（どちらか選んでください）",
  },
];

interface SidebarProps {
  onQuickAction: (agentId: AgentId, message: string, isTemplate: boolean) => void;
}

export default function Sidebar({ onQuickAction }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 bg-white border-r border-slate-200 p-3 flex flex-col gap-2 overflow-y-auto">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mb-1">
        クイック依頼
      </p>
      {quickActions.map((action, i) => (
        <button
          key={i}
          onClick={() =>
            onQuickAction(
              action.agentId,
              action.message ?? action.template ?? "",
              !!action.template
            )
          }
          className="text-left text-sm px-3 py-2.5 rounded-lg bg-slate-50 hover:bg-rose-50 hover:text-rose-700 text-slate-700 border border-slate-200 hover:border-rose-200 transition-all leading-snug"
        >
          {action.label}
        </button>
      ))}
    </aside>
  );
}
