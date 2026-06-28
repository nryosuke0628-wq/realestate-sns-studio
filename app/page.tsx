"use client";

import { useState } from "react";
import AgentBar from "@/components/AgentBar";
import ChatMessages, { Message } from "@/components/ChatMessages";
import InputArea from "@/components/InputArea";
import Sidebar from "@/components/Sidebar";
import { AgentId } from "@/lib/agents";

export default function Home() {
  const [activeAgent, setActiveAgent] = useState<AgentId>("all");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (text: string, agentId: AgentId) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, agentId }),
      });

      const data = await res.json();
      const aiMsg: Message = {
        role: "assistant",
        content: data.reply ?? "エラーが発生しました。",
        agentId,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "通信エラーが発生しました。しばらく経ってから再度お試しください。",
          agentId,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => sendMessage(input, activeAgent);

  const handleQuickAction = (agentId: AgentId, message: string, isTemplate: boolean) => {
    setActiveAgent(agentId);
    if (isTemplate) {
      setInput(message);
    } else {
      sendMessage(message, agentId);
    }
  };

  const handleAgentSelect = (id: AgentId) => {
    setActiveAgent(id);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 bg-rose-600 rounded-xl flex items-center justify-center text-white text-lg">
          🏠
        </div>
        <div>
          <h1 className="font-bold text-slate-800 text-lg leading-none">不動産SNSスタジオ</h1>
          <p className="text-xs text-slate-500 mt-0.5">購入・売却層向け Instagramアカウント強化チーム</p>
        </div>
      </header>

      {/* Agent Bar */}
      <AgentBar activeAgent={activeAgent} onSelect={handleAgentSelect} />

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onQuickAction={handleQuickAction} />

        <div className="flex flex-col flex-1 overflow-hidden">
          <ChatMessages messages={messages} isLoading={isLoading} />
          <InputArea
            value={input}
            onChange={setInput}
            onSend={handleSend}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
