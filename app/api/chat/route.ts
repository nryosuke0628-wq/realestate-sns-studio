import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tavily } from "@tavily/core";
import { getFeature, FeatureId } from "@/lib/features";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function searchWeb(query: string): Promise<string> {
  if (!process.env.TAVILY_API_KEY) return "";
  try {
    const client = tavily({ apiKey: process.env.TAVILY_API_KEY });
    const result = await client.search(query, {
      maxResults: 5,
      searchDepth: "basic",
    });
    return result.results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input, featureId } = body as { input: string; featureId: FeatureId };

    if (!input || !featureId) {
      return NextResponse.json({ error: "input and featureId are required" }, { status: 400 });
    }

    const feature = getFeature(featureId);
    let systemPrompt = feature.systemPrompt;

    if (feature.useSearch) {
      const searchQuery = `不動産 Instagram ${input.slice(0, 80)}`;
      const searchResults = await searchWeb(searchQuery);
      if (searchResults) {
        systemPrompt += `\n\n【リアルタイム検索結果】\n${searchResults}`;
      }
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: input }],
    });

    const reply =
      response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({ reply });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "AI応答の取得に失敗しました" }, { status: 500 });
  }
}
