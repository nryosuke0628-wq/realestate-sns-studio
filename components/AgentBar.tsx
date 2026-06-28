"use client";

import { agents, AgentId } from "@/lib/agents";

interface AgentBarProps {
  activeAgent: AgentId;
  onSelect: (id: AgentId) => void;
}

export default function AgentBar({ activeAgent, onSelect }: AgentBarProps) {
  return (
    <div className="bg-white border-b border-slate-200 px-4 py-2 overflow-x-auto">
      <div className="flex gap-2 min-w-max">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              activeAgent === agent.id
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <span>{agent.emoji}</span>
            <span>{agent.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
