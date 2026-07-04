import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// Gemini＝編集監督：撮影音声を解析し、言い淀み・噛み・撮り直し部分の削除区間を判定
// 必要な環境変数: GEMINI_API_KEY（Google AI Studioで無料取得）

export async function GET() {
  return NextResponse.json({ configured: !!process.env.GEMINI_API_KEY });
}

export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY未設定" }, { status: 500 });
  }

  try {
    const { audio, narration, captions } = await request.json();
    if (!audio) return NextResponse.json({ error: "audio required" }, { status: 400 });

    const captionList: string[] = Array.isArray(captions) ? captions : [];
    const captionBlock = captionList.length > 0
      ? `\n【テロップ行（番号付き）】\n${captionList.map((c, i) => `${i}: ${c}`).join("\n")}\n`
      : "";

    const prompt = `あなたはInstagramリール編集のプロ監督です。この音声は不動産リールの独り語り撮影の素材です。

【台本】
${narration ?? "（台本なし）"}
${captionBlock}
【タスク1：削除区間の特定】
音声を聞いて、完成動画から削除すべき区間を特定：
- 言い淀み（「えー」「あのー」等）
- 噛み・言い直し（同じ文を2回言っている場合は失敗した方）
- 台本にない雑談・咳・無関係な音
- 長すぎる間
確信がある箇所のみ。問題なければ空配列。

【タスク2：テロップの実測タイミング】
各テロップ行が実際に話されている開始・終了秒数（元音声のタイムライン）を特定。
話されていない行は省略してよい。

以下のJSON形式のみで回答：
{"remove": [{"start": 秒数, "end": 秒数, "reason": "短い理由"}], "lines": [{"index": テロップ行番号, "start": 秒数, "end": 秒数}], "advice": "全体への一言アドバイス"}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: "audio/wav", data: audio } },
              { text: prompt },
            ],
          }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.2 },
        }),
      }
    );

    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? "Gemini APIエラー");

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    const remove = Array.isArray(parsed.remove)
      ? parsed.remove.filter((r: { start: unknown; end: unknown }) =>
          typeof r.start === "number" && typeof r.end === "number" && r.end > r.start)
      : [];
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines.filter((l: { index: unknown; start: unknown; end: unknown }) =>
          typeof l.index === "number" && typeof l.start === "number" && typeof l.end === "number" && l.end > l.start)
      : [];

    return NextResponse.json({ remove, lines, advice: parsed.advice ?? "" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "解析に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
