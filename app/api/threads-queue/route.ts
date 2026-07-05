import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 投稿キューの一覧（ジャンル別）
export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ items: [], enabled: false });
  const _reqUrl = request.url;
  const genre = new URL(_reqUrl ?? "http://x").searchParams.get("genre") ?? "realestate";
  const { data } = await supabase
    .from("threads_queue")
    .select("id, title, posts, status, error, created_at, posted_at")
    .eq("genre", genre)
    .order("created_at", { ascending: true })
    .limit(30);
  return NextResponse.json({ items: data ?? [], enabled: true });
}

// キューに追加（台本完成時に自動で呼ばれる）
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  try {
    const { title, posts, genre } = await request.json();
    if (!Array.isArray(posts) || posts.length === 0) {
      return NextResponse.json({ error: "posts required" }, { status: 400 });
    }
    const { error } = await supabase.from("threads_queue").insert({ title: title ?? "無題", posts, status: "pending", genre: genre ?? "realestate" });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "追加失敗" }, { status: 500 });
  }
}

// キューから削除
export async function DELETE(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase未設定" }, { status: 500 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await supabase.from("threads_queue").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
