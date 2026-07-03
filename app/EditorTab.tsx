"use client";

import { useState, useEffect, useRef } from "react";
import {
  Segment, Cue, extractNarration, splitForCaptions,
  detectSpeechSegments, allocateCues, generateSRT, generateCutSheet,
} from "@/lib/video";

// ライブラリ（localStorage）から台本を選ぶための最小限の読み込み
interface StoredScript { id: string; title: string; script: string }
function loadScripts(): StoredScript[] {
  try {
    const items = JSON.parse(localStorage.getItem("script_library") ?? "[]") as { id: string; title: string; script: string }[];
    return items.map(i => ({ id: i.id, title: i.title, script: i.script }));
  } catch { return []; }
}

function download(filename: string, content: string | Blob) {
  const blob = typeof content === "string" ? new Blob([content], { type: "text/plain;charset=utf-8" }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const FONT_URL = "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf";
const CORE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

type Phase = "idle" | "analyzing" | "ready" | "rendering" | "done" | "error";

export default function EditorTab() {
  const [scripts, setScripts] = useState<StoredScript[]>([]);
  const [narration, setNarration] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const ffmpegRef = useRef<unknown>(null);

  useEffect(() => { setScripts(loadScripts()); }, []);

  // ① 動画の音声を解析して無音区間を検出
  const analyze = async (f: File) => {
    setFile(f); setPhase("analyzing"); setErrorMsg(""); setOutputUrl(null);
    try {
      const buf = await f.arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      const segs = detectSpeechSegments(audio.getChannelData(0), audio.sampleRate);
      ctx.close();
      if (segs.length === 0) throw new Error("発話が検出できませんでした。音声が入っているか確認してください");
      setSegments(segs);
      setDuration(audio.duration);
      setPhase("ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "解析に失敗しました");
      setPhase("error");
    }
  };

  // ナレーションが変わったらテロップ割り付けを再計算
  useEffect(() => {
    if (segments.length === 0 || !narration.trim()) { setCues([]); return; }
    const captions = splitForCaptions(narration.split("\n").map(l => l.trim()).filter(Boolean));
    setCues(allocateCues(captions, segments));
  }, [narration, segments]);

  const keptDuration = segments.reduce((s, x) => s + (x.end - x.start), 0);

  // ② ブラウザ内で自動編集（ジャンプカット＋テロップ焼き込み）
  const render = async () => {
    if (!file || segments.length === 0) return;
    setPhase("rendering"); setProgress(0); setErrorMsg("");
    try {
      setStatusMsg("編集エンジンを読み込み中…（初回は1〜2分かかります）");
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

      if (!ffmpegRef.current) {
        const ffmpeg = new FFmpeg();
        await ffmpeg.load({
          coreURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.wasm`, "application/wasm"),
        });
        ffmpegRef.current = ffmpeg;
      }
      const ffmpeg = ffmpegRef.current as InstanceType<typeof FFmpeg>;
      ffmpeg.on("progress", ({ progress: p }: { progress: number }) => {
        setProgress(Math.min(99, Math.round(p * 100)));
      });

      setStatusMsg("日本語フォントを読み込み中…");
      const fontData = await fetchFile(FONT_URL);
      await ffmpeg.writeFile("font.otf", fontData);

      setStatusMsg("動画を読み込み中…");
      await ffmpeg.writeFile("input.mp4", await fetchFile(file));

      // テロップテキストをファイルとして書き込み（エスケープ問題を回避）
      for (let i = 0; i < cues.length; i++) {
        await ffmpeg.writeFile(`t${i}.txt`, new TextEncoder().encode(cues[i].text));
      }

      // フィルタグラフ構築：trim+concatでジャンプカット → scale → drawtextでテロップ
      const N = segments.length;
      const trims = segments.map((s, i) =>
        `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`
      ).join("");
      const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
      const drawtexts = cues.map((c, i) =>
        `drawtext=fontfile=font.otf:textfile=t${i}.txt:fontsize=48:fontcolor=white:borderw=4:bordercolor=black@0.85:` +
        `x=(w-tw)/2:y=h-th-160:enable=between(t\\,${c.start.toFixed(2)}\\,${c.end.toFixed(2)})`
      ).join(",");
      const graph =
        `${trims}${concatInputs}concat=n=${N}:v=1:a=1[vc][ac];` +
        `[vc]scale=-2:1280${drawtexts ? "," + drawtexts : ""}[vo]`;

      setStatusMsg("編集中…（動画の長さの2〜5倍の時間がかかります）");
      await ffmpeg.exec([
        "-i", "input.mp4",
        "-filter_complex", graph,
        "-map", "[vo]", "-map", "[ac]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
        "-c:a", "aac", "-b:a", "128k",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const bytes = new Uint8Array(data as Uint8Array);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
      setOutputUrl(URL.createObjectURL(blob));
      setPhase("done");
      setStatusMsg("");
    } catch (e) {
      setErrorMsg(
        (e instanceof Error ? e.message : "編集に失敗しました") +
        " ／ 下の「SRT字幕」と「カット指示書」をダウンロードすればCapCutで同じ編集ができます"
      );
      setPhase("error");
    }
  };

  return (
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-5 max-w-3xl">
      <p className="text-sm text-gray-400 leading-relaxed">
        撮影した動画をアップすると、<span className="text-yellow-400">無音カット＋テロップ焼き込み</span>を全部ブラウザ内で自動処理します（アップロード先サーバーなし＝無料＆動画が外部に出ない）
      </p>

      {/* STEP 1: 台本選択 */}
      <div className="border border-gray-800 bg-gray-900 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-gray-200">① テロップにする台本を選ぶ</p>
        <select
          onChange={e => {
            const s = scripts.find(x => x.id === e.target.value);
            if (s) setNarration(extractNarration(s.script).join("\n"));
          }}
          className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl p-2.5 focus:outline-none focus:border-yellow-600/50">
          <option value="">ライブラリから選択…</option>
          {scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <textarea value={narration} onChange={e => setNarration(e.target.value)} rows={5}
          placeholder="またはナレーションを直接貼り付け（1行＝テロップ1枚の目安）"
          className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-yellow-600/50" />
      </div>

      {/* STEP 2: 動画アップロード */}
      <div className="border border-gray-800 bg-gray-900 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-gray-200">② 撮影した動画を選ぶ</p>
        <input type="file" accept="video/*"
          onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); }}
          className="block w-full text-sm text-gray-400 file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-yellow-600 file:text-black file:font-bold file:text-xs hover:file:bg-yellow-500" />
        {phase === "analyzing" && <p className="text-xs text-gray-500">🔍 音声を解析中…</p>}
        {segments.length > 0 && (
          <p className="text-xs text-green-400">
            ✅ 解析完了：発話 {segments.length} 区間を検出 ／ {duration.toFixed(1)}秒 → 約{keptDuration.toFixed(1)}秒（{(duration - keptDuration).toFixed(1)}秒の無音をカット）
            {cues.length > 0 && ` ／ テロップ ${cues.length}枚`}
          </p>
        )}
      </div>

      {/* STEP 3: 出力 */}
      {phase !== "idle" && phase !== "analyzing" && segments.length > 0 && (
        <div className="border border-yellow-600/40 bg-yellow-900/10 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-yellow-400">③ 書き出し</p>

          <button onClick={render} disabled={phase === "rendering"}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors">
            {phase === "rendering" ? `処理中… ${progress}%` : "🎬 ブラウザで自動編集（カット＋テロップ）"}
          </button>
          {phase === "rendering" && (
            <div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-yellow-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-gray-500 mt-1.5">{statusMsg}</p>
            </div>
          )}

          {outputUrl && (
            <div className="space-y-2">
              <video src={outputUrl} controls className="w-full max-h-80 rounded-xl bg-black" />
              <a href={outputUrl} download="edited.mp4"
                className="block text-center py-2.5 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl text-sm transition-colors">
                ⬇ 完成動画をダウンロード
              </a>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => download("captions.srt", generateSRT(cues, segments, true))}
              disabled={cues.length === 0}
              className="flex-1 min-w-[140px] py-2 text-xs border border-gray-700 hover:border-gray-500 text-gray-300 rounded-xl disabled:opacity-40 transition-colors">
              📄 SRT字幕（CapCut用・元動画向け）
            </button>
            <button onClick={() => download("cutsheet.txt", generateCutSheet(segments, duration))}
              className="flex-1 min-w-[140px] py-2 text-xs border border-gray-700 hover:border-gray-500 text-gray-300 rounded-xl transition-colors">
              ✂️ カット指示書
            </button>
          </div>
          <p className="text-xs text-gray-600">自動編集がうまくいかない環境でも、SRT＋指示書があればCapCutで同じ仕上がりを再現できます</p>
        </div>
      )}

      {errorMsg && <p className="text-xs text-red-400 leading-relaxed">⚠ {errorMsg}</p>}
    </div>
  );
}
