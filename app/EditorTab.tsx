"use client";

import { useState, useEffect, useRef } from "react";
import {
  Segment, Cue, extractNarration, splitForCaptions,
  detectSpeechSegments, allocateCues, generateSRT, generateCutSheet,
  subtractRanges, encodeWav16k,
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
type CaptionLang = "ja" | "zh" | "both";

export default function EditorTab() {
  const [scripts, setScripts] = useState<StoredScript[]>([]);
  const [narration, setNarration] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [captions, setCaptions] = useState<string[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  // 中国語テロップ
  const [lang, setLang] = useState<CaptionLang>("ja");
  const [zhLines, setZhLines] = useState<string[]>([]);
  const [zhHashtags, setZhHashtags] = useState("");
  const [translating, setTranslating] = useState(false);
  // Gemini編集監督
  const [geminiReady, setGeminiReady] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [directorAdvice, setDirectorAdvice] = useState("");
  const [removedCount, setRemovedCount] = useState(0);
  const ffmpegRef = useRef<unknown>(null);
  const audioRef = useRef<{ channel: Float32Array; sampleRate: number } | null>(null);

  useEffect(() => {
    setScripts(loadScripts());
    fetch("/api/video-director").then(r => r.json()).then(d => setGeminiReady(!!d.configured)).catch(() => {});
  }, []);

  // ① 動画の音声を解析して無音区間を検出
  const analyze = async (f: File) => {
    setFile(f); setPhase("analyzing"); setErrorMsg(""); setOutputUrl(null);
    setDirectorAdvice(""); setRemovedCount(0);
    try {
      const buf = await f.arrayBuffer();
      const ctx = new AudioContext();
      const audio = await ctx.decodeAudioData(buf);
      const channel = audio.getChannelData(0);
      audioRef.current = { channel: new Float32Array(channel), sampleRate: audio.sampleRate };
      const segs = detectSpeechSegments(channel, audio.sampleRate);
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

  // ナレーション・区間が変わったらテロップ割り付けを再計算
  useEffect(() => {
    if (segments.length === 0 || !narration.trim()) { setCaptions([]); setCues([]); return; }
    const caps = splitForCaptions(narration.split("\n").map(l => l.trim()).filter(Boolean));
    setCaptions(caps);
    setCues(allocateCues(caps, segments));
  }, [narration, segments]);

  const keptDuration = segments.reduce((s, x) => s + (x.end - x.start), 0);

  // 中国語翻訳（Claude）
  const translate = async () => {
    if (captions.length === 0) return;
    setTranslating(true); setErrorMsg("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: "translate_captions", input: captions.join("\n") }),
      });
      const data = await res.json();
      const text: string = data.reply ?? "";
      const s = text.indexOf("TRANS_START"), e = text.indexOf("TRANS_END");
      if (s === -1 || e === -1) throw new Error("翻訳の解析に失敗しました。もう一度お試しください");
      const lines = text.slice(s + "TRANS_START".length, e).split("\n").map(l => l.trim()).filter(Boolean);
      const tagLine = lines.find(l => l.startsWith("HASHTAGS:"));
      setZhHashtags(tagLine ? tagLine.replace("HASHTAGS:", "").trim() : "");
      setZhLines(lines.filter(l => !l.startsWith("HASHTAGS:")));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "翻訳に失敗しました");
    }
    setTranslating(false);
  };

  // Gemini編集監督：音声を解析して言い淀み・噛みの削除区間を判定
  const runDirector = async () => {
    if (!audioRef.current) return;
    setDirecting(true); setErrorMsg("");
    try {
      const wav = encodeWav16k(audioRef.current.channel, audioRef.current.sampleRate);
      if (wav.size > 3.5 * 1024 * 1024) {
        throw new Error("動画が長すぎます（AI監督は2分以内のテイクに対応）");
      }
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(wav);
      });
      const res = await fetch("/api/video-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: b64, narration }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.remove.length > 0) {
        setSegments(prev => subtractRanges(prev, data.remove));
        setRemovedCount(data.remove.length);
      }
      setDirectorAdvice(data.advice || (data.remove.length === 0 ? "問題なし！このまま編集してOKです" : ""));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "AI監督の解析に失敗しました");
    }
    setDirecting(false);
  };

  // 言語ごとのSRTテキスト生成用：日中2段組は1つの字幕に2行
  const srtCues = (): Cue[] => {
    if (lang === "ja" || zhLines.length === 0) return cues;
    return cues.map((c, i) => ({
      ...c,
      text: lang === "zh" ? (zhLines[i] ?? c.text) : `${c.text}\n${zhLines[i] ?? ""}`,
    }));
  };

  // ② ブラウザ内で自動編集（ジャンプカット＋中央テロップ焼き込み）
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

      setStatusMsg("フォントを読み込み中…");
      await ffmpeg.writeFile("font.otf", await fetchFile(FONT_URL));

      setStatusMsg("動画を読み込み中…");
      await ffmpeg.writeFile("input.mp4", await fetchFile(file));

      // テロップテキストをファイル化（エスケープ問題回避）
      const enc = new TextEncoder();
      for (let i = 0; i < cues.length; i++) {
        if (lang !== "zh") await ffmpeg.writeFile(`t${i}.txt`, enc.encode(cues[i].text));
        if (lang !== "ja" && zhLines[i]) await ffmpeg.writeFile(`z${i}.txt`, enc.encode(zhLines[i]));
      }

      // フィルタグラフ：trim+concat → scale → 画面中央テロップ（フックは大きく黄色）
      const N = segments.length;
      const trims = segments.map((s, i) =>
        `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`
      ).join("");
      const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");

      const drawParts: string[] = [];
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        const isHook = c.start < 3; // 冒頭フックは大きく・黄色で強調
        const enable = `enable=between(t\\,${c.start.toFixed(2)}\\,${c.end.toFixed(2)})`;
        const common = `fontfile=font.otf:borderw=5:bordercolor=black@0.9:x=(w-tw)/2`;
        if (lang === "ja") {
          drawParts.push(`drawtext=textfile=t${i}.txt:${common}:fontsize=${isHook ? 64 : 50}:fontcolor=${isHook ? "yellow" : "white"}:y=(h-th)/2:${enable}`);
        } else if (lang === "zh") {
          if (zhLines[i]) drawParts.push(`drawtext=textfile=z${i}.txt:${common}:fontsize=${isHook ? 64 : 50}:fontcolor=${isHook ? "yellow" : "white"}:y=(h-th)/2:${enable}`);
        } else {
          drawParts.push(`drawtext=textfile=t${i}.txt:${common}:fontsize=${isHook ? 58 : 48}:fontcolor=${isHook ? "yellow" : "white"}:y=(h-th)/2-42:${enable}`);
          if (zhLines[i]) drawParts.push(`drawtext=textfile=z${i}.txt:${common}:fontsize=34:fontcolor=white@0.95:y=(h-th)/2+40:${enable}`);
        }
      }
      const graph =
        `${trims}${concatInputs}concat=n=${N}:v=1:a=1[vc][ac];` +
        `[vc]scale=-2:1280${drawParts.length ? "," + drawParts.join(",") : ""}[vo]`;

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

  const langBtn = (v: CaptionLang, label: string) => (
    <button onClick={() => setLang(v)}
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${lang === v ? "border-yellow-600 bg-yellow-900/30 text-yellow-400" : "border-gray-700 text-gray-400 hover:border-gray-500"}`}>
      {label}
    </button>
  );

  return (
    <div className="h-[calc(100vh-96px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-5 max-w-3xl">
      <p className="text-sm text-gray-400 leading-relaxed">
        撮影動画をアップ → <span className="text-yellow-400">AI監督が言い淀みをチェック → 無音カット → 画面中央テロップ（日/中/2段組）</span>まで全自動。完成MP4はそのままインスタ投稿OK、微調整したい時はSRTをCapCutへ
      </p>

      {/* STEP 1: 台本選択 */}
      <div className="border border-gray-800 bg-gray-900 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-gray-200">① テロップにする台本を選ぶ</p>
        <select
          onChange={e => {
            const s = scripts.find(x => x.id === e.target.value);
            if (s) { setNarration(extractNarration(s.script).join("\n")); setZhLines([]); setZhHashtags(""); }
          }}
          className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl p-2.5 focus:outline-none focus:border-yellow-600/50">
          <option value="">ライブラリから選択…</option>
          {scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <textarea value={narration} onChange={e => { setNarration(e.target.value); setZhLines([]); }} rows={5}
          placeholder="またはナレーションを直接貼り付け（1行＝テロップ1枚の目安）"
          className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-yellow-600/50" />

        {/* テロップ言語 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">テロップ言語：</span>
          {langBtn("ja", "🇯🇵 日本語")}
          {langBtn("zh", "🇨🇳 中国語")}
          {langBtn("both", "🇯🇵🇨🇳 2段組")}
          {lang !== "ja" && (
            <button onClick={translate} disabled={translating || captions.length === 0}
              className="px-3 py-1.5 text-xs rounded-full bg-red-700/60 hover:bg-red-600/60 disabled:opacity-40 text-white font-semibold transition-colors">
              {translating ? "翻訳中…" : zhLines.length > 0 ? "🈶 再翻訳" : "🈶 中国語を生成"}
            </button>
          )}
        </div>
        {lang !== "ja" && zhLines.length > 0 && (
          <div className="text-xs text-gray-400 bg-gray-800/60 rounded-xl p-3 space-y-1">
            <p className="text-green-400">✅ 中国語テロップ {zhLines.length}行 生成済み</p>
            {zhHashtags && <p className="text-red-300">中華圏向けタグ： {zhHashtags}</p>}
          </div>
        )}
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
            ✅ 解析完了：発話 {segments.length} 区間 ／ {duration.toFixed(1)}秒 → 約{keptDuration.toFixed(1)}秒（{(duration - keptDuration).toFixed(1)}秒カット）
            {cues.length > 0 && ` ／ テロップ ${cues.length}枚`}
          </p>
        )}

        {/* Gemini編集監督 */}
        {segments.length > 0 && (
          geminiReady ? (
            <div className="space-y-2">
              <button onClick={runDirector} disabled={directing}
                className="w-full py-2.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-colors">
                {directing ? "🧠 AI監督が視聴中…（30秒ほど）" : "🧠 AI監督チェック（言い淀み・噛みを自動検出してカット）"}
              </button>
              {removedCount > 0 && <p className="text-xs text-blue-300">✂️ AI監督が{removedCount}箇所の言い淀み・NG部分を追加カットしました</p>}
              {directorAdvice && <p className="text-xs text-gray-400">💬 監督コメント：{directorAdvice}</p>}
            </div>
          ) : (
            <p className="text-xs text-gray-600">💡 GEMINI_API_KEYを設定すると「AI監督チェック」（言い淀み自動カット）が使えます</p>
          )
        )}
      </div>

      {/* STEP 3: 出力 */}
      {phase !== "idle" && phase !== "analyzing" && segments.length > 0 && (
        <div className="border border-yellow-600/40 bg-yellow-900/10 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-yellow-400">③ 書き出し</p>

          <button onClick={render} disabled={phase === "rendering" || (lang !== "ja" && zhLines.length === 0)}
            className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black font-bold rounded-xl text-sm transition-colors">
            {phase === "rendering" ? `処理中… ${progress}%` : "🎬 自動編集（カット＋中央テロップ）"}
          </button>
          {lang !== "ja" && zhLines.length === 0 && (
            <p className="text-xs text-orange-400">⚠ 先に「🈶 中国語を生成」を押してください</p>
          )}
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
                ⬇ 完成動画をダウンロード（そのままインスタ投稿OK）
              </a>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => download("captions.srt", generateSRT(srtCues(), segments, true))}
              disabled={cues.length === 0}
              className="flex-1 min-w-[140px] py-2 text-xs border border-gray-700 hover:border-gray-500 text-gray-300 rounded-xl disabled:opacity-40 transition-colors">
              📄 SRT字幕（CapCut微調整用）
            </button>
            <button onClick={() => download("cutsheet.txt", generateCutSheet(segments, duration))}
              className="flex-1 min-w-[140px] py-2 text-xs border border-gray-700 hover:border-gray-500 text-gray-300 rounded-xl transition-colors">
              ✂️ カット指示書
            </button>
          </div>
          <p className="text-xs text-gray-600">CapCutで微調整する場合：元動画＋SRTを読み込めばテロップが編集可能な状態で載ります</p>
        </div>
      )}

      {errorMsg && <p className="text-xs text-red-400 leading-relaxed">⚠ {errorMsg}</p>}
    </div>
  );
}
