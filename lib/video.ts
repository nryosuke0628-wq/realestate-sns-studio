// 動画自動編集のコアロジック（すべてブラウザ内で完結・サーバー費ゼロ）
// - WebAudioで無音区間を検出 → ジャンプカット位置を算出
// - 台本のナレーションを発話区間に文字数比例で割り付け → テロップのタイミング生成

export interface Segment {
  start: number; // 秒（元動画タイムライン）
  end: number;
}

export interface Cue {
  start: number; // 秒（発話タイムライン＝カット後動画の時間軸）
  end: number;
  text: string;
}

// 台本テキストからナレーション行だけを抽出（テレプロンプター・テロップ共用）
export function extractNarration(script: string): string[] {
  const lines: string[] = [];
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    // 「ナレーション：「〜」」の形式
    const narMatch = line.match(/ナレーション[：:]\s*「(.+?)」/);
    if (narMatch) { lines.push(narMatch[1]); continue; }
    // カギ括弧だけの行（複数行ナレーションの続き）
    const soloMatch = line.match(/^「(.+?)」$/);
    if (soloMatch) { lines.push(soloMatch[1]); continue; }
  }
  // 抽出できなければ台本全体を行分割で返す
  if (lines.join("").length < 30) {
    return script.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  }
  return lines;
}

// ナレーション行をテロップ用に短く分割（1枚あたり最大22文字目安）
export function splitForCaptions(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= 22) { out.push(line); continue; }
    // 句読点で分割してから詰め直す
    const parts = line.split(/(?<=[。！？!?、])/);
    let buf = "";
    for (const p of parts) {
      if ((buf + p).length > 22 && buf) { out.push(buf); buf = p; }
      else buf += p;
    }
    if (buf) out.push(buf);
  }
  return out.filter(s => s.trim().length > 0);
}

// 音声波形から発話区間を検出（RMSベース・適応しきい値）
export function detectSpeechSegments(channel: Float32Array, sampleRate: number): Segment[] {
  const frameSec = 0.05;
  const frameLen = Math.floor(sampleRate * frameSec);
  const frames = Math.floor(channel.length / frameLen);
  if (frames === 0) return [];

  const rms: number[] = [];
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const off = i * frameLen;
    for (let j = 0; j < frameLen; j++) sum += channel[off + j] * channel[off + j];
    rms.push(Math.sqrt(sum / frameLen));
  }

  // ノイズフロア（下位20%）の3倍をしきい値に（最低0.01）
  const sorted = [...rms].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)];
  const threshold = Math.max(noiseFloor * 3, 0.01);

  // 発話フレームを区間にまとめる
  const rawSegs: Segment[] = [];
  let segStart: number | null = null;
  for (let i = 0; i < frames; i++) {
    const speaking = rms[i] > threshold;
    if (speaking && segStart === null) segStart = i * frameSec;
    if (!speaking && segStart !== null) {
      rawSegs.push({ start: segStart, end: i * frameSec });
      segStart = null;
    }
  }
  if (segStart !== null) rawSegs.push({ start: segStart, end: frames * frameSec });

  // 0.35秒以下のギャップは結合 → 前後0.15秒パディング → 0.3秒未満の区間は除去
  const merged: Segment[] = [];
  for (const seg of rawSegs) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end <= 0.35) last.end = seg.end;
    else merged.push({ ...seg });
  }
  const total = channel.length / sampleRate;
  const padded = merged
    .map(s => ({ start: Math.max(0, s.start - 0.15), end: Math.min(total, s.end + 0.15) }))
    .filter(s => s.end - s.start >= 0.3);

  // パディングで重なった区間を再結合
  const final: Segment[] = [];
  for (const seg of padded) {
    const last = final[final.length - 1];
    if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end);
    else final.push({ ...seg });
  }
  return final;
}

// テロップ行を発話時間に文字数比例で割り付け（発話タイムライン上のCue）
export function allocateCues(captions: string[], segments: Segment[]): Cue[] {
  const totalSpeech = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const totalChars = captions.reduce((sum, c) => sum + c.length, 0);
  if (totalSpeech <= 0 || totalChars === 0) return [];

  const cues: Cue[] = [];
  let cursor = 0;
  for (const text of captions) {
    const dur = Math.max(0.7, (text.length / totalChars) * totalSpeech);
    const start = Math.min(cursor, totalSpeech);
    const end = Math.min(cursor + dur, totalSpeech);
    if (end > start) cues.push({ start, end, text });
    cursor += dur;
  }
  // はみ出した場合は末尾から均等に圧縮
  const overflow = cursor - totalSpeech;
  if (overflow > 0 && cues.length > 0) {
    const scale = totalSpeech / cursor;
    let acc = 0;
    for (const c of cues) {
      const d = (c.end - c.start) * scale;
      c.start = acc; c.end = acc + d; acc += d;
    }
  }
  return cues;
}

// 発話タイムラインの時刻 → 元動画タイムラインの時刻
export function speechTimeToOriginal(t: number, segments: Segment[]): number {
  let remaining = t;
  for (const seg of segments) {
    const dur = seg.end - seg.start;
    if (remaining <= dur) return seg.start + remaining;
    remaining -= dur;
  }
  return segments.length > 0 ? segments[segments.length - 1].end : t;
}

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60), ms = Math.round((sec % 1) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

// SRT字幕ファイル生成。mapToOriginal=trueなら元動画（カット前）用のタイミングに変換
export function generateSRT(cues: Cue[], segments: Segment[], mapToOriginal: boolean): string {
  return cues.map((c, i) => {
    const start = mapToOriginal ? speechTimeToOriginal(c.start, segments) : c.start;
    const end = mapToOriginal ? speechTimeToOriginal(c.end, segments) : c.end;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${c.text}\n`;
  }).join("\n");
}

// AI監督が指定した削除区間を発話区間から差し引く
export function subtractRanges(segments: Segment[], removes: Segment[]): Segment[] {
  let result = [...segments.map(s => ({ ...s }))];
  for (const r of removes) {
    const next: Segment[] = [];
    for (const s of result) {
      if (r.end <= s.start || r.start >= s.end) { next.push(s); continue; }
      if (r.start > s.start) next.push({ start: s.start, end: r.start });
      if (r.end < s.end) next.push({ start: r.end, end: s.end });
    }
    result = next;
  }
  return result.filter(s => s.end - s.start >= 0.3);
}

// 音声をモノラル16kHzのWAVに変換（Gemini解析用・サイズ削減）
export function encodeWav16k(channel: Float32Array, srcRate: number): Blob {
  const targetRate = 16000;
  const ratio = srcRate / targetRate;
  const outLen = Math.floor(channel.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const v = channel[Math.floor(i * ratio)];
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, targetRate, true); dv.setUint32(28, targetRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  writeStr(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  return new Blob([header, pcm.buffer], { type: "audio/wav" });
}

// CapCut等で手動カットする人向けの「残す区間」指示書
export function generateCutSheet(segments: Segment[], originalDuration: number): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const header = `■ ジャンプカット指示書\n元動画：${fmt(originalDuration)} → カット後：約${fmt(kept)}（${(originalDuration - kept).toFixed(1)}秒短縮）\n\n【残す区間】\n`;
  return header + segments.map((s, i) => `${String(i + 1).padStart(2, " ")}. ${fmt(s.start)} 〜 ${fmt(s.end)}`).join("\n");
}
