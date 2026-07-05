import { NextRequest, NextResponse } from "next/server";

// 平文パスワードの代わりに、パスワード+秘密鍵のハッシュをセッショントークンとして使う
// （Cookieが漏れても素のパスワードは復元できない）
async function sessionToken(pass: string): Promise<string> {
  const secret = process.env.APP_PASSWORD_SECRET ?? "studio-static-secret-v1";
  const data = new TextEncoder().encode(`${pass}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// サーバー内部（Cronルート→/api/generate等）専用の合言葉。ブラウザには一切送らないヘッダーなので
// クライアントから偽装できない。APP_PASSWORD_SECRETと同じ値をベースにするので追加設定不要
function internalKey(): string {
  return process.env.APP_PASSWORD_SECRET ?? "studio-static-secret-v1";
}

// アプリ全体をパスワードで保護（合言葉はVercel環境変数 APP_PASSWORD で変更可能）
export async function middleware(request: NextRequest) {
  // Cronパイプラインからのサーバー間呼び出し（例：/api/cron/overnight → /api/generate）
  if (request.headers.get("x-internal-key") === internalKey()) {
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
