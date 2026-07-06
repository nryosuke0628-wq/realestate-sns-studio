// 認証まわりで使う秘密値。リポジトリがpublicでもコードから推測できないよう、
// 必ずサーバー環境変数（リポジトリに存在しない値）から導出する。
// APP_PASSWORD_SECRET を設定すればそれを優先、なければ既存のAPIキー群から導出。
export async function appSecret(): Promise<string> {
  const base = process.env.APP_PASSWORD_SECRET
    ?? `derived:${process.env.ANTHROPIC_API_KEY ?? ""}:${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ログインCookieに入れるセッショントークン（パスワード＋秘密値のハッシュ）
export async function sessionToken(pass: string): Promise<string> {
  const secret = await appSecret();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pass}:${secret}`));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
