# 完成しないゲーム（The Unfinished Game）

iPad展示用Webサイト

## 概要

完成したゲームが会期中にルール更新によって失効・変質し続ける展示作品。
ルールを読めば遊べるが、その結果が正しかったかどうかは最後まで確定しない。

## 技術要件

- iPad Safari での全画面表示（ガイド付きアクセス使用）
- オフライン対応不要（SIM通信前提）
- ルールデータは外部JSON（サーバー側で更新）
- タッチ操作：スクロールのみ許可
- **iPad SafariではGAS（Google Apps Script）が動作しない**（検証済み）

## 画面構成

2カラムレイアウト：
- **左カラム（固定）**：タイトル、準備、手番、勝利条件、メタ情報（ルール総数・日時）
- **右カラム（スクロール）**：ルールログ（#番号付き、タイプライター表示）

デザインは別途Figmaで定義済み。

## タイプライター表示仕様

### 基本動作
- テキストは1文字ずつ末尾に追加
- 末尾に擬似キャレット（縦長矩形、黒）を常駐
- 文字が出るたびにキャレットが右へ進む

### 思考状態（章タイトル出力完了時）
- キャレットが縦矩形 → 正円に変形
- 呼吸するような拡縮アニメーション（scale + opacity）をループ
- 約1秒間、文字生成を停止
- その後、通常状態に戻って続行

### 速度制御
- スライダー（1–100）で可変
- 人間の知覚に合わせた非線形変換
- 再生中でも即時反映

### スクロール挙動
- **最下部にいるとき**：自動で最新行に追従
- **上にスクロールしたとき**：自動スクロール停止、生成は裏で継続
- **「最新に戻る」ボタン**：最下部から離れているときのみ表示、押すと即座にジャンプ＆自動スクロール再開

## デザイン方針

- 背景：白、テキスト：黒、キャレット：黒
- 印刷物／法文書的な印象
- 読みやすいが「快適すぎない」
- UIで説明しない、振る舞いで意味を伝える

## データ構造（想定）

```json
{
  "title": "完成しないゲーム",
  "setup": ["..."],
  "turn": ["..."],
  "victory": "...",
  "rules": [
    { "id": 1, "text": "...", "type": "rule" },
    { "id": 2, "text": "第一章　...", "type": "chapter" },
    ...
  ]
}
```

## 表示しないもの

- 生成中表示
- FAQ
- 親切なまとめ・要約
- 操作説明の多用

## ボタン遷移モーション仕様（v1.0.40〜）

### 直列フロー

ボタン状態遷移は**完全直列**で実行される：

```
idle → generating:
  テキスト退場(EXIT) → ドレイン(黒→白) → テキスト出現(ENTER) → ゲージ増加 + タイプライター開始

generating → idle:
  テキスト退場(EXIT) → ドレイン(白→黒) → テキスト出現(ENTER)
```

テキスト生成（タイプライター）はボタンモーション完了後に開始する（`waitForButtonTransition()`）。

### ドレインアニメーション

- ゲージ（progress-fill）を100%→0%にスウィープして背景色を遷移させる
- Duration: **680ms**
- Easing: **ease-in-out**
- `drainProgressBar()` — Promise返却、await可能

### 白フラッシュ防止

- idle→generating: `progress-fill` を先に100%にセット（黒維持）→ `.idle` 除去 → ドレインで白露出
- generating→idle: `.idle` を先に追加（背景黒）→ `progress-fill` 100%確保 → ドレインでfill除去
- **`updateButtonState()` の idle 遷移時に `resetProgressBar()` を呼ばない**（先にfillを0%にすると白が一瞬露出する）

### テキスト退場・出現パラメータ

- Slide Distance: 16px
- Out Duration: 280ms / In Duration: 280ms
- Stagger: 65ms（JA/ENのずらし）
- Gap: 140ms（EXIT完了→ENTER開始の間）
- Exit Direction: down / Enter Direction: up
- Exit Order: EN先行 / Enter Order: JA先行

### ボタン状態とCSS

- `.action-button-container.idle` → 背景黒（`#000`）
- `.action-button-container`（デフォルト/generating）→ 背景白（`#FFF`）
- `.action-button` → テキスト白（`#FFF`）
- `.action-button.generating` → テキストグレー（`rgba(165,165,165,0.6)`）
- `.progress-fill` → 黒（`#000`）、width 0%〜100%でゲージ表現

### 生成中ルールテキストのスタイル

- `.rule-ja.generating` / `.rule-en.generating` → `color: rgba(165,165,165,0.6)`
- `.rule-number.generating` → `color: #999`
- `.caret.generating` → `background: #000`（常に黒）
- インク侵食（Ink Fade）: 打った文字が黒→グレーにフェード（`inkFadeDelay: 100ms`, `inkFadeDuration: 300ms`）
- ルール完了時に `.generating` クラス除去 → CSS transition で黒へフェード

## ファイル構成

- `index.html` — メインページ（iPad展示用）
- `styles.css` — スタイルシート
- `app.js` — メインアプリケーション（VERSION管理あり）
- `button-motion-test.html` — ボタンモーション検証用（スタンドアロン、パラメータ調整UI付き）
- `typewriter-test.html` — タイプライター検証用
- `caret-test.html` — キャレット検証用

## 開発メモ

- ローカル確認: `python3 -m http.server 8000` → `http://localhost:8000`
- デプロイ: GitHub Pages（main ブランチへ push で自動デプロイ）
- **バージョン管理**: コミット・プッシュ時は必ず `app.js` 冒頭の `const VERSION = 'x.y.z'` を更新すること。デバッグパネルに表示されるため、デプロイ済みバージョンの特定に使う
- テストHTMLはパラメータ調整→本番（app.js）に反映の流れで使う
- テストHTMLのスタイルは本番（styles.css / index.html）と一致させること
- ボタンテキスト色はCSSクラスで制御し、インラインの `style.color` で上書きしないこと

## TODO

- [x] iPadからスプレッドシートに現在のルール番号を送信する機能（Google Sheets API直接書き込み）
