import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// サーバー側の台本ライブラリ（深夜バッチ生成物の置き場・全端末共通）
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ items: [], enabled: false });
  const genre = request.nextUrl.searchParams.get("genre") ?? "realestate";
  const { data } = await supabase
    .from("library_items")
    .select("*")
    .eq("genre", genre)
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json({ items: data ?? [], enabled: true });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  try {
    const body = await request.json();
    const { error } = await supabase.from("library_items").upsert({
      id: body.id,
      genre: body.genre ?? "realestate",
      title: body.title,
      script: body.script,
      threads: body.threads ?? [],
      caption: body.caption ?? null,
      status: body.status ?? "pending_review", // 深夜生成物は朝の目視確認待ち
      performance: body.performance ?? null,
      posted_at: body.postedAt ?? null,
      source: body.source ?? "manual", // "overnight" | "manual"
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失敗" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await supabase.from("library_items").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
