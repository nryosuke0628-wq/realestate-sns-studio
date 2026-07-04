"use client";

import { useState, useEffect, useRef } from "react";
import { extractNarration } from "@/lib/video";

// 全画面テレプロンプター：台本のナレーションを自動スクロール表示
export default function Teleprompter({ script, onClose }: { script: string; onClose: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(40); // px/秒
  const [fontSize, setFontSize] = useState(38);
  const [mirror, setMirror] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const lines = extractNarration(script);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    lastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      if (scrollRef.current) scrollRef.current.scrollTop += speed * dt;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing, speed]);

  const reset = () => {
    setPlaying(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* コントロールバー */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-[#181b30]/90 border-b border-[#262b4a] shrink-0">
        <button onClick={() => setPlaying(!playing)}
          className={`px-5 py-2 rounded-xl text-sm font-bold transition-colors ${playing ? "bg-red-600 hover:bg-red-500 text-white" : "bg-green-600 hover:bg-green-500 text-white"}`}>
          {playing ? "⏸ 一時停止" : "▶ スタート"}
        </button>
        <button onClick={reset} className="px-3 py-2 rounded-xl text-sm border border-[#333a63] text-gray-300 hover:border-[#0fa793]/70">⏮ 最初から</button>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          速度
          <input type="range" min={15} max={120} value={speed} onChange={e => setSpeed(Number(e.target.value))} className="w-24 accent-teal-500" />
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          文字
          <input type="range" min={24} max={64} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-24 accent-teal-500" />
        </label>
        <button onClick={() => setMirror(!mirror)}
          className={`px-3 py-2 rounded-xl text-xs border transition-colors ${mirror ? "border-[#2fd4be] text-[#2fd4be]" : "border-[#333a63] text-gray-400"}`}>
          🪞 ミラー
        </button>
        <button onClick={onClose} className="ml-auto px-4 py-2 rounded-xl text-sm border border-[#333a63] text-gray-300 hover:border-red-500 hover:text-red-400">✕ 閉じる</button>
      </div>

      {/* 目線ガイドライン */}
      <div className="relative flex-1 overflow-hidden">
        <div className="absolute left-0 right-0 top-[28%] h-0.5 bg-[#2fd4be]/40 z-10 pointer-events-none" />
        <div ref={scrollRef}
          className="h-full overflow-y-auto scrollbar-hide px-6 md:px-16"
          style={{ transform: mirror ? "scaleX(-1)" : undefined }}>
          <div className="h-[28vh]" />
          {lines.map((line, i) => (
            <p key={i} className="text-white font-bold leading-relaxed mb-8 text-center"
              style={{ fontSize: `${fontSize}px` }}>
              {line}
            </p>
          ))}
          <div className="h-[80vh]" />
        </div>
      </div>
    </div>
  );
}
