import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "R agent SNS studio",
  description: "不動産アカウントを、仕組みで伸ばす。AI台本生成から自動編集・自動投稿まで。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 描画前にテーマ＋ジャンルのクラスを適用（ちらつき防止・ロック画面にも効かせる）
  const themeInit = `try{var t=localStorage.getItem("theme");if(!t||t==="dark")document.documentElement.classList.add("dark");var g=localStorage.getItem("studio_genre");if(g==="coaching"||g==="sales")document.documentElement.classList.add(g);}catch(e){}`;
  return (
    <html lang="ja">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
