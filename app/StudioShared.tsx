"use client";

import { useState } from "react";
import { currentGenre } from "@/lib/studio-storage";

// テキスト中のURLをタップ可能なリンクに変換して表示
export function LinkedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/(https?:\/\/[^\s)）」】、。]+)/g);
  return (
    <pre className={className ?? "text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed"}>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-600 break-all">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </pre>
  );
}

export function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs px-2 py-0.5 rounded border border-[#d6d9e6] text-[#5a6080] hover:text-[#1e2440] hover:border-[#5b6cff] transition-colors">
      {copied ? "✓ コピー済" : "コピー"}
    </button>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#5a6080]">
      <svg className="animate-spin w-4 h-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      {label}
    </div>
  );
}

export function ThreadsPanel({ posts }: { posts: string[] }) {
  const [statuses, setStatuses] = useState<Record<number, "idle" | "posting" | "done" | "error">>({});
  const [errors, setErrors] = useState<Record<number, string>>({});

  // replyToId を渡すと、その投稿への返信として投稿する。成功時は投稿IDを返す
  const postOne = async (i: number, text: string, replyToId?: string): Promise<string | null> => {
    setStatuses(p => ({ ...p, [i]: "posting" }));
    try {
      const clean = text.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
      const res = await fetch("/api/threads-post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean, genre: currentGenre(), replyToId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "投稿失敗");
      setStatuses(p => ({ ...p, [i]: "done" }));
      return typeof data.postId === "string" ? data.postId : null;
    } catch (e) {
      setStatuses(p => ({ ...p, [i]: "error" }));
      setErrors(p => ({ ...p, [i]: e instanceof Error ? e.message : "エラー" }));
      return null;
    }
  };

  // 「全て投稿」＝連投。1本目を親、続きは直前の投稿への返信としてぶら下げ、1つのスレッドにする
  const postAll = async () => {
    let parentId: string | undefined;
    for (let i = 0; i < posts.length; i++) {
      const id = await postOne(i, posts[i], parentId);
      if (!id) break; // 失敗したら連鎖を止める（宙に浮いた返信を作らない）
      parentId = id;
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, 2000));
    }
  };

  return (
    <div className="border border-orange-300 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-orange-200 bg-orange-50">
        <div className="flex items-center gap-2">
          <span>🧵</span>
          <span className="font-semibold text-orange-500 text-sm">Threads 自動投稿</span>
          <span className="text-xs text-orange-500/50">{posts.length}投稿</span>
        </div>
        <button onClick={postAll} className="text-xs px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg transition-colors">
          ⚡ 全て投稿
        </button>
      </div>
      <div className="p-3 space-y-3">
        {posts.map((post, i) => {
          const clean = post.replace(/^【投稿\d+[^】]*】\n?/, "").replace(/\（約\d+文字\）/, "").trim();
          const status = statuses[i] ?? "idle";
          return (
            <div key={i} className="bg-white border border-[#e3e5ef] rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-orange-500">投稿 {i + 1}</span>
                <div className="flex items-center gap-2">
                  <CopyBtn text={clean} />
                  <button onClick={() => postOne(i, post)} disabled={status === "posting" || status === "done"}
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                      status === "done" ? "bg-green-100 text-green-600 border border-green-300" :
                      status === "error" ? "bg-red-100 text-red-500 border border-red-300" :
                      status === "posting" ? "bg-[#e7e9f2] text-[#5a6080]" :
                      "bg-orange-600 hover:bg-orange-500 text-white"
                    }`}>
                    {status === "done" ? "✅ 済み" : status === "posting" ? "投稿中…" : status === "error" ? "❌ 再試行" : "投稿する"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-[#1e2440] whitespace-pre-wrap leading-relaxed">{clean}</p>
              {status === "error" && errors[i] && <p className="text-xs text-red-500 mt-2">⚠ {errors[i]}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
