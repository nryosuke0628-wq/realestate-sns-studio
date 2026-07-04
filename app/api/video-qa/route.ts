import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

// 📱 SNSコンサルタントAI：編集後の音声を試聴して品質採点（QAループ用）
export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "GEMINI_API_KEY未設定" }, { status: 500 });
  }

  try {
    const { audio, cues } = await request.json();
    if (!audio) return NextResponse.json({ error: "audio required" }, { status: 400 });

    const cueList = Array.isArray(cues)
      ? cues.map((c: { start: number; end: number; text: string }, i: number) =>
          `${i}: [${c.start.toFixed(1)}s-${c.end.toFixed(1)}s] ${c.text}`).join("\n")
      : "";

    const prompt = `あなたはバズるリールを量産してきたSNSコンサルタント兼プロ動画編集者です。
添付音声は「カット編集を適用した後」の不動産リール音声です。この音声に以下の字幕が載る予定です：

【字幕予定リスト（編集後タイムライン秒）】
${cueList || "（字幕なし）"}

【品質チェック項目】
1. 言い淀み・噛み・言い直しが残っていないか
2. 字幕のタイミングと実際の発話が一致しているか（0.4秒以上のズレはNG）
3. 冒頭3秒でフックが成立しているか（つかみの一言が最初に来ているか）
4. テンポは良いか（不自然な間・冗長な部分がないか）
5. 総合的にバズる編集品質か

【出力】以下のJSON形式のみ：
{
  "score": 0-100の整数（90以上が合格ライン）,
  "removeMore": [{"start": 秒, "end": 秒, "reason": "理由"}]（編集後タイムラインで追加削除すべき区間。確実なもののみ、なければ空配列）,
  "issues": [{"note": "問題点の説明"}]（カットでは直せない問題。なければ空配列）,
  "reshoot": ["撮り直しを推奨する箇所の説明"]（該当なければ空配列）,
  "advice": "一言総評"
}`;

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

    return NextResponse.json({
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null,
      removeMore: Array.isArray(parsed.removeMore)
        ? parsed.removeMore.filter((r: { start: unknown; end: unknown }) =>
            typeof r.start === "number" && typeof r.end === "number" && r.end > r.start)
        : [],
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      reshoot: Array.isArray(parsed.reshoot) ? parsed.reshoot : [],
      advice: parsed.advice ?? "",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "QA解析に失敗しました";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
