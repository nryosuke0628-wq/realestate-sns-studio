import { NextRequest, NextResponse } from "next/server";

// メモリ内の簡易レート制限（同一サーバーインスタンス内のみ有効。総当たり対策の第一段）
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_ATTEMPTS;
}

async function sessionToken(pass: string): Promise<string> {
  const secret = process.env.APP_PASSWORD_SECRET ?? "studio-static-secret-v1";
  const data = new TextEncoder().encode(`${pass}:${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (tooManyAttempts(ip)) {
    return NextResponse.json({ error: "試行回数が多すぎます。5分後にもう一度お試しください" }, { status: 429 });
  }

  const { password } = await request.json();
  const pass = process.env.APP_PASSWORD ?? "2424";
  if (password !== pass) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const token = await sessionToken(pass);
  const res = NextResponse.json({ success: true });
  // 10分間有効・操作のたびにミドルウェアが延長。Cookieには素のパスワードではなくハッシュを保存
  res.cookies.set("studio_auth", token, {
    maxAge: 600,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return res;
}
