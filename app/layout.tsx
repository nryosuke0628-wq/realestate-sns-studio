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
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
