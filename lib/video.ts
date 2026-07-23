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

// ナレーション行をテロップ用に短く分割（maxLen=1枚あたりの文字数目安。22≒2行/34≒3行）
export function splitForCaptions(lines: string[], maxLen = 22): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= maxLen) { out.push(line); continue; }
    // 句読点で分割してから詰め直す
    const parts = line.split(/(?<=[。！？!?、])/);
    let buf = "";
    for (const p of parts) {
      if ((buf + p).length > maxLen && buf) { out.push(buf); buf = p; }
      else buf += p;
    }
    if (buf) out.push(buf);
  }
  return out.filter(s => s.trim().length > 0);
}

// 🎙 台本なしモード：文字起こし（AI実測タイミング付きフレーズ）をテロップ＋タイミングに変換。
// 長いフレーズは分割し、時間はフレーズ内で文字数比例に配分する
export function transcriptToCaptions(
  transcript: Phrase[], maxLen = 22,
): { caps: string[]; timings: ({ start: number; end: number } | undefined)[] } {
  const caps: string[] = [];
  const timings: ({ start: number; end: number } | undefined)[] = [];
  for (const p of transcript) {
    const text = p.text.trim();
    if (!text) continue;
    const chunks = splitForCaptions([text], maxLen);
    const total = chunks.reduce((s, c) => s + c.length, 0) || 1;
    let cursor = p.start;
    for (const c of chunks) {
      const dur = (p.end - p.start) * (c.length / total);
      caps.push(c);
      timings.push({ start: cursor, end: cursor + dur });
      cursor += dur;
    }
  }
  return { caps, timings };
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

// 元動画タイムラインの時刻 → 発話タイムライン（カット後）の時刻
export function originalToSpeechTime(t: number, segments: Segment[]): number {
  let acc = 0;
  for (const s of segments) {
    if (t <= s.start) return acc;
    if (t < s.end) return acc + (t - s.start);
    acc += s.end - s.start;
  }
  return acc;
}

// AI（Gemini）が実測した各行の発話タイミングからCueを構築。
// タイミングが欠けた行は「日本語の話速 ≒ 7文字/秒」で推定補完
export function cuesFromTimings(
  captions: string[],
  timings: ({ start: number; end: number } | undefined)[],
  segments: Segment[],
): Cue[] {
  const total = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const cues: Cue[] = [];
  let prevEnd = 0;
  for (let i = 0; i < captions.length; i++) {
    const t = timings[i];
    let start: number, end: number;
    if (t && t.end > t.start) {
      start = Math.max(originalToSpeechTime(t.start, segments), prevEnd);
      end = Math.max(originalToSpeechTime(t.end, segments), start + 0.5);
    } else {
      start = prevEnd;
      end = start + Math.max(0.7, captions[i].length / 7);
    }
    start = Math.min(start, total);
    end = Math.min(end, total);
    if (end > start) cues.push({ start, end, text: captions[i] });
    prevEnd = end;
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

// カット適用後の音声波形を再構成（QAでAIに「編集後の音」を試聴させるため）
export function extractEditedAudio(channel: Float32Array, sampleRate: number, segments: Segment[]): Float32Array {
  const totalSamples = segments.reduce((sum, s) => sum + Math.floor((s.end - s.start) * sampleRate), 0);
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const s of segments) {
    const from = Math.floor(s.start * sampleRate);
    const to = Math.min(channel.length, Math.floor(s.end * sampleRate));
    out.set(channel.subarray(from, to), offset);
    offset += to - from;
  }
  return out;
}

// 🎬 プロ編集家AI（機械チェック）：読み切れない字幕・見切れ・断片カットを自動修正
export function proEditorPass(
  cues: Cue[], segments: Segment[],
): { cues: Cue[]; segments: Segment[]; fixes: string[] } {
  const fixes: string[] = [];

  // 0.25秒未満の断片区間は不自然なので除去
  const cleanSegs = segments.filter(s => s.end - s.start >= 0.25);
  if (cleanSegs.length < segments.length) {
    fixes.push(`${segments.length - cleanSegs.length}個の断片カット（0.25秒未満）を整理`);
  }

  const total = cleanSegs.reduce((sum, s) => sum + (s.end - s.start), 0);
  const out = cues.map(c => ({ ...c }));

  // 読み切れない字幕（日本語の読速 ≒ 11文字/秒）を次の字幕までの空きに延長
  let extended = 0;
  for (let i = 0; i < out.length; i++) {
    const minDur = Math.max(0.6, out[i].text.length / 11);
    if (out[i].end - out[i].start < minDur) {
      const limit = i + 1 < out.length ? out[i + 1].start : total;
      const newEnd = Math.min(out[i].start + minDur, limit);
      if (newEnd > out[i].end) { out[i].end = newEnd; extended++; }
    }
  }
  if (extended > 0) fixes.push(`読み切れない字幕${extended}枚の表示時間を延長`);

  // 見切れ対策：長い行はレンダリング時に自動縮小される（件数を報告のみ）
  const longLines = out.filter(c => c.text.length > 15).length;
  if (longLines > 0) fixes.push(`長い字幕${longLines}枚は見切れ防止のため自動縮小`);

  return { cues: out.filter(c => c.end > c.start), segments: cleanSegs, fixes };
}

// CapCut等で手動カットする人向けの「残す区間」指示書
export function generateCutSheet(segments: Segment[], originalDuration: number): string {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  const header = `■ ジャンプカット指示書\n元動画：${fmt(originalDuration)} → カット後：約${fmt(kept)}（${(originalDuration - kept).toFixed(1)}秒短縮）\n\n【残す区間】\n`;
  return header + segments.map((s, i) => `${String(i + 1).padStart(2, " ")}. ${fmt(s.start)} 〜 ${fmt(s.end)}`).join("\n");
}

// ── 言い直し（リテイク）検出 ──────────────────────────────
export interface Phrase { start: number; end: number; text: string }

function normText(s: string): string {
  return s.replace(/[、。！？!?,.\s「」…・〜ー]/g, "");
}

// バイグラムDice係数（0〜1）で文の類似度を測る
function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      set.set(g, (set.get(g) ?? 0) + 1);
    }
    return set;
  };
  const ga = grams(a), gb = grams(b);
  let overlap = 0;
  ga.forEach((c, g) => { overlap += Math.min(c, gb.get(g) ?? 0); });
  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

// 同じ・ほぼ同じフレーズが近くで2回出てくる＝言い直し。
// 「あとに言った方が本命」の原則で、前の失敗テイクをカット対象にする
export function detectRetakes(transcript: Phrase[]): Phrase[] {
  const cuts: Phrase[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const a = normText(transcript[i].text);
    if (a.length < 6) continue;
    // 言い直しは直後〜3フレーズ以内に来る
    for (let j = i + 1; j < Math.min(transcript.length, i + 4); j++) {
      const b = normText(transcript[j].text);
      if (b.length < 6) continue;
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length <= b.length ? b : a;
      if (longer.includes(shorter) || similarity(a, b) >= 0.75) {
        cuts.push({ ...transcript[i] });
        break;
      }
    }
  }
  return cuts;
}

// カットの復元用：区間を発話区間リストに戻す（マージ）
export function mergeRange(segments: Segment[], range: Segment): Segment[] {
  const all = [...segments, { start: range.start, end: range.end }].sort((x, y) => x.start - y.start);
  const out: Segment[] = [];
  for (const s of all) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + 0.05) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

// 指示テキストに一致するフレーズを文字起こしから探してカット範囲にする
export function findPhraseRanges(transcript: Phrase[], phrase: string): Phrase[] {
  const target = normText(phrase);
  if (target.length < 3) return [];
  return transcript.filter(p => {
    const t = normText(p.text);
    return t.includes(target) || target.includes(t) || similarity(t, target) >= 0.7;
  });
}

// ── 語ごとポップ（1語ずつ出す）用のチャンク分割 ─────────────
// Whisperの語単位タイムスタンプが無い環境での擬似実装。
// 日本語を助詞・句読点の後ろで区切り、3文字以上のまとまりに詰め直す。
export function popChunks(text: string, maxChunks = 5): string[] {
  const raw = text.split(/(?<=[、。！？!?・…\s])|(?<=[はがをにでへともねよ])/).filter(Boolean);
  let chunks: string[] = [];
  let buf = "";
  for (const p of raw) {
    buf += p;
    if (buf.replace(/\s/g, "").length >= 3) { chunks.push(buf); buf = ""; }
  }
  if (buf) { if (chunks.length) chunks[chunks.length - 1] += buf; else chunks.push(buf); }
  // 多すぎるチャンクは均等に結合してmaxChunksに収める（drawtext数の爆発を防ぐ）
  if (chunks.length > maxChunks) {
    const grouped: string[] = [];
    const per = Math.ceil(chunks.length / maxChunks);
    for (let i = 0; i < chunks.length; i += per) grouped.push(chunks.slice(i, i + per).join(""));
    chunks = grouped;
  }
  return chunks.length ? chunks : [text];
}

// 🔬 相互検証：Geminiの字幕タイミングをRMS波形の実測（発話区間）で検証・補正
// 「あるAIの出力を別の実測値で検証してから使う」原則の実装
export function validateTimings(
  timings: ({ start: number; end: number } | undefined)[],
  segments: Segment[],
): { timings: ({ start: number; end: number } | undefined)[]; corrected: number } {
  let corrected = 0;
  const inSpeech = (t: number) => segments.some(s => t >= s.start - 0.1 && t <= s.end + 0.1);
  const snapToSpeech = (t: number) => {
    if (inSpeech(t)) return t;
    let best = t, dist = Infinity;
    for (const s of segments) {
      for (const edge of [s.start, s.end]) {
        const d = Math.abs(edge - t);
        if (d < dist) { dist = d; best = edge; }
      }
    }
    return best;
  };
  const out = timings.map(t => {
    if (!t) return t;
    const s = snapToSpeech(t.start);
    const e = snapToSpeech(t.end);
    if (Math.abs(s - t.start) > 0.15 || Math.abs(e - t.end) > 0.15) corrected++;
    return e > s ? { start: s, end: e } : t;
  });
  return { timings: out, corrected };
}
