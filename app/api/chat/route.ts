import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { getAgent, AgentId } from "@/lib/agents";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SEARCH_AGENT_IDS: AgentId[] = ["research", "trend", "all"];

async function searchWeb(query: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const result = await client.search(query, {
      maxResults: 5,
      searchDepth: "basic",
    });
    const snippets = result.results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
      .join("\n\n");
    return snippets;
  } catch {
    return "";
  }
}

function buildSearchQuery(message: string, agentId: AgentId): string {
  const base = message.slice(0, 100);
  if (agentId === "trend") return `不動産 Instagram Reels トレンド ${base}`;
  if (agentId === "research") return `不動産市場 最新情報 ${base}`;
  return `不動産 SNS ${base}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, agentId } = body as { message: string; agentId: AgentId };

    if (!message || !agentId) {
      return NextResponse.json(
        { error: "message and agentId are required" },
        { status: 400 }
      );
    }

    const agent = getAgent(agentId);

    let systemPrompt = agent.systemPrompt;

    if (SEARCH_AGENT_IDS.includes(agentId)) {
      const query = buildSearchQuery(message, agentId);
      const searchResults = await searchWeb(query);
      if (searchResults) {
        systemPrompt += `\n\n【リアルタイム検索結果】\n以下の最新情報を参考にして回答してください：\n\n${searchResults}`;
      }
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const reply =
      response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Failed to get response from AI" },
      { status: 500 }
    );
  }
}
