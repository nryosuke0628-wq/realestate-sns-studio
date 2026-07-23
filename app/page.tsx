"use client";

import { useState, useEffect } from "react";
import TodayTab from "./TodayTab";
import ThreadsTab from "./ThreadsTab";
import LibraryTab from "./LibraryTab";
import CreateTab from "./CreateTab";
import DashboardTab from "./DashboardTab";
import EditorTab from "./EditorTab";

type Tab = "threads" | "today" | "stock" | "edit" | "create" | "growth";
type Genre = "realestate" | "coaching" | "sales";

const GENRE_META: Record<Genre, { btn: string; tagline: string; engine: string }> = {
  realestate: { btn: "🏠 不動産",     tagline: "不動産アカウントを、仕組みで伸ばす。", engine: "Real Estate Growth Engine" },
  coaching:   { btn: "🎯 コーチング", tagline: "コーチング発信を、仕組みで伸ばす。",   engine: "Coaching Growth Engine" },
  sales:      { btn: "💼 営業",       tagline: "営業ノウハウを、仕組みで伸ばす。",     engine: "Sales Growth Engine" },
};

function applyGenreClass(g: Genre) {
  document.documentElement.classList.toggle("coaching", g === "coaching");
  document.documentElement.classList.toggle("sales", g === "sales");
}

// 当面はThreads自動投稿がメイン運用のため、Threadsを先頭・デフォルトに
const TABS: { key: Tab; en: string; jp: string }[] = [
  { key: "threads", en: "Threads", jp: "自動投稿" },
  { key: "stock",   en: "Stock",   jp: "ライブラリ" },
  { key: "today",   en: "Video",   jp: "動画制作" },
  { key: "edit",    en: "Edit",    jp: "動画編集" },
  { key: "create",  en: "Create",  jp: "作成ツール" },
  { key: "growth",  en: "Growth",  jp: "ダッシュボード" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("threads");
  const [dark, setDark] = useState(false);
  const [genre, setGenre] = useState<Genre>("realestate");

  useEffect(() => {
    const saved = localStorage.getItem("studio_genre");
    const g: Genre = saved === "coaching" || saved === "sales" ? saved : "realestate";
    setGenre(g);
    applyGenreClass(g);
  }, []);

  const switchGenre = (g: Genre) => {
    setGenre(g);
    localStorage.setItem("studio_genre", g);
    applyGenreClass(g);
  };

  // 初回はダーク（近未来テーマ）がデフォルト、以降はlocalStorageの選択を維持
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    const initial = saved ? saved === "dark" : true;
    setDark(initial);
    document.documentElement.classList.toggle("dark", initial);
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  return (
    <div className="min-h-screen bg-transparent">
      {/* エディトリアル・ヘッダー */}
      <header className="px-4 md:px-8 pt-5 pb-1 flex flex-wrap items-end justify-between gap-y-3 gap-x-4">
        <div>
          <h1 className="display-type text-2xl md:text-4xl text-white leading-none">
            R agent <span className="text-[#8b96ff]">SNS studio.</span>
          </h1>
          <p className="text-[11px] text-white/50 mt-1.5 font-medium tracking-wide">
            {GENRE_META[genre].tagline}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:block text-[10px] text-white/30 font-medium tracking-widest uppercase">
            {GENRE_META[genre].engine}
          </span>
          {/* ジャンル切替 */}
          <div className="flex rounded-full border border-white/15 overflow-hidden text-[11px] font-bold">
            {(Object.keys(GENRE_META) as Genre[]).map(g => (
              <button key={g} onClick={() => switchGenre(g)}
                className={`px-3 py-1.5 transition-colors whitespace-nowrap ${genre === g ? "bg-white text-[#171a2c]" : "text-white/50 hover:text-white"}`}>
                {GENRE_META[g].btn}
              </button>
            ))}
          </div>
          <button onClick={toggleTheme} aria-label="テーマ切替"
            className="btn-pop w-9 h-9 rounded-full border border-white/15 text-base flex items-center justify-center hover:border-white/40 transition-colors">
            <span className="inline-block transition-transform duration-500" style={{ transform: dark ? "rotate(360deg)" : "rotate(0deg)" }}>
              {dark ? "🌙" : "☀️"}
            </span>
          </button>
        </div>
      </header>

      {/* スライド式ナビ：英語見出し＋日本語サブ（Today / Stock / Create / Growth） */}
      <nav className="px-3 md:px-6 overflow-x-auto scrollbar-hide">
        <div className="flex min-w-max gap-1">
          {TABS.map(({ key, en, jp }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`relative px-4 py-2.5 text-left transition-colors whitespace-nowrap ${
                tab === key ? "" : "opacity-45 hover:opacity-80"
              }`}>
              <span className="display-type block text-base leading-tight text-white">{en}</span>
              <span className="block text-[10px] text-white/50 font-medium">{jp}</span>
              {tab === key && <span className="absolute left-3 right-3 bottom-0 h-[3px] rounded-full bg-[#8b96ff]" />}
            </button>
          ))}
        </div>
      </nav>
      <main key={`${tab}-${genre}`} className="anim-in mx-2 md:mx-6 mt-3 mb-6 bg-white rounded-[28px] shadow-2xl shadow-black/40 overflow-hidden">
        {tab === "threads" && <ThreadsTab />}
        {tab === "today"  && <TodayTab />}
        {tab === "stock"  && <LibraryTab />}
        {tab === "edit"   && <EditorTab />}
        {tab === "create" && <CreateTab />}
        {tab === "growth" && <DashboardTab />}
      </main>
    </div>
  );
}
