import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "不動産SNSスタジオ",
  description: "購入・売却層向け Instagramアカウント強化チーム",
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
