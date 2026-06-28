"use client";

import { useEffect, useRef } from "react";
import { getAgent, AgentId } from "@/lib/agents";

export interface Message {
  role: "user" | "assistant";
  content: string;
  agentId?: AgentId;
}

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
}

export default function ChatMessages({ messages, isLoading }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400">
        <div className="text-center">
          <div className="text-5xl mb-4">🏠</div>
          <p className="text-lg font-medium text-slate-500">不動産SNSスタジオへようこそ</p>
          <p className="text-sm mt-2">エージェントを選んで質問してみましょう</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto chat-messages p-4 space-y-4">
      {messages.map((msg, i) => {
        const agent = msg.agentId ? getAgent(msg.agentId) : null;
        return (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && agent && (
              <div className="flex flex-col items-center mr-2 mt-1">
                <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-base">
                  {agent.emoji}
                </div>
              </div>
            )}
            <div
              className={`max-w-[75%] ${
                msg.role === "user"
                  ? "bg-rose-600 text-white rounded-2xl rounded-tr-sm px-4 py-3"
                  : "bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm"
              }`}
            >
              {msg.role === "assistant" && agent && (
                <p className="text-xs font-semibold text-rose-600 mb-1">
                  {agent.name}
                </p>
              )}
              <p className="text-sm leading-relaxed prose-content">{msg.content}</p>
            </div>
          </div>
        );
      })}

      {isLoading && (
        <div className="flex justify-start">
          <div className="flex flex-col items-center mr-2 mt-1">
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-base">
              🏠
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
            <div className="flex gap-1 items-center h-5">
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
