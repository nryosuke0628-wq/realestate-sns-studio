"use client";

import { useState, useEffect, useRef } from "react";
import { extractNarration } from "@/lib/video";

// 📹 撮影内蔵プロンプター：インカメのプレビューを背景に台本を自動スクロールしながら録画。
// 録画完了するとFileがonRecordedに渡り、そのまま自動編集パイプラインへ流れる
export default function RecordingPrompter({
  script, onClose, onRecorded,
}: {
  script: string;
  onClose: () => void;
  onRecorded: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(38);
  const [fontSize, setFontSize] = useState(30);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");

  const lines = extractNarration(script);

  // インカメ＋マイクを起動
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 } },
          audio: true,
        });
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      } catch {
        setErr("カメラ・マイクへのアクセスが許可されませんでした。ブラウザの設定を確認してください");
      }
    })();
    return () => { alive = false; streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  // 台本の自動スクロール
  useEffect(() => {
    if (!scrolling) { if (rafRef.current) cancelAnimationFrame(rafRef.current); return; }
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (scrollRef.current) scrollRef.current.scrollTop += speed * dt;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [scrolling, speed]);

  // 録画タイマー
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const startRec = () => {
    if (!streamRef.current) return;
    const mime = MediaRecorder.isTypeSupported("video/mp4")
      ? "video/mp4"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";
    const rec = new MediaRecorder(streamRef.current, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    chunksRef.current = [];
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      const file = new File([new Blob(chunksRef.current, { type: mime })], `recording.${ext}`, { type: mime });
      streamRef.current?.getTracks().forEach(t => t.stop());
      onRecorded(file);
    };
    rec.start(1000);
    recRef.current = rec;
    setElapsed(0);
    setRecording(true);
    setScrolling(true);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const stopRec = () => {
    setRecording(false);
    setScrolling(false);
    recRef.current?.stop();
  };

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* インカメプレビュー（ミラー表示・薄め） */}
      <video ref={videoRef} muted playsInline
        className="absolute inset-0 w-full h-full object-cover opacity-50"
        style={{ transform: "scaleX(-1)" }} />

      {/* 上部バー：RECタイマー */}
      <div className="relative z-10 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {recording && <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />}
          <span className="text-white font-bold text-sm tabular-nums" style={{ textShadow: "0 0 4px #000" }}>
            {recording ? `REC ${mmss}` : "準備OK"}
          </span>
        </div>
        <button onClick={() => { streamRef.current?.getTracks().forEach(t => t.stop()); onClose(); }}
          className="text-white/80 text-sm px-3 py-1.5 rounded-lg border border-white/30"
          style={{ textShadow: "0 0 4px #000" }}>✕ 閉じる</button>
      </div>

      {/* 目線ガイド（上寄せ＝インカメに目線が近い） */}
      <div className="relative z-10 flex-1 overflow-hidden">
        <div className="absolute left-0 right-0 top-[18%] h-0.5 bg-[#8b96ff]/50 pointer-events-none" />
        <div ref={scrollRef} className="h-full overflow-y-auto scrollbar-hide px-6">
          <div className="h-[18vh]" />
          {lines.map((line, i) => (
            <p key={i} className="text-white font-black leading-relaxed mb-6 text-center"
              style={{ fontSize: `${fontSize}px`, textShadow: "0 0 6px #000, 0 0 12px #000, 2px 2px 3px #000" }}>
              {line}
            </p>
          ))}
          <div className="h-[70vh]" />
        </div>
      </div>

      {err && <p className="relative z-10 text-center text-red-400 text-sm px-4 pb-2" style={{ textShadow: "0 0 4px #000" }}>{err}</p>}

      {/* 下部コントロール */}
      <div className="relative z-10 px-4 pb-6 pt-2 space-y-3">
        <div className="flex items-center justify-center gap-4 text-xs text-white/80" style={{ textShadow: "0 0 4px #000" }}>
          <label className="flex items-center gap-1.5">速度
            <input type="range" min={15} max={100} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-20 accent-indigo-400" />
          </label>
          <label className="flex items-center gap-1.5">文字
            <input type="range" min={20} max={48} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-20 accent-indigo-400" />
          </label>
          {recording && (
            <button onClick={() => setScrolling(s => !s)}
              className="px-3 py-1 rounded-lg border border-white/30">{scrolling ? "⏸ 文字停止" : "▶ 文字再開"}</button>
          )}
        </div>
        <div className="flex justify-center">
          {!recording ? (
            <button onClick={startRec} disabled={!!err}
              className="w-18 h-18 p-1 rounded-full border-4 border-white disabled:opacity-40">
              <span className="block w-14 h-14 rounded-full bg-red-500" />
            </button>
          ) : (
            <button onClick={stopRec} className="w-18 h-18 p-1 rounded-full border-4 border-white">
              <span className="block w-14 h-14 rounded-2xl bg-red-500 scale-50" />
            </button>
          )}
        </div>
        <p className="text-center text-white/50 text-xs" style={{ textShadow: "0 0 4px #000" }}>
          {recording ? "話し終わったら停止 → そのまま自動編集へ" : "赤ボタンで録画＋文字スクロール開始"}
        </p>
      </div>
    </div>
  );
}
