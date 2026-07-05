import { NextRequest, NextResponse } from "next/server";

// アプリ全体をパスワードで保護（合言葉はVercel環境変数 APP_PASSWORD で変更可能）
export function middleware(request: NextRequest) {
  const pass = process.env.APP_PASSWORD ?? "2424";
  const auth = request.cookies.get("studio_auth")?.value;
  if (auth === pass) return NextResponse.next();

  // APIはリダイレクトせず401（Claude API等の勝手な利用を防ぐ）
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/lock";
  return NextResponse.redirect(url);
}

export const config = {
  // ロック画面・認証API・Cron（Vercelからの定期実行）は保護対象外
  matcher: ["/((?!lock|api/auth|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
