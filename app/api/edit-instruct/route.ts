import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 編集後の修正指示を、適用可能な編集パラメータ（JSON）に変換する
export async function POST(request: NextRequest) {
  try {
    const { instruction, transcript, cues, currentSpeed, currentShift } = await request.json();
    if (!instruction) return NextResponse.json({ error: "instruction required" }, { status: 400 });

    const transcriptText = Array.isArray(transcript)
      ? transcript.map((p: { start: number; text: string }) => `[${p.start.toFixed(1)}s] ${p.text}`).join("\n")
      : "";
    const cueText = Array.isArray(cues)
      ? cues.map((c: { text: string }, i: number) => `${i}: ${c.text}`).join("\n")
      : "";

    const system = `あなたは動画編集アシスタントです。ユーザーの修正指示を、以下のJSON形式の編集パラメータに変換してください。

【現在の状態】速度: ${currentSpeed ?? 1}x ／ テロップシフト: ${currentShift ?? 0}秒

【文字起こし（カット指定の照合用）】
${transcriptText || "（なし）"}

【テロップ一覧】
${cueText || "（なし）"}

【出力JSON（この形式のみ）】
{
  "cutPhrases": ["カットすべき発話フレーズ（文字起こしの文言をそのまま）"],
  "speed": 数値または null（倍速変更の指示があれば1.0〜1.3）,
  "shiftDelta": 数値または null（テロップを早く=-0.2、遅く=+0.2 など）,
  "captionOffset": 数値または null（テロップを上へ=-60、下へ=+60 などpx）,
  "reply": "何をどう変更したかの一言（ユーザーに表示）"
}

【ルール】
- 「言い直しが残ってる」「〇〇って2回言ってる」→ 文字起こしから該当する前の方（失敗テイク）を cutPhrases に入れる
- 「テンポよく」「間を詰めて」→ speed を +0.1 程度上げる
- 対応できない指示（色を変えて等）は reply で「その調整は現在未対応です」と伝える
- JSONのみ出力`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: instruction }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");

    return NextResponse.json({
      cutPhrases: Array.isArray(parsed.cutPhrases) ? parsed.cutPhrases.filter((p: unknown) => typeof p === "string") : [],
      speed: typeof parsed.speed === "number" ? Math.max(1.0, Math.min(1.3, parsed.speed)) : null,
      shiftDelta: typeof parsed.shiftDelta === "number" ? parsed.shiftDelta : null,
      captionOffset: typeof parsed.captionOffset === "number" ? parsed.captionOffset : null,
      reply: parsed.reply ?? "調整しました",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "指示の解釈に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
