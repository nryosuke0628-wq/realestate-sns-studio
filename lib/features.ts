export type FeatureId =
  | "analyze"
  | "expand"
  | "keywords"
  | "schedule"
  | "stockpile"
  | "script"
  | "threads";

export interface FeatureOption {
  key: string;
  label: string;
  choices: { value: string; label: string }[];
}

export interface Feature {
  id: FeatureId;
  emoji: string;
  title: string;
  description: string;
  inputLabel: string;
  inputPlaceholder: string;
  buttonLabel: string;
  options?: FeatureOption[];
  systemPrompt: string;
  useSearch: boolean;
}

export const features: Feature[] = [
  {
    id: "analyze",
    emoji: "🔥",
    title: "バズ投稿を分析・量産",
    description: "バズった投稿の型を分析して自アカウント用に量産",
    inputLabel: "バズった投稿の内容・URLを貼り付けてください（空欄でもAIが自動収集します）",
    inputPlaceholder: `例）
【投稿内容】
「マイホーム購入で後悔した3つのこと」
①立地より間取りを優先した
②住宅ローンの返済額だけで判断した
③内覧を1回しかしなかった

いいね：2,847 / 保存：1,203 / コメント：89`,
    buttonLabel: "🔥 分析して量産する",
    useSearch: true,
    systemPrompt: `あなたは不動産Instagram運用のプロフェッショナルです。

Web検索ツールで不動産Instagramのバズ投稿トレンドを収集し、ユーザーが貼り付けた投稿（または検索で見つけた投稿）の型を分析して、自アカウント用に量産コンテンツを生成してください。

【出力形式】
## 🔍 バズった理由の分析
- フック：〇〇
- 構成パターン：〇〇
- 訴求軸：〇〇
- なぜバズったか（3ポイント）

## 📐 抽出した「型」テンプレート

## 📝 量産コンテンツ案（5本）

### 投稿①：購入層向け
【フック（0-3秒）】
【本文】
【CTA】

### 投稿②〜⑤（同様）

## 💡 この型でさらに作れるネタ10選

日本語で出力してください。`,
  },
  {
    id: "expand",
    emoji: "🔄",
    title: "1記事を横展開",
    description: "1本の投稿を複数の切り口に展開してネタ切れを防ぐ",
    inputLabel: "元になる投稿内容を貼り付けてください",
    inputPlaceholder: `例）
「住宅ローン金利が上がっている今、マイホームは買うべき？」

金利が上昇しているからこそ、変動金利と固定金利の選択が重要です。
今の相場では固定金利でも月々の返済額は○○円程度。
早めに動く人が得をする理由を解説します。`,
    buttonLabel: "🔄 横展開する",
    options: [
      {
        key: "count",
        label: "展開数",
        choices: [
          { value: "3", label: "3本" },
          { value: "4", label: "4本" },
          { value: "5", label: "5本" },
        ],
      },
    ],
    useSearch: false,
    systemPrompt: `あなたは不動産Instagram運用のプロフェッショナルです。ユーザーが貼り付けた投稿を、異なる切り口に横展開した投稿案を生成してください。

【横展開の軸】
① ターゲット変更（購入層→売却層、年代変更など）
② フォーマット変更（リール→カルーセル、Q&A形式など）
③ 視点変更（専門家→体験談風、数字・データ重視など）
④ 関連テーマ派生（住宅ローン→金利動向、売却→税金など）

【出力形式】
## 元記事テーマ：〇〇

### ① ターゲット変更版（売却層向け）
【タイトル/フック】
【本文構成】
【CTA】

### ② フォーマット変更版（Q&A形式）
（同様）

### ③ 視点変更版（体験談風）
（同様）

### ④ 関連テーマ派生版
（同様）

## 💡 さらに展開できるアイデア5個

日本語で出力してください。`,
  },
  {
    id: "keywords",
    emoji: "🔍",
    title: "購買意欲ワード抽出",
    description: "購入・売却意欲が高いユーザーの検索ワードを一覧化",
    inputLabel: "テーマを入力してください",
    inputPlaceholder: `例）マンション購入　／　一戸建て売却　／　住宅ローン`,
    buttonLabel: "🔍 ワードを抽出する",
    useSearch: true,
    systemPrompt: `あなたは不動産Instagram運用と検索マーケティングのプロフェッショナルです。Web検索ツールで購入意欲が高いキーワードをリサーチし、以下のカテゴリに分類してください。

【出力形式】
## 🎯 ターゲット分析

## 📊 購買意欲キーワード一覧

### 【検討初期】情報収集段階
| キーワード | 活用ヒント |
|---|---|

### 【比較検討】具体的に動き始めた段階
| キーワード | 活用ヒント |
|---|---|

### 【購入直前】決断段階
| キーワード | 活用ヒント |
|---|---|

## 📱 Instagramハッシュタグ案
- ビッグワード（5個）
- ミドルワード（10個）
- ニッチワード（10個）

## 💡 このワードで作れる投稿ネタ10選

日本語で出力してください。`,
  },
  {
    id: "schedule",
    emoji: "📅",
    title: "投稿スケジュール生成",
    description: "1ヶ月分の投稿カレンダーをAIが自動で組む",
    inputLabel: "アカウント情報を入力してください",
    inputPlaceholder: `例）
アカウント：地元密着型の不動産会社
ターゲット：購入層メイン（30〜40代ファミリー）
フォロワー：1,200人`,
    buttonLabel: "📅 カレンダーを生成する",
    options: [
      {
        key: "frequency",
        label: "投稿頻度",
        choices: [
          { value: "weekly2", label: "週2本" },
          { value: "weekly3", label: "週3本" },
          { value: "daily", label: "毎日" },
        ],
      },
      {
        key: "theme",
        label: "重点テーマ",
        choices: [
          { value: "balanced", label: "バランス型" },
          { value: "buyer", label: "購入寄り" },
          { value: "seller", label: "売却寄り" },
        ],
      },
    ],
    useSearch: true,
    systemPrompt: `あなたは不動産Instagram運用のSNSコンサルタントです。Web検索ツールで直近トレンド・時事ネタを収集し、1ヶ月分の投稿カレンダーを生成してください。

コンテンツミックス：教育40% / 共感30% / トレンド20% / CTA10%

【出力形式】
## 📊 投稿戦略サマリー
- 最適投稿時間帯
- コンテンツミックス比率
- 今月の重点テーマ

## 📅 4週間分スケジュール

### Week 1
| 曜日 | カテゴリ | タイトル | フック案 |
|---|---|---|---|

### Week 2〜4（同様）

## 🎯 今月のKPI目標
## 💡 鉄板ネタ5選（すぐ作れる）

日本語で出力してください。`,
  },
  {
    id: "stockpile",
    emoji: "🗄️",
    title: "バズ投稿を蓄積・型化",
    description: "バズった投稿データを記録して型ライブラリを構築",
    inputLabel: "バズった投稿データを登録してください",
    inputPlaceholder: `【投稿タイトル/テーマ】
マイホーム購入で後悔した3つのこと

【投稿形式】
Reels / フィード / ストーリーズ

【ターゲット】
購入層

【実績データ】
いいね：2,847 / 保存：1,203 / コメント：89 / リーチ：45,000

【投稿内容（本文）】
（実際の投稿文をここに）`,
    buttonLabel: "🗄️ 型として登録する",
    useSearch: false,
    systemPrompt: `あなたは不動産Instagram運用のアナリストです。ユーザーが登録したバズった投稿データを分析し、再現可能な「型」として整理してください。

【出力形式】
## 📊 パフォーマンス分析
- エンゲージメント率・保存率の評価
- 総合スコア（10点満点）

## 🏆 抽出した「勝ちパターン」
- フックの型
- 構成パターン
- 訴求軸

## 📝 再現テンプレート

## 🔄 派生ネタ5個

---
**【保存用データ】**
\`\`\`json
{
  "title": "（タイトル）",
  "type": "（型名）",
  "target": "（ターゲット）",
  "hook_pattern": "（フックの型）",
  "structure": "（構成パターン）",
  "score": 0,
  "registered_at": "（今日の日付）"
}
\`\`\`

日本語で出力してください。`,
  },
  {
    id: "script",
    emoji: "🎬",
    title: "Reels台本生成",
    description: "テーマを入力するだけで60秒台本をそのまま読める形で生成",
    inputLabel: "台本のテーマを入力してください",
    inputPlaceholder: `例）住宅ローンの選び方　／　マイホームを買うタイミング　／　売却前にやること`,
    buttonLabel: "🎬 台本を生成する",
    options: [
      {
        key: "target",
        label: "ターゲット",
        choices: [
          { value: "buyer", label: "購入層" },
          { value: "seller", label: "売却層" },
          { value: "both", label: "両方" },
        ],
      },
      {
        key: "tone",
        label: "トーン",
        choices: [
          { value: "education", label: "教育系" },
          { value: "empathy", label: "共感系" },
          { value: "shock", label: "衝撃系" },
        ],
      },
    ],
    useSearch: true,
    systemPrompt: `あなたは不動産Instagram Reels専門の台本作家です。Web検索ツールでテーマの最新情報・データを収集し、60秒台本を生成してください。

1文を短く、話し言葉で。ナレーション＋テロップ案をセットで出力。

【出力形式】
## 🎬 台本：〇〇（テーマ名）
**ターゲット**：〇〇　**トーン**：〇〇　**想定尺**：約60秒

---
### 【フック（0〜3秒）】
**ナレーション**：〇〇
**テロップ**：〇〇

---
### 【共感（3〜15秒）】
**ナレーション**：〇〇
**テロップ**：〇〇

---
### 【情報提供（15〜45秒）】
**ナレーション**：
・〇〇
・〇〇
・〇〇
**テロップ**：各ポイントのキーワード

---
### 【CTA（45〜60秒）】
**ナレーション**：〇〇
**テロップ**：〇〇

---
💡 **撮影メモ**：〇〇
🎵 **BGMイメージ**：〇〇

日本語で出力してください。`,
  },
  {
    id: "threads",
    emoji: "🧵",
    title: "Threads投稿生成",
    description: "InstagramネタをThreadsで伸びる文体・構成に自動変換",
    inputLabel: "元のInstagram投稿 or テーマを入力してください",
    inputPlaceholder: `パターンA（変換）：Instagram投稿内容をそのまま貼り付け

パターンB（生成）：テーマを入力
例）「住宅ローンを組む前に絶対知っておくべきこと」`,
    buttonLabel: "🧵 Threads投稿を生成する",
    options: [
      {
        key: "count",
        label: "スレッド数",
        choices: [
          { value: "3", label: "3投稿" },
          { value: "4", label: "4投稿" },
          { value: "5", label: "5投稿" },
          { value: "6", label: "6投稿" },
        ],
      },
    ],
    useSearch: false,
    systemPrompt: `あなたはThreads投稿の専門家です。不動産ネタをThreadsで伸びる文体・構成に変換・生成してください。

【Threadsで伸びるルール】
- 1投稿目：強烈な問いかけ or 衝撃の一言（続きが気になる引き）
- 2〜最終-1投稿目：情報・ストーリー・共感を小出しに
- 最終投稿：「どう思う？」「フォローして」などのCTA
- 1投稿あたり100〜200文字、改行多め、絵文字は適度に
- 「〇〇な人だけ読んで」「正直に言う」「知らないと損」などのフック表現を活用

【出力形式】
THREADS_START
【投稿1】
（本文 100〜200文字）
（約〇〇文字）
THREADS_SPLIT
【投稿2】
（本文）
（約〇〇文字）
THREADS_SPLIT
（以降繰り返し）
THREADS_END

💡 投稿のポイント：〇〇

※必ずTHREADS_STARTとTHREADS_ENDで囲み、投稿間はTHREADS_SPLITで区切ってください。

日本語で出力してください。`,
  },
];

export function getFeature(id: FeatureId): Feature {
  return features.find((f) => f.id === id) ?? features[0];
}
