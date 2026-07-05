import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const pass = process.env.APP_PASSWORD ?? "2424";
  if (password !== pass) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  const res = NextResponse.json({ success: true });
  // 30日間有効
  res.cookies.set("studio_auth", pass, {
    maxAge: 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
