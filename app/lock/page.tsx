"use client";

import { useState } from "react";

export default function LockPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!password) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error();
      window.location.href = "/";
    } catch {
      setError("パスワードが違います");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="anim-in bg-white rounded-[28px] shadow-2xl shadow-black/40 p-8 md:p-10 w-full max-w-sm text-center">
        <h1 className="display-type text-3xl text-[#171a2c] leading-none mb-1">
          R agent <span className="text-[#8b96ff]">SNS studio.</span>
        </h1>
        <p className="text-[11px] text-[#7b809c] mb-8">members only</p>
        <input
          type="password"
          inputMode="numeric"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="パスワード"
          autoFocus
          className="w-full text-center tracking-[0.5em] text-lg bg-[#f1f2f7] border border-[#d6d9e6] text-[#1e2440] rounded-xl px-4 py-3 focus:outline-none focus:border-[#5b6cff] placeholder:tracking-normal placeholder:text-sm placeholder:text-[#a6abc2] mb-3"
        />
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        <button onClick={submit} disabled={loading || !password}
          className="btn-pop w-full py-3 bg-[#1c2340] hover:bg-[#2a3358] disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-colors">
          {loading ? "確認中…" : "入室する"}
        </button>
      </div>
    </div>
  );
}
