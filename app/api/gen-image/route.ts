import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 🖼 Gemini画像生成：サムネイル・シネマ風挿入画像（無料枠内）
export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY未設定" }, { status: 500 });
  }
  try {
    const { prompt } = await request.json();
    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? "Gemini画像APIエラー");

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) =>
      p.inline_data?.data || p.inlineData?.data);
    const b64 = imgPart?.inline_data?.data ?? imgPart?.inlineData?.data;
    if (!b64) throw new Error("画像が生成されませんでした。もう一度お試しください");

    return NextResponse.json({ image: `data:image/png;base64,${b64}` });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "画像生成に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
