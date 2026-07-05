import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// 🕵️ 仕上げ検品官：完成動画のフレームを実際に見てテロップ品質を検品
export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY未設定" }, { status: 500 });
  }
  try {
    const { frames, expectedPosition } = await request.json();
    if (!Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json({ error: "frames required" }, { status: 400 });
    }

    const posLabel = expectedPosition === "center" ? "画面中央" : "画面下部";
    const prompt = `あなたは動画の仕上げ検品官です。添付はInstagramリール完成動画のフレーム（冒頭・中盤・終盤）です。

【検品項目】
1. テロップの位置：${posLabel}に配置されているべき。ズレていないか
2. テロップの見切れ：左右が画面からはみ出していないか
3. テロップの可読性：サイズ・縁取り・背景との対比は十分か
4. 全体の完成度：投稿してよいクオリティか

【出力】以下のJSON形式のみ：
{"pass": true/false, "score": 0-100, "issues": ["問題点"], "advice": "一言"}
問題がなければpassはtrue、issuesは空配列。`;

    const parts: object[] = frames.slice(0, 3).map((f: string) => ({
      inline_data: { mime_type: "image/jpeg", data: f.replace(/^data:image\/\w+;base64,/, "") },
    }));
    parts.push({ text: prompt });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 },
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? "Gemini APIエラー");

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    return NextResponse.json({
      pass: !!parsed.pass,
      score: typeof parsed.score === "number" ? Math.round(parsed.score) : null,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      advice: parsed.advice ?? "",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "検品に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
