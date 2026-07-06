import { NextRequest, NextResponse } from "next/server";
import { appSecret, sessionToken } from "./lib/secret";

// アプリ全体をパスワードで保護（合言葉はVercel環境変数 APP_PASSWORD で変更可能）
export async function middleware(request: NextRequest) {
  // Cronパイプラインからのサーバー間呼び出し（例：/api/cron/overnight → /api/generate）。
  // キーは環境変数からのみ導出されるため、公開リポジトリを読んでも偽装できない
  const internal = request.headers.get("x-internal-key");
  if (internal && internal === (await appSecret())) {
    return NextResponse.next();
  }

  const pass = process.env.APP_PASSWORD ?? "2424";
  const expected = await sessionToken(pass);
  const auth = request.cookies.get("studio_auth")?.value;
  if (auth === expected) {
    // 操作があるたびに10分延長（10分間無操作なら再ログイン要求）
    const res = NextResponse.next();
    res.cookies.set("studio_auth", expected, { maxAge: 600, httpOnly: true, sameSite: "lax", path: "/", secure: true });
    return res;
  }

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
