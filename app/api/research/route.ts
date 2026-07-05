import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 📦 リサーチ銀行：実測リサーチデータの貯蔵庫。生成時に自動注入される
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ items: [], enabled: false });
  const genre = request.nextUrl.searchParams.get("genre") ?? "realestate";
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("research_bank")
    .select("id, genre, content, source, created_at")
    .eq("genre", genre)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  return NextResponse.json({ items: data ?? [], enabled: true });
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  try {
    const { genre, content, source } = await request.json();
    if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
    const { error } = await supabase.from("research_bank").insert({
      genre: genre ?? "realestate", content, source: source ?? null,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "登録失敗" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await supabase.from("research_bank").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
