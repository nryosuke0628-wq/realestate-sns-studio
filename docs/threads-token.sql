-- Threadsの長期トークン(60日)を自動延長して保存するテーブル
create table if not exists threads_tokens (
  genre text primary key,
  token text not null,
  seed_token text not null,       -- 延長の起点になった環境変数のトークン（貼り替え検知用）
  refreshed_at timestamptz not null default now()
);
alter table threads_tokens enable row level security;  -- service role からのみ読み書き
