"use client";

import { useState, useEffect, useRef } from "react";
import {
  Segment, Cue, extractNarration, splitForCaptions,
  detectSpeechSegments, allocateCues, generateSRT, generateCutSheet,
  subtractRanges, encodeWav16k, cuesFromTimings,
  extractEditedAudio, proEditorPass, speechTimeToOriginal, originalToSpeechTime,
} from "@/lib/video";

// ライブラリ（localStorage）から台本を選ぶための最小限の読み込み
interface StoredScript { id: string; title: string; script: string }
function loadScripts(): StoredScript[] {
  try {
    const items = JSON.parse(localStorage.getItem("script_library") ?? "[]") as { id: string; title: string; script: string }[];
    return items.map(i => ({ id: i.id, title: i.title, script: i.script }));
  } catch { return []; }
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-[#5a6080]">
      <svg className="animate-spin w-3.5 h-3.5 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
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
type StyleKey = "classic" | "white" | "center" | "pop" | "karaoke";

// テロップスタイルプリセット（バズってる独り語りリールの型）
const STYLES: Record<StyleKey, {
  label: string; desc: string;
  y: string; fontsize: number; hookSize: number;
  color: string; hookColor: string; box?: string;
}> = {
  classic: { label: "定番",       desc: "下テロップ・白＋フック黄",     y: "h-th-170",   fontsize: 46, hookSize: 58, color: "white",    hookColor: "yellow" },
  white:   { label: "白オンリー", desc: "色なしシンプル・フックは大",   y: "h-th-170",   fontsize: 46, hookSize: 60, color: "white",    hookColor: "white" },
  center:  { label: "センター",   desc: "画面中央に特大文字",           y: "(h-th)/2",   fontsize: 50, hookSize: 64, color: "white",    hookColor: "yellow" },
  pop:     { label: "ビビッド",   desc: "ピンク＋黒カード背景",         y: "h-th-190",   fontsize: 46, hookSize: 58, color: "0xFF6BA9", hookColor: "0xFF3D8F", box: "box=1:boxcolor=black@0.55:boxborderw=16" },
  karaoke: { label: "カラオケ風", desc: "話している行が水色に光る",     y: "h-th-120",   fontsize: 44, hookSize: 56, color: "0x7DE8FF", hookColor: "0x7DE8FF" },
};

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
  // 自動QAパイプライン（AI監督 → プロ編集家 → SNSコンサル採点ループ）
  const [geminiReady, setGeminiReady] = useState(false);
  const [qaRunning, setQaRunning] = useState(false);
  const [qaLog, setQaLog] = useState<string[]>([]);
  const [qaReport, setQaReport] = useState<{
    score: number | null; iterations: number; fixes: string[];
    issues: string[]; reshoot: string[]; advice: string;
  } | null>(null);
  const [lineTimings, setLineTimings] = useState<({ start: number; end: number } | undefined)[] | null>(null);
  const pipelineDoneRef = useRef<string>("");
  // スタイル・仕上げ
  const [style, setStyle] = useState<StyleKey>("classic");
  const [shift, setShift] = useState(0); // テロップ全体の時間シフト（秒）
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [audioClean, setAudioClean] = useState(true);
  const ffmpegRef = useRef<unknown>(null);
  const audioRef = useRef<{ channel: Float32Array; sampleRate: number } | null>(null);

  useEffect(() => {
    setScripts(loadScripts());
    fetch("/api/video-director").then(r => r.json()).then(d => setGeminiReady(!!d.configured)).catch(() => {});
  }, []);

  // ① 動画の音声を解析して無音区間を検出
  const analyze = async (f: File) => {
    setFile(f); setPhase("analyzing"); setErrorMsg(""); setOutputUrl(null);
    setQaReport(null); setQaLog([]); setLineTimings(null); setShift(0);
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    pipelineDoneRef.current = "";
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

  // 動画とナレーションが揃ったら、AI監督→QAループを自動実行（ボタン不要）
  useEffect(() => {
    if (phase !== "ready" || segments.length === 0 || !geminiReady || qaRunning) return;
    const key = `${file?.name ?? ""}::${narration.slice(0, 60)}`;
    if (pipelineDoneRef.current === key) return;
    pipelineDoneRef.current = key;
    runQaPipeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, segments.length, narration, geminiReady]);

  // ナレーション・区間・実測タイミングが変わったらテロップ割り付けを再計算
  useEffect(() => {
    if (segments.length === 0 || !narration.trim()) { setCaptions([]); setCues([]); return; }
    const caps = splitForCaptions(narration.split("\n").map(l => l.trim()).filter(Boolean));
    setCaptions(caps);
    // AI監督の実測タイミングがあれば優先、なければ文字数比例で推定 → プロ編集家の自動修正を通す
    const base = lineTimings ? cuesFromTimings(caps, lineTimings, segments) : allocateCues(caps, segments);
    setCues(proEditorPass(base, segments).cues);
  }, [narration, segments, lineTimings]);

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

  const wavToB64 = (wav: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(wav);
  });

  // 全自動QAパイプライン：AI監督カット → プロ編集家の機械修正 → SNSコンサル採点（90点未満は再編集、最大3周）
  const runQaPipeline = async () => {
    if (!audioRef.current) return;
    setQaRunning(true); setErrorMsg(""); setQaLog([]); setQaReport(null);
    const log = (m: string) => setQaLog(prev => [...prev, m]);
    const { channel, sampleRate } = audioRef.current;

    try {
      const caps = narration.trim()
        ? splitForCaptions(narration.split("\n").map(l => l.trim()).filter(Boolean))
        : [];

      // ── STEP 1: AI監督（元音声からカット判定＋字幕の実測タイミング）
      log("🧠 AI監督：撮影音声をチェック中…");
      const fullWav = encodeWav16k(channel, sampleRate);
      if (fullWav.size > 3.5 * 1024 * 1024) throw new Error("動画が長すぎます（2分以内のテイクに対応）");
      const dRes = await fetch("/api/video-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: await wavToB64(fullWav), narration, captions: caps }),
      });
      const d = await dRes.json();
      if (d.error) throw new Error(d.error);

      let segs = d.remove.length > 0 ? subtractRanges(segments, d.remove) : segments;
      log(d.remove.length > 0 ? `🧠 AI監督：${d.remove.length}箇所の言い淀み・NGをカット` : "🧠 AI監督：カット不要、良いテイクです");

      let timings: ({ start: number; end: number } | undefined)[] | null = null;
      if (Array.isArray(d.lines) && caps.length > 0) {
        const t: ({ start: number; end: number } | undefined)[] = [];
        for (const l of d.lines) if (l.index < caps.length) t[l.index] = { start: l.start, end: l.end };
        const coverage = t.filter(Boolean).length / caps.length;
        if (coverage >= 0.7) {
          timings = t;
          log(`🎯 字幕タイミングを実測値に補正（${Math.round(coverage * 100)}%カバー）`);
        } else {
          log("🎯 実測タイミングが不完全のため推定方式で統一（ズレ防止）");
        }
      }

      // ── STEP 2-3: プロ編集家の機械修正 → SNSコンサル採点ループ（最大3周）
      const allFixes: string[] = [];
      let score: number | null = null;
      let issues: string[] = [];
      let reshoot: string[] = [];
      let advice: string = d.advice ?? "";
      let iter = 0;

      for (iter = 1; iter <= 3; iter++) {
        const baseCues = caps.length > 0
          ? (timings ? cuesFromTimings(caps, timings, segs) : allocateCues(caps, segs))
          : [];
        const pro = proEditorPass(baseCues, segs);
        pro.fixes.forEach(f => { if (!allFixes.includes(f)) allFixes.push(f); });
        if (pro.fixes.length > 0) log(`🎬 プロ編集家：${pro.fixes.length}件を自動修正`);

        if (caps.length === 0) break; // 字幕なしなら採点スキップ

        log(`📱 SNSコンサル：編集後の音声を試聴して採点中…（${iter}周目）`);
        const editedWav = encodeWav16k(extractEditedAudio(channel, sampleRate, segs), sampleRate);
        const qRes = await fetch("/api/video-qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: await wavToB64(editedWav), cues: pro.cues }),
        });
        const q = await qRes.json();
        if (q.error) { log(`⚠ 採点スキップ（${q.error}）`); break; }

        score = q.score;
        issues = (q.issues ?? []).map((x: { note: string }) => x.note);
        reshoot = q.reshoot ?? [];
        advice = q.advice || advice;
        log(`📱 SNSコンサル採点：${score}点${score !== null && score >= 90 ? " 🎉 合格！" : ""}`);

        if (score !== null && score >= 90) break;
        if (!Array.isArray(q.removeMore) || q.removeMore.length === 0) break;

        // 追加削除指示（編集後タイムライン）→ 元タイムラインに変換して反映
        const removesOriginal = q.removeMore.map((r: { start: number; end: number }) => ({
          start: speechTimeToOriginal(r.start, segs),
          end: speechTimeToOriginal(r.end, segs),
        }));
        segs = subtractRanges(segs, removesOriginal);
        log(`🔁 ${q.removeMore.length}箇所を追加カットして再編集…`);
      }

      setSegments(segs);
      setLineTimings(timings);
      setQaReport({ score, iterations: Math.min(iter, 3), fixes: allFixes, issues, reshoot, advice });
      log("✅ QA完了：書き出し準備OK");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "自動QAに失敗しました（手動でそのまま書き出しは可能です）");
    }
    setQaRunning(false);
  };

  // 全体シフトを適用したCue（プレビュー・書き出し共通）
  const shiftedCues = cues.map(c => ({ ...c, start: Math.max(0, c.start + shift), end: Math.max(0.2, c.end + shift) }));

  // プレビュー動画の現在時刻（元動画）→ カット後時間 → アクティブ字幕
  const previewSpeechT = originalToSpeechTime(previewTime, segments);
  const activeCueIdx = shiftedCues.findIndex(c => previewSpeechT >= c.start && previewSpeechT < c.end);

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
    if (shiftedCues.length === 0) {
      const ok = window.confirm("テロップが0枚です（台本未選択またはナレーション空欄）。テロップなしで書き出しますか？");
      if (!ok) return;
    }
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
      for (let i = 0; i < shiftedCues.length; i++) {
        if (lang !== "zh") await ffmpeg.writeFile(`t${i}.txt`, enc.encode(shiftedCues[i].text));
        if (lang !== "ja" && zhLines[i]) await ffmpeg.writeFile(`z${i}.txt`, enc.encode(zhLines[i]));
      }

      // フィルタグラフ：trim+concat → 9:16クロップ＋30fps → スタイル別テロップ
      const N = segments.length;
      const trims = segments.map((s, i) =>
        `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}];`
      ).join("");
      const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");

      const st = STYLES[style];
      const drawParts: string[] = [];
      for (let i = 0; i < shiftedCues.length; i++) {
        const c = shiftedCues[i];
        const isHook = c.start < 3; // 冒頭フックは大きく強調
        const enable = `enable=between(t\\,${c.start.toFixed(2)}\\,${c.end.toFixed(2)})`;
        const common = `fontfile=font.otf:borderw=5:bordercolor=black@0.9:x=(w-tw)/2${st.box ? ":" + st.box : ""}`;
        // 見切れ防止：長い行はフォントを自動縮小（720px幅に収まるサイズへ）
        const fit = (base: number, text: string) => Math.min(base, Math.max(26, Math.floor(660 / Math.max(1, text.length))));
        const size = fit(isHook ? st.hookSize : st.fontsize, c.text);
        const color = isHook ? st.hookColor : st.color;
        if (lang === "ja") {
          drawParts.push(`drawtext=textfile=t${i}.txt:${common}:fontsize=${size}:fontcolor=${color}:y=${st.y}:${enable}`);
        } else if (lang === "zh") {
          if (zhLines[i]) drawParts.push(`drawtext=textfile=z${i}.txt:${common}:fontsize=${fit(isHook ? st.hookSize : st.fontsize, zhLines[i])}:fontcolor=${color}:y=${st.y}:${enable}`);
        } else {
          drawParts.push(`drawtext=textfile=t${i}.txt:${common}:fontsize=${Math.round(size * 0.94)}:fontcolor=${color}:y=${st.y}-42:${enable}`);
          if (zhLines[i]) drawParts.push(`drawtext=textfile=z${i}.txt:${common}:fontsize=32:fontcolor=white@0.95:y=${st.y}+40:${enable}`);
        }
      }
      // 横撮り・スクエアでも中央を切り出して縦9:16（720x1280）30fpsに統一
      const normalize = `crop='min(iw,ih*9/16)':ih,scale=720:1280,fps=30`;
      const graph =
        `${trims}${concatInputs}concat=n=${N}:v=1:a=1[vc][ac];` +
        `[vc]${normalize}${drawParts.length ? "," + drawParts.join(",") : ""}[vo]`;
      // 音声クリーンアップ：ノイズ除去＋音量正規化（リール標準の-16LUFS）
      const audioGraph = audioClean ? `;[ac]afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11[ao]` : "";
      const audioMap = audioClean ? "[ao]" : "[ac]";

      setStatusMsg("編集中…（動画の長さの2〜5倍の時間がかかります）");
      const baseArgs = (g: string, amap: string) => [
        "-i", "input.mp4",
        "-filter_complex", g,
        "-map", "[vo]", "-map", amap,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
        "-c:a", "aac", "-b:a", "128k",
        "output.mp4",
      ];
      const code = await ffmpeg.exec(baseArgs(graph + audioGraph, audioMap));
      if (code !== 0 && audioClean) {
        // 音声フィルタ非対応環境ではクリーンアップなしで再試行
        setStatusMsg("音声フィルタ非対応のため再試行中…");
        const retry = await ffmpeg.exec(baseArgs(graph, "[ac]"));
        if (retry !== 0) throw new Error("動画の書き出しに失敗しました");
      } else if (code !== 0) {
        throw new Error("動画の書き出しに失敗しました");
      }

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
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${lang === v ? "border-[#5b6cff] bg-[#5b6cff]/30 text-[#5b6cff]" : "border-[#d6d9e6] text-[#5a6080] hover:border-[#5b6cff]"}`}>
      {label}
    </button>
  );

  return (
    <div className="h-[calc(100vh-185px)] overflow-y-auto output-scroll px-3 md:px-6 py-5 space-y-5 max-w-3xl">
      <p className="text-sm text-[#5a6080] leading-relaxed">
        撮影動画をアップ → <span className="text-[#5b6cff]">AI監督が言い淀みをチェック → 無音カット → 画面中央テロップ（日/中/2段組）</span>まで全自動。完成MP4はそのままインスタ投稿OK、微調整したい時はSRTをCapCutへ
      </p>

      {/* STEP 1: 台本選択 */}
      <div className="border border-[#e3e5ef] bg-white rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-[#1e2440]">① テロップにする台本を選ぶ</p>
        <select
          onChange={e => {
            const s = scripts.find(x => x.id === e.target.value);
            if (s) { setNarration(extractNarration(s.script).join("\n")); setZhLines([]); setZhHashtags(""); }
          }}
          className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-sm rounded-xl p-2.5 focus:outline-none focus:border-[#5b6cff]/50">
          <option value="">ライブラリから選択…</option>
          {scripts.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
        <textarea value={narration} onChange={e => { setNarration(e.target.value); setZhLines([]); }} rows={5}
          placeholder="またはナレーションを直接貼り付け（1行＝テロップ1枚の目安）"
          className="w-full bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff]/50" />

        {/* テロップ言語 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-[#7b809c]">テロップ言語：</span>
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
          <div className="text-xs text-[#5a6080] bg-[#f1f2f7]/60 rounded-xl p-3 space-y-1">
            <p className="text-green-600">✅ 中国語テロップ {zhLines.length}行 生成済み</p>
            {zhHashtags && <p className="text-red-500">中華圏向けタグ： {zhHashtags}</p>}
          </div>
        )}
      </div>

      {/* STEP 2: 動画アップロード */}
      <div className="border border-[#e3e5ef] bg-white rounded-2xl p-4 space-y-3">
        <p className="text-sm font-bold text-[#1e2440]">② 撮影した動画を選ぶ</p>
        <input type="file" accept="video/*"
          onChange={e => { const f = e.target.files?.[0]; if (f) analyze(f); }}
          className="block w-full text-sm text-[#5a6080] file:mr-3 file:px-4 file:py-2 file:rounded-xl file:border-0 file:bg-[#1c2340] file:text-white file:font-bold file:text-xs hover:file:bg-[#2a3358]" />
        {phase === "analyzing" && <p className="text-xs text-[#7b809c]">🔍 音声を解析中…</p>}
        {segments.length > 0 && (
          <p className="text-xs text-green-600">
            ✅ 解析完了：発話 {segments.length} 区間 ／ {duration.toFixed(1)}秒 → 約{keptDuration.toFixed(1)}秒（{(duration - keptDuration).toFixed(1)}秒カット）
            {cues.length > 0 && ` ／ テロップ ${cues.length}枚`}
          </p>
        )}

        {/* 自動QAパイプラインのライブログ */}
        {segments.length > 0 && !geminiReady && (
          <p className="text-xs text-[#9ba0b8]">💡 GEMINI_API_KEYを設定すると、AI監督カット＋品質QAループが自動実行されます</p>
        )}
        {qaLog.length > 0 && (
          <div className="bg-[#f1f2f7]/60 border border-blue-200 rounded-xl p-3 space-y-1">
            {qaLog.map((m, i) => (
              <p key={i} className="anim-in text-xs text-[#2a3052]">{m}</p>
            ))}
            {qaRunning && <div className="pt-1"><Spinner label="自動QA実行中…" /></div>}
          </div>
        )}

        {/* QAレポート */}
        {qaReport && !qaRunning && (
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-blue-600">📋 品質QAレポート</p>
              {qaReport.score !== null && (
                <span className={`text-lg font-black ${qaReport.score >= 90 ? "text-green-600" : "text-orange-500"}`}>
                  {qaReport.score}点{qaReport.score >= 90 ? " ✅" : ""}
                </span>
              )}
            </div>
            {qaReport.fixes.length > 0 && (
              <div className="text-xs text-[#2a3052]">
                <p className="text-[#7b809c] mb-0.5">自動修正：</p>
                {qaReport.fixes.map((f, i) => <p key={i}>・{f}</p>)}
              </div>
            )}
            {qaReport.issues.length > 0 && (
              <div className="text-xs text-orange-300">
                <p className="text-orange-500 mb-0.5">⚠ カットでは直せない問題：</p>
                {qaReport.issues.map((f, i) => <p key={i}>・{f}</p>)}
              </div>
            )}
            {qaReport.reshoot.length > 0 && (
              <div className="text-xs text-red-500">
                <p className="text-red-500/70 mb-0.5">🎥 撮り直し推奨：</p>
                {qaReport.reshoot.map((f, i) => <p key={i}>・{f}</p>)}
              </div>
            )}
            {qaReport.advice && <p className="text-xs text-[#5a6080]">💬 総評：{qaReport.advice}</p>}
          </div>
        )}
      </div>

      {/* STEP 3: 出力 */}
      {phase !== "idle" && phase !== "analyzing" && segments.length > 0 && (
        <div className="border border-[#5b6cff]/40 bg-[#5b6cff]/10 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-[#5b6cff]">③ プレビューで確認 → 書き出し</p>

          {/* 書き出し前プレビュー：テロップがリアルタイムで重なる */}
          {previewUrl && shiftedCues.length > 0 && (
            <div className="space-y-2">
              <div className="relative bg-black rounded-xl overflow-hidden max-w-[280px] mx-auto">
                <video src={previewUrl} controls playsInline
                  onTimeUpdate={e => setPreviewTime((e.target as HTMLVideoElement).currentTime)}
                  className="w-full aspect-[9/16] object-cover" />
                {activeCueIdx >= 0 && (
                  <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center pointer-events-none">
                    <span className="inline-block text-white font-black text-sm leading-snug px-1"
                      style={{ textShadow: "0 0 4px #000, 0 0 8px #000, 2px 2px 2px #000" }}>
                      {shiftedCues[activeCueIdx].text}
                    </span>
                    {lang !== "ja" && zhLines[activeCueIdx] && (
                      <span className="block text-white/90 font-bold text-[10px] mt-0.5"
                        style={{ textShadow: "0 0 4px #000, 2px 2px 2px #000" }}>
                        {zhLines[activeCueIdx]}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 text-xs">
                <span className="text-[#7b809c]">テロップがズレていたら：</span>
                <button onClick={() => setShift(s => Math.round((s - 0.2) * 10) / 10)}
                  className="btn-pop px-2.5 py-1 border border-[#d6d9e6] rounded-lg text-[#2a3052]">◀ 0.2秒早く</button>
                <span className="font-bold text-[#5b6cff] w-14 text-center">{shift > 0 ? "+" : ""}{shift.toFixed(1)}秒</span>
                <button onClick={() => setShift(s => Math.round((s + 0.2) * 10) / 10)}
                  className="btn-pop px-2.5 py-1 border border-[#d6d9e6] rounded-lg text-[#2a3052]">0.2秒遅く ▶</button>
              </div>
              <p className="text-xs text-[#9ba0b8] text-center">※プレビューは元動画のまま再生されます（無音カットは書き出し時に適用）</p>
            </div>
          )}
          {shiftedCues.length === 0 && (
            <p className="text-xs font-bold text-red-500">⚠ テロップが0枚です。①で台本を選ぶかナレーションを入力してください</p>
          )}

          {/* テロップスタイル選択 */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[#7b809c]">スタイル：</span>
            {(Object.keys(STYLES) as StyleKey[]).map(k => (
              <button key={k} onClick={() => setStyle(k)} title={STYLES[k].desc}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${style === k ? "border-[#5b6cff] bg-[#5b6cff]/30 text-[#5b6cff]" : "border-[#d6d9e6] text-[#5a6080] hover:border-[#5b6cff]"}`}>
                {STYLES[k].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-[#9ba0b8]">{STYLES[style].desc} ／ 出力は縦9:16・720×1280・30fpsに自動整形</p>
          <label className="flex items-center gap-2 text-xs text-[#5a6080] cursor-pointer">
            <input type="checkbox" checked={audioClean} onChange={e => setAudioClean(e.target.checked)} className="accent-indigo-500" />
            🎤 音声クリーンアップ（ノイズ除去＋音量をリール標準に正規化）
          </label>

          <button onClick={render} disabled={phase === "rendering" || qaRunning || (lang !== "ja" && zhLines.length === 0)}
            className="w-full py-3 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">
            {phase === "rendering" ? `処理中… ${progress}%` : qaRunning ? "自動QA完了までお待ちください…" : "🎬 書き出す（QA合格済みの内容で）"}
          </button>
          {lang !== "ja" && zhLines.length === 0 && (
            <p className="text-xs text-orange-500">⚠ 先に「🈶 中国語を生成」を押してください</p>
          )}
          {phase === "rendering" && (
            <div>
              <div className="h-2 bg-[#f1f2f7] rounded-full overflow-hidden">
                <div className="h-full bg-[#5b6cff] transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-[#7b809c] mt-1.5">{statusMsg}</p>
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
              className="flex-1 min-w-[140px] py-2 text-xs border border-[#d6d9e6] hover:border-[#5b6cff] text-[#2a3052] rounded-xl disabled:opacity-40 transition-colors">
              📄 SRT字幕（CapCut微調整用）
            </button>
            <button onClick={() => download("cutsheet.txt", generateCutSheet(segments, duration))}
              className="flex-1 min-w-[140px] py-2 text-xs border border-[#d6d9e6] hover:border-[#5b6cff] text-[#2a3052] rounded-xl transition-colors">
              ✂️ カット指示書
            </button>
          </div>
          <p className="text-xs text-[#9ba0b8]">CapCutで微調整する場合：元動画＋SRTを読み込めばテロップが編集可能な状態で載ります</p>
        </div>
      )}

      {errorMsg && <p className="text-xs text-red-500 leading-relaxed">⚠ {errorMsg}</p>}
    </div>
  );
}
