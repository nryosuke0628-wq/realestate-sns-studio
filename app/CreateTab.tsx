"use client";

import { useState } from "react";
import { LinkedText, CopyBtn } from "./StudioShared";
import { callAPI } from "@/lib/studio-storage";
import ScriptTab from "./ScriptTab";
import WeeklyTab from "./WeeklyTab";

type AnalyzeMode = "buzz" | "data";

function NewsTab() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const run = async () => { setLoading(true); setOutput(""); setOutput(await callAPI("news_realestate")); setLoading(false); };
  return (
    <div className="h-full overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <button onClick={run} disabled={loading}
        className="mb-4 px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">
        {loading ? "生成中…" : "🗞 今日の時事ネタ×不動産を生成"}
      </button>
      {output && (
        <div className="bg-white border border-[#e3e5ef] rounded-2xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <LinkedText text={output} />
        </div>
      )}
    </div>
  );
}

function AnalyzeTab() {
  const [mode, setMode] = useState<AnalyzeMode>("buzz");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");
  const run = async () => { if (!input.trim()) return; setLoading(true); setOutput(""); setOutput(await callAPI(mode === "buzz" ? "buzz_analyze" : "data_analyze", input)); setLoading(false); };
  return (
    <div className="h-full overflow-y-auto output-scroll px-3 md:px-6 py-5">
      <div className="flex gap-2 mb-4">
        {(["buzz", "data"] as AnalyzeMode[]).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${mode === m ? "border-[#5b6cff] bg-[#5b6cff]/30 text-[#5b6cff]" : "border-[#d6d9e6] text-[#5a6080] hover:border-[#5b6cff]"}`}>
            {m === "buzz" ? "🔥 バズ投稿分析" : "📊 データ分析"}
          </button>
        ))}
      </div>
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={5}
        placeholder={mode === "buzz" ? "バズった投稿のURL・本文・数字を貼り付け…" : "フォロワー数・いいね数・リーチ数などを入力…"}
        className="w-full bg-white border border-[#e3e5ef] text-[#1e2440] text-sm rounded-xl p-3 resize-none focus:outline-none focus:border-[#5b6cff]/50 mb-3" />
      <button onClick={run} disabled={loading || !input.trim()}
        className="px-6 py-2.5 btn-pop bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors mb-4">
        {loading ? "分析中…" : "🔍 分析する"}
      </button>
      {output && (
        <div className="bg-white border border-[#e3e5ef] rounded-2xl p-4">
          <div className="flex justify-end mb-2"><CopyBtn text={output} /></div>
          <LinkedText text={output} />
        </div>
      )}
    </div>
  );
}


type CreateSection = "script" | "weekly" | "news" | "analyze";

const SECTIONS: { key: CreateSection; label: string; emoji: string }[] = [
  { key: "script",  label: "台本作成",   emoji: "🎬" },
  { key: "weekly",  label: "週間プラン", emoji: "📅" },
  { key: "news",    label: "時事ネタ",   emoji: "🗞" },
  { key: "analyze", label: "分析",       emoji: "🔍" },
];

// 🛠 Create：手動で作りたい日だけ使うツール置き場（台本作成／週間プラン／時事ネタ／分析）
export default function CreateTab() {
  const [section, setSection] = useState<CreateSection>("script");

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-1.5 px-3 md:px-6 pt-4 pb-1 overflow-x-auto scrollbar-hide shrink-0">
        {SECTIONS.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={`btn-pop px-4 py-2 text-xs font-bold rounded-full border whitespace-nowrap transition-colors ${
              section === s.key ? "bg-[#1c2340] text-white border-[#1c2340]" : "border-[#d6d9e6] text-[#5a6080] hover:border-[#5b6cff]"
            }`}>
            {s.emoji} {s.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {section === "script"  && <ScriptTab />}
        {section === "weekly"  && <WeeklyTab goScript={() => setSection("script")} />}
        {section === "news"    && <NewsTab />}
        {section === "analyze" && <AnalyzeTab />}
      </div>
    </div>
  );
}
