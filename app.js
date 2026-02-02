/**
 * 完成しないゲーム - メインアプリケーション
 */

// ========================================
// 設定
// ========================================
const VERSION = '1.0.22';

const CONFIG = {
  spreadsheetId: '1eBk4OIyFRCGJYUgZ15bavQl5pngufGKUYm18Y0evJQg',
  rulesSheetId: '487776336',
  gameInfoSheetId: '1056169981',
  configSheetId: '697189836',  // リモート設定シート
  typewriterSpeed: 8, // 1-100
  // URLパラメータまたはリモート設定から取得
  startRule: parseInt(new URLSearchParams(window.location.search).get('startRule')) || 8,
  // GAS直接呼び出し（ステータス記録用）
  statusGasUrl: 'https://script.google.com/macros/s/AKfycbztMkg9RFatDXuUNjSeOCwhUpyWZRGNOLLGXkxMAr8jkblqFTWR86tsSMMzAJj0I3nazw/exec',

  // ゲージ設定
  gaugeDuration: 54000,    // 0→90%の時間（ms）
  gaugePausePoint: 0.90,   // 停止ポイント（0-1）
  gaugeWaveAmplitude: 0.015, // ゆらぎの振幅（±1.5%）
  gaugeWaveFrequency: 0.3,   // 波の周波数（Hz）

  // タイポ設定
  typoChance: 0.05,        // タイポ確率（0-1）
  typoPause: 4,            // タイポ後の停止（倍率）

  // 切り替え停止（倍率）
  pauseNumToJa: 6,         // #番号 → 日本語
  pauseJaToEn: 7.5,        // 日本語 → 英語
  pauseEnToNum: 24,        // 英語 → 次の#番号（黒化後の間、100ms単位）

  // 句読点停止（倍率）
  pauseKuten: 9,           // 句点（。）
  pauseTouten: 7.5,        // 読点（、）
  pauseOpenBracket: 4,     // 開き括弧（「）
  pauseCloseBracket: 4,    // 閉じ括弧（」）
  pausePeriod: 6.5,        // ピリオド（.）
  pauseComma: 3,           // カンマ（,）
  pauseSpace: 0.5,         // スペース

  // ランダム幅
  varianceJa: 0.64,        // 日本語（±64%）
  varianceEn: 0.64,        // 英語（±64%）
};

// ========================================
// 状態管理
// ========================================
const state = {
  rules: [],
  segments: [],  // 「、」で分割されたセグメント
  currentSegmentIndex: 0,
  gameInfo: null,
  isGenerating: false,
  isThinking: false,  // 文字出力完了後、ゲージ待ち状態
  isPaused: false,  // リモートからの一時停止フラグ
  isAutoScroll: true,
  typewriterSpeed: CONFIG.typewriterSpeed,
  currentRuleElement: null,  // 現在表示中のルール要素
  currentJaElement: null,    // 現在表示中の日本語要素
  currentEnElement: null,    // 現在表示中の英語要素
  currentNumberElement: null, // 現在表示中の番号要素
  currentCaret: null,         // 画面上の唯一のキャレット

  // デバッグ用設定（リアルタイム変更可能）
  gaugeDuration: CONFIG.gaugeDuration,
  gaugePausePoint: CONFIG.gaugePausePoint,
  gaugeWaveAmplitude: CONFIG.gaugeWaveAmplitude,
  gaugeWaveFrequency: CONFIG.gaugeWaveFrequency,
  typoChance: CONFIG.typoChance,
  typoPause: CONFIG.typoPause,
  pauseNumToJa: CONFIG.pauseNumToJa,
  pauseJaToEn: CONFIG.pauseJaToEn,
  pauseEnToNum: CONFIG.pauseEnToNum,
  pauseKuten: CONFIG.pauseKuten,
  pauseTouten: CONFIG.pauseTouten,
  pauseOpenBracket: CONFIG.pauseOpenBracket,
  pauseCloseBracket: CONFIG.pauseCloseBracket,
  pausePeriod: CONFIG.pausePeriod,
  pauseComma: CONFIG.pauseComma,
  pauseSpace: CONFIG.pauseSpace,
  varianceJa: CONFIG.varianceJa,
  varianceEn: CONFIG.varianceEn,
};

// URLパラメータでデバッグモード判定（デフォルトでオン）
let isDebugMode = true;

// タイトル5回タップでデバッグモード
let titleTapCount = 0;
let titleTapTimer = null;

// ========================================
// DOM要素
// ========================================
const elements = {
  titleJa: document.getElementById('title-ja'),
  titleEn: document.getElementById('title-en'),
  componentsJa: document.getElementById('components-ja'),
  componentsEn: document.getElementById('components-en'),
  actionsJa: document.getElementById('actions-ja'),
  actionsEn: document.getElementById('actions-en'),
  victoryJa: document.getElementById('victory-ja'),
  victoryEn: document.getElementById('victory-en'),
  ruleList: document.getElementById('rule-list'),
  actionButton: document.getElementById('action-button'),
  actionButtonContainer: document.getElementById('action-button-container'),
  progressFill: document.getElementById('progress-fill'),
  scrollToBottom: document.getElementById('scroll-to-bottom'),
};

// ========================================
// Googleスプレッドシート データ取得
// ========================================
function getSheetUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.spreadsheetId}/gviz/tq?tqx=out:json&gid=${sheetId}`;
}

function parseGoogleSheetResponse(text) {
  const jsonString = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?/);
  if (!jsonString) throw new Error('Invalid response format');
  return JSON.parse(jsonString[1]);
}

async function fetchSheetData(sheetId) {
  const response = await fetch(getSheetUrl(sheetId));
  const text = await response.text();
  return parseGoogleSheetResponse(text);
}

// ========================================
// ゲーム情報の読み込みと表示
// ========================================
async function loadGameInfo() {
  try {
    const data = await fetchSheetData(CONFIG.gameInfoSheetId);
    const rows = data.table.rows;

    const gameInfo = {
      title: { ja: '', en: '' },
      components: { ja: [], en: [] },
      actions: { ja: [], en: [] },
      victory: { ja: '', en: '' },
    };

    // 2行目以降からデータを収集（1行目はヘッダー）
    rows.slice(1).forEach((row, index) => {
      const cells = row.c;
      if (!cells) return;

      const getValue = (cell) => (cell && cell.v) || '';

      // 最初のデータ行からタイトルと勝利条件を取得
      if (index === 0) {
        gameInfo.title.ja = getValue(cells[0]);
        gameInfo.title.en = getValue(cells[1]);
        gameInfo.victory.ja = getValue(cells[6]);
        gameInfo.victory.en = getValue(cells[7]);
      }

      // 内容物を収集
      const componentJa = getValue(cells[2]);
      const componentEn = getValue(cells[3]);
      if (componentJa) gameInfo.components.ja.push(componentJa);
      if (componentEn) gameInfo.components.en.push(componentEn);

      // アクションを収集
      const actionJa = getValue(cells[4]);
      const actionEn = getValue(cells[5]);
      if (actionJa) gameInfo.actions.ja.push(actionJa);
      if (actionEn) gameInfo.actions.en.push(actionEn);
    });

    state.gameInfo = gameInfo;
    // キャッシュに保存
    localStorage.setItem('cachedGameInfo', JSON.stringify(gameInfo));
    renderGameInfo();
  } catch (error) {
    console.error('Failed to load game info:', error);
    // キャッシュから復帰を試みる
    const cached = localStorage.getItem('cachedGameInfo');
    if (cached) {
      console.log('Loading game info from cache');
      state.gameInfo = JSON.parse(cached);
      renderGameInfo();
    }
  }
}

function renderGameInfo() {
  const info = state.gameInfo;
  if (!info) return;

  elements.titleJa.textContent = info.title.ja;
  elements.titleEn.textContent = info.title.en;
  elements.componentsJa.textContent = info.components.ja.join('、');
  elements.componentsEn.textContent = info.components.en.join(', ');
  elements.actionsJa.innerHTML = info.actions.ja.map(action => `<li>${action}</li>`).join('');
  elements.actionsEn.innerHTML = info.actions.en.map(action => `<li>${action}</li>`).join('');
  elements.victoryJa.textContent = info.victory.ja;
  elements.victoryEn.textContent = info.victory.en;
}

// ========================================
// ルールの読み込みとセグメント化
// ========================================
async function loadRules() {
  try {
    const data = await fetchSheetData(CONFIG.rulesSheetId);
    const rows = data.table.rows;

    state.rules = rows.map(row => {
      const cells = row.c;
      if (!cells) return null;

      return {
        num: cells[0]?.v || 0,
        ja: cells[1]?.v || '',
        en: cells[2]?.v || '',
      };
    }).filter(rule => rule && rule.ja);

    // キャッシュに保存
    localStorage.setItem('cachedRules', JSON.stringify(state.rules));

    // セグメント化（「、」で分割）
    state.segments = prepareSegments(state.rules);

    console.log(`Loaded ${state.rules.length} rules, ${state.segments.length} segments`);
  } catch (error) {
    console.error('Failed to load rules:', error);
    // キャッシュから復帰を試みる
    const cached = localStorage.getItem('cachedRules');
    if (cached) {
      console.log('Loading rules from cache');
      state.rules = JSON.parse(cached);
      state.segments = prepareSegments(state.rules);
      console.log(`Loaded ${state.rules.length} rules from cache`);
    }
  }
}

function prepareSegments(rules) {
  const segments = [];
  rules.forEach(rule => {
    // 「、」の後ろで分割（「、」を含む）
    const jaParts = rule.ja.split(/(?<=、)/);

    jaParts.forEach((part, i) => {
      segments.push({
        num: rule.num,
        jaSegment: part,
        enFull: i === jaParts.length - 1 ? rule.en : null,  // 最後のセグメントのみ英語
        isFirst: i === 0,  // このルールの最初のセグメントか
        isLast: i === jaParts.length - 1,  // このルールの最後のセグメントか
      });
    });
  });
  return segments;
}

// ========================================
// タイプライター表示
// ========================================
class Typewriter {
  constructor(element, options = {}) {
    this.element = element;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.isRunning = false;
    this.caret = null;
  }

  getDelay() {
    const normalized = state.typewriterSpeed / 100;
    const delay = 200 * Math.pow(0.05, normalized);
    return Math.max(10, Math.min(200, delay));
  }

  createCaret(isGenerating = false) {
    const caret = document.createElement('span');
    caret.className = 'caret';
    if (isGenerating) {
      caret.classList.add('generating');
    }
    return caret;
  }

  async type(text, options = {}) {
    const { generating = false } = options;
    this.isRunning = true;
    this.caret = this.createCaret(generating);

    const totalChars = text.length;

    for (let i = 0; i < text.length; i++) {
      if (!this.isRunning) break;

      const char = text[i];
      const textNode = document.createTextNode(char);

      if (this.caret.parentNode) {
        this.caret.parentNode.insertBefore(textNode, this.caret);
      } else {
        this.element.appendChild(textNode);
        this.element.appendChild(this.caret);
      }

      // 進捗コールバック
      this.onProgress((i + 1) / totalChars);

      if (state.isAutoScroll) {
        scrollToBottom();
      }

      await this.delay(this.getDelay());
    }

    this.isRunning = false;
    this.onComplete();
    return this.caret;  // キャレットを返す（思考状態用）
  }

  removeCaret() {
    if (this.caret && this.caret.parentNode) {
      this.caret.remove();
    }
    this.caret = null;
  }

  async think(duration = 1000) {
    if (this.caret) {
      this.caret.classList.add('thinking');
      await this.delay(duration);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
  }
}

// ========================================
// ルール表示
// ========================================
function createRuleElement(num) {
  const ruleElement = document.createElement('div');
  ruleElement.className = 'rule-item';

  const numberElement = document.createElement('span');
  numberElement.className = 'rule-number generating';
  // 番号は空で作成（後でタイプライター表示）
  numberElement.textContent = '';
  numberElement.dataset.num = num;  // 番号を保存

  const contentElement = document.createElement('div');
  contentElement.className = 'rule-content';

  const jaElement = document.createElement('p');
  jaElement.className = 'rule-ja generating';

  const enElement = document.createElement('p');
  enElement.className = 'rule-en generating';

  contentElement.appendChild(jaElement);
  contentElement.appendChild(enElement);

  ruleElement.appendChild(numberElement);
  ruleElement.appendChild(contentElement);

  elements.ruleList.appendChild(ruleElement);

  return { ruleElement, numberElement, jaElement, enElement };
}

function makeCurrentRuleBlack() {
  if (state.currentNumberElement) {
    state.currentNumberElement.classList.remove('generating');
  }
  if (state.currentJaElement) {
    state.currentJaElement.classList.remove('generating');
  }
  if (state.currentEnElement) {
    state.currentEnElement.classList.remove('generating');
  }
}

// ========================================
// ページタイトル更新（リモート監視用）
// ========================================
function updatePageTitle() {
  const currentSegment = state.segments[state.currentSegmentIndex - 1];
  const currentRuleNum = currentSegment ? currentSegment.num : CONFIG.startRule;

  let status = '待機中';
  if (state.isPaused) {
    status = '停止中';
  } else if (state.isGenerating) {
    status = '生成中';
  }

  document.title = `#${currentRuleNum} ${status}`;
}

// ========================================
// ステータス送信（GAS直接呼び出しでスプレッドシートに記録）
// ========================================
let lastReportedStatus = null;

function reportStatus() {
  if (!CONFIG.statusGasUrl) return;

  const currentSegment = state.segments[state.currentSegmentIndex - 1];
  const currentRuleNum = currentSegment ? currentSegment.num : CONFIG.startRule;

  let status = '待機中';
  if (state.isPaused) {
    status = '停止中';
  } else if (state.isGenerating) {
    status = '生成中';
  }

  // 同じステータスなら送信しない
  const statusKey = `${currentRuleNum}-${status}`;
  if (statusKey === lastReportedStatus) return;
  lastReportedStatus = statusKey;

  // GASに直接fetch（mode: 'no-cors'でCORS制限を回避）
  const url = `${CONFIG.statusGasUrl}?ruleNum=${currentRuleNum}&status=${encodeURIComponent(status)}`;

  fetch(url, { mode: 'no-cors' })
    .then(() => console.log(`Status reported: #${currentRuleNum} ${status}`))
    .catch(e => console.error('Status report failed:', e));
}

// ========================================
// キャレット制御
// ========================================
function showThinkingCaret() {
  removeCurrentCaret();
  const caret = document.createElement('span');
  caret.className = 'caret thinking generating';
  if (state.currentJaElement) {
    state.currentJaElement.appendChild(caret);
  }
  state.currentCaret = caret;
}

function removeCurrentCaret() {
  if (state.currentCaret && state.currentCaret.parentNode) {
    state.currentCaret.remove();
  }
  state.currentCaret = null;
}

function transformCaretToBar() {
  if (state.currentCaret) {
    state.currentCaret.classList.remove('thinking');
  }
}

function transformCaretToThinking() {
  if (state.currentCaret) {
    state.currentCaret.classList.add('thinking');
  }
}

// ========================================
// 初期表示（#1〜#8 + #9の最初のブレークポイント）
// ========================================
function findSegmentIndexForRule(ruleNum, position) {
  // 指定ルール番号の最初/最後のセグメントインデックスを返す
  let firstIndex = -1;
  let lastIndex = -1;

  for (let i = 0; i < state.segments.length; i++) {
    if (state.segments[i].num === ruleNum) {
      if (firstIndex === -1) firstIndex = i;
      lastIndex = i;
    }
  }

  return position === 'first' ? firstIndex : lastIndex;
}

function findNextBreakpointIndex(startIndex) {
  // 指定インデックスから次のブレークポイント（「、」で終わるセグメント）を探す
  for (let i = startIndex; i < state.segments.length; i++) {
    if (state.segments[i].jaSegment.endsWith('、')) {
      return i;
    }
  }
  return state.segments.length - 1; // 見つからなければ最後まで
}

function displayInitialRules() {
  // 開始ルール番号を取得（URLパラメータまたはリモート設定）
  const startRule = CONFIG.startRule;

  // 開始ルールの最後のセグメントを取得
  const ruleEnd = findSegmentIndexForRule(startRule, 'last');

  if (ruleEnd === -1) {
    console.log(`Rule #${startRule} not found, displaying all available rules`);
    return;
  }

  // 次のルールの最初のブレークポイントまで表示
  const initialEndIndex = findNextBreakpointIndex(ruleEnd + 1);

  for (let i = 0; i <= initialEndIndex; i++) {
    const segment = state.segments[i];

    // 新しいルール番号なら要素を作成
    if (segment.isFirst) {
      const { numberElement, jaElement, enElement } = createRuleElement(segment.num);
      state.currentNumberElement = numberElement;
      state.currentJaElement = jaElement;
      state.currentEnElement = enElement;

      // 初期表示なので番号を即座に設定
      numberElement.textContent = `#${segment.num}`;

      // 開始ルール以下は黒、それ以降はグレー
      if (segment.num <= startRule) {
        numberElement.classList.remove('generating');
        jaElement.classList.remove('generating');
        enElement.classList.remove('generating');
      }
    }

    // 日本語テキストを追加（タイプライターなし）
    const textNode = document.createTextNode(segment.jaSegment);
    state.currentJaElement.appendChild(textNode);

    // ルールの最後なら英語も表示
    if (segment.isLast && segment.enFull) {
      state.currentEnElement.textContent = segment.enFull;
      // 英語表示後、ルールを黒に
      state.currentNumberElement.classList.remove('generating');
      state.currentJaElement.classList.remove('generating');
    }
  }

  // 次のセグメントインデックスを設定
  state.currentSegmentIndex = initialEndIndex + 1;

  // 最後のセグメントにキャレットを表示
  showThinkingCaret();

  // スクロール位置を最下部に
  setTimeout(() => {
    scrollToBottom();
  }, 100);

  // ページタイトル更新・ステータス送信
  updatePageTitle();
  reportStatus();

  console.log(`Initial display complete. Next segment index: ${state.currentSegmentIndex}`);
}

// ========================================
// ブレークポイント生成
// ========================================

// 次のブレークポイントまで生成するセグメントを計算
function calculateSegmentsToGenerate() {
  const segments = [];
  let totalChars = 0;
  let i = state.currentSegmentIndex;
  let foundBreakpointInNextRule = false;

  while (i < state.segments.length && !foundBreakpointInNextRule) {
    const seg = state.segments[i];
    segments.push({ ...seg, index: i });
    totalChars += seg.jaSegment.length;

    if (seg.isLast && seg.enFull) {
      totalChars += seg.enFull.length;
    }

    // 次のルールのブレークポイントで停止
    if (seg.isLast) {
      // 現在のルールが終了、次のルールへ
      i++;
      while (i < state.segments.length) {
        const nextSeg = state.segments[i];
        segments.push({ ...nextSeg, index: i });
        totalChars += nextSeg.jaSegment.length;

        if (nextSeg.jaSegment.endsWith('、')) {
          foundBreakpointInNextRule = true;
          break;
        }

        if (nextSeg.isLast && nextSeg.enFull) {
          totalChars += nextSeg.enFull.length;
        }
        i++;
      }
      break;
    }
    i++;
  }

  return { segments, totalChars };
}

// メイン生成関数：次のブレークポイントまで生成
async function generateUntilNextBreakpoint() {
  if (state.isGenerating || state.isThinking) return;
  if (state.isPaused) {
    console.log('Generation paused by remote config');
    return;
  }
  if (state.currentSegmentIndex >= state.segments.length) {
    console.log('No more segments to display');
    return;
  }

  state.isGenerating = true;
  state.isThinking = false;
  updateButtonState();
  updatePageTitle();
  reportStatus();

  // ボタン押下時に最下部へスクロール＆自動スクロール有効化
  state.isAutoScroll = true;
  scrollToBottom();

  // 生成するセグメントと総文字数を計算
  const { segments: segmentsToGenerate, totalChars } = calculateSegmentsToGenerate();
  console.log(`Total chars: ${totalChars}`);

  // ゲージタイマー開始（1分で0→100%）
  startGaugeTimer();

  // ●キャレットを｜に変化
  transformCaretToBar();

  let charsDone = 0;
  let isFirstRule = true;  // 最初のルールかどうか

  for (const seg of segmentsToGenerate) {
    // 新しいルール番号なら要素を作成
    if (seg.isFirst) {
      // 最初のルールでなければ、ここで思考中状態に切り替え
      if (!isFirstRule) {
        onTextComplete();
      }
      isFirstRule = false;

      const { ruleElement, numberElement, jaElement, enElement } = createRuleElement(seg.num);
      state.currentRuleElement = ruleElement;
      state.currentNumberElement = numberElement;
      state.currentJaElement = jaElement;
      state.currentEnElement = enElement;
      // 新規ルールの場合はキャレットも新規作成
      removeCurrentCaret();
      // 新しいルール要素が見えるようにスクロール
      if (state.isAutoScroll) {
        scrollToBottom();
      }
      // 番号をタイプライター表示
      await typewriterNumber(seg.num);
    }

    // 日本語タイプライター（統合進捗）
    await typewriterJaWithProgress(seg.jaSegment, charsDone, totalChars, seg.isFirst);
    charsDone += seg.jaSegment.length;

    // ルールの最後なら英語をタイプライター表示
    if (seg.isLast && seg.enFull) {
      removeCurrentCaret();
      await typewriterEnWithProgress(seg.enFull, charsDone, totalChars);
      charsDone += seg.enFull.length;
      // じわっと黒にフェード
      makeCurrentRuleBlack();
      // アニメーション完了を待つ（英語→次の番号への間）
      await delay(state.pauseEnToNum * 100);
    }

    state.currentSegmentIndex++;
  }

  // 最後のセグメントが「、」で終わるなら●に変化
  const lastSeg = segmentsToGenerate[segmentsToGenerate.length - 1];
  if (lastSeg && lastSeg.jaSegment.endsWith('、')) {
    transformCaretToThinking();
  }

  // 文字出力完了を通知（ゲージがまだなら思考中状態へ）
  onTextComplete();

  if (state.isAutoScroll) {
    scrollToBottom();
  }
}

// 日本語タイプライター（統合進捗付き）
async function typewriterJaWithProgress(text, baseChars, totalChars, isNewRule = false) {
  // キャレットがなければ作成
  if (!state.currentCaret) {
    const caret = document.createElement('span');
    caret.className = 'caret generating';
    state.currentJaElement.appendChild(caret);
    state.currentCaret = caret;
  }

  // 番号 → 日本語の切り替え待機
  if (isNewRule) {
    await delay(getTypewriterDelay() * state.pauseNumToJa);
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // たまにタイポ（確率設定可能、句読点や括弧では発生しない）
    const isPunctuation = '。、．，「」『』（）()'.includes(char);
    if (!isPunctuation && Math.random() < state.typoChance) {
      // 間違った文字を入力
      const typoChar = getRandomTypoChar();
      const typoNode = document.createTextNode(typoChar);
      if (state.currentCaret && state.currentCaret.parentNode) {
        state.currentCaret.parentNode.insertBefore(typoNode, state.currentCaret);
      }
      if (state.isAutoScroll) scrollToBottom();
      await delay(getTypewriterDelay() * 0.8);

      // 一瞬止まる（気づく）
      await delay(getTypewriterDelay() * state.typoPause);

      // バックスペース（削除）
      if (typoNode.parentNode) {
        typoNode.remove();
      }
      if (state.isAutoScroll) scrollToBottom();
      await delay(getTypewriterDelay() * 0.5);
    }

    const textNode = document.createTextNode(char);

    // キャレットの前にテキストを挿入
    if (state.currentCaret && state.currentCaret.parentNode) {
      state.currentCaret.parentNode.insertBefore(textNode, state.currentCaret);
    } else {
      state.currentJaElement.appendChild(textNode);
    }

    // 統合進捗更新
    const progress = (baseChars + i + 1) / totalChars;
    updateProgressBar(progress);

    if (state.isAutoScroll) {
      scrollToBottom();
    }

    // 文字に応じた遅延
    await delay(getTypewriterDelay(char));
  }
}

// ランダムなタイポ文字を返す
function getRandomTypoChar() {
  const typoChars = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  return typoChars[Math.floor(Math.random() * typoChars.length)];
}

// 番号タイプライター（#nn）
async function typewriterNumber(num) {
  const text = `#${num}`;
  const caret = document.createElement('span');
  caret.className = 'caret generating';
  state.currentNumberElement.appendChild(caret);
  state.currentCaret = caret;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const textNode = document.createTextNode(char);
    caret.parentNode.insertBefore(textNode, caret);

    if (state.isAutoScroll) {
      scrollToBottom();
    }

    await delay(getTypewriterDelay());
  }

  // キャレットを削除（日本語タイプライターで新しく作る）
  caret.remove();
  state.currentCaret = null;
}

// 英語タイプライター（統合進捗付き）
async function typewriterEnWithProgress(text, baseChars, totalChars) {
  // 日本語 → 英語の切り替え待機
  await delay(getTypewriterDelay() * state.pauseJaToEn);

  const caret = document.createElement('span');
  caret.className = 'caret';
  state.currentEnElement.appendChild(caret);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const textNode = document.createTextNode(char);
    caret.parentNode.insertBefore(textNode, caret);

    // 統合進捗更新
    const progress = (baseChars + i + 1) / totalChars;
    updateProgressBar(progress);

    if (state.isAutoScroll) {
      scrollToBottom();
    }

    // 文字に応じた遅延（英語用）
    await delay(getTypewriterDelayEn(char));
  }

  // 英語タイプライター終了後、キャレットを削除
  caret.remove();
}

// タイプライター速度計算（日本語用）
// 自然なゆらぎのある速度（1分縛りなし）
function getTypewriterDelay(char = '') {
  // 速度1: 約200ms, 速度100: 約10ms
  const speed = state.typewriterSpeed;
  const base = 200 * Math.pow(0.05, (speed - 1) / 99);

  // 句読点で少し考える時間を追加
  if (char === '。' || char === '．') {
    return base * state.pauseKuten;
  }
  if (char === '、' || char === '，') {
    return base * state.pauseTouten;
  }
  if (char === '「' || char === '『' || char === '(' || char === '（') {
    return base * state.pauseOpenBracket;
  }
  if (char === '」' || char === '』' || char === ')' || char === '）') {
    return base * state.pauseCloseBracket;
  }

  // ランダム性を加える
  const randomFactor = 1 + (Math.random() - 0.5) * state.varianceJa * 2;
  return base * randomFactor;
}

// タイプライター速度計算（英語用）
// 日本語と同じ速度計算を使用
function getTypewriterDelayEn(char = '') {
  const speed = state.typewriterSpeed;
  const base = 200 * Math.pow(0.05, (speed - 1) / 99);

  // 英語の句読点
  if (char === '.') {
    return base * state.pausePeriod;
  }
  if (char === ',') {
    return base * state.pauseComma;
  }
  if (char === ' ') {
    return base * state.pauseSpace;
  }

  // ランダム性を加える
  const randomFactor = 1 + (Math.random() - 0.5) * state.varianceEn * 2;
  return base * randomFactor;
}

// ディレイユーティリティ
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// 進捗バー（時間基準：54秒で0→90%、残り10%で文字完了待ち）
// ========================================
let gaugeStartTime = null;
let gaugeAnimationFrame = null;
let textComplete = false;  // 文字出力が完了したか
let gaugePausedAt90 = false;  // 90%で一時停止中か

function startGaugeTimer() {
  gaugeStartTime = Date.now();
  textComplete = false;
  gaugePausedAt90 = false;
  animateGauge();
}

function animateGauge() {
  if (!gaugeStartTime) return;

  const elapsed = Date.now() - gaugeStartTime;
  const baseProgress = Math.min(elapsed / state.gaugeDuration, state.gaugePausePoint);

  // 呼吸のような波のゆらぎを追加
  const wave = Math.sin(elapsed * state.gaugeWaveFrequency * 0.001 * Math.PI * 2);
  const variance = wave * state.gaugeWaveAmplitude;
  const progress = Math.max(0, Math.min(baseProgress + variance, state.gaugePausePoint));

  elements.progressFill.style.width = `${progress * 100}%`;

  if (progress < state.gaugePausePoint) {
    // まだ停止ポイントに達していない
    gaugeAnimationFrame = requestAnimationFrame(animateGauge);
  } else {
    // 停止ポイントに達した
    if (textComplete) {
      // 文字も終わってる → 即座に100%へ
      finishGauge();
    } else {
      // 文字がまだ → 停止ポイントで一時停止（onTextCompleteで再開）
      gaugePausedAt90 = true;
    }
  }
}

function finishGauge() {
  // 90% → 100% へスムーズにアニメーション
  elements.progressFill.style.transition = 'width 0.5s ease-out';
  elements.progressFill.style.width = '100%';

  setTimeout(() => {
    elements.progressFill.style.transition = '';
    onGaugeComplete();
  }, 500);
}

function onGaugeComplete() {
  gaugeAnimationFrame = null;
  gaugeStartTime = null;
  gaugePausedAt90 = false;

  // 思考中状態を解除
  state.isThinking = false;
  state.isGenerating = false;
  updateButtonState();
  updatePageTitle();
  reportStatus();
}

function onTextComplete() {
  textComplete = true;

  if (gaugePausedAt90) {
    // ゲージが90%で待っていた → 100%へ
    finishGauge();
  } else {
    // ゲージがまだ90%未満 → 思考中状態へ
    state.isThinking = true;
    updateButtonState();
  }
}

function resetProgressBar() {
  if (gaugeAnimationFrame) {
    cancelAnimationFrame(gaugeAnimationFrame);
    gaugeAnimationFrame = null;
  }
  gaugeStartTime = null;
  textComplete = false;
  gaugePausedAt90 = false;
  elements.progressFill.style.transition = '';
  elements.progressFill.style.width = '0%';
}

// 旧APIとの互換性（呼び出し箇所では何もしない）
function updateProgressBar(progress) {
  // 文字進捗は無視（ゲージは時間基準）
}

// ========================================
// ボタン状態
// ========================================
function updateButtonState() {
  const button = elements.actionButton;
  const container = elements.actionButtonContainer;
  const buttonJa = button.querySelector('.button-ja');
  const buttonEn = button.querySelector('.button-en');

  if (state.isThinking) {
    // 思考中（文字出力完了、ゲージ待ち）
    button.classList.add('generating');
    container.classList.add('generating');
    container.classList.remove('idle');
    buttonJa.textContent = '次のルールを思考中...';
    buttonEn.textContent = 'Thinking...';
  } else if (state.isGenerating) {
    // 生成中（文字出力中）
    button.classList.add('generating');
    container.classList.add('generating');
    container.classList.remove('idle');
    buttonJa.textContent = 'ルール生成中...';
    buttonEn.textContent = 'Generating Rules...';
  } else {
    // 待機中
    button.classList.remove('generating');
    container.classList.remove('generating');
    container.classList.add('idle');
    buttonJa.textContent = '続きを生成';
    buttonEn.textContent = 'Continue Generating';
    resetProgressBar();
  }

  if (state.currentSegmentIndex >= state.segments.length) {
    button.disabled = true;
  }
}

// ========================================
// スクロール制御
// ========================================
function scrollToBottom() {
  elements.ruleList.scrollTo({
    top: elements.ruleList.scrollHeight,
    behavior: 'smooth',
  });
}

function checkScrollPosition() {
  const list = elements.ruleList;
  const isAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;

  state.isAutoScroll = isAtBottom;

  if (isAtBottom) {
    elements.scrollToBottom.classList.remove('visible');
  } else {
    elements.scrollToBottom.classList.add('visible');
  }
}

// ========================================
// イベントリスナー
// ========================================
function setupEventListeners() {
  // ボタンコンテナ全体をクリック可能に
  elements.actionButtonContainer.addEventListener('click', generateUntilNextBreakpoint);

  // 展示用：コンテキストメニュー無効化
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  elements.ruleList.addEventListener('scroll', checkScrollPosition);

  elements.scrollToBottom.addEventListener('click', () => {
    state.isAutoScroll = true;
    scrollToBottom();
    elements.scrollToBottom.classList.remove('visible');
  });

  // タイトル5回タップでデバッグモード有効化
  const gameTitle = document.querySelector('.game-title');
  if (gameTitle) {
    gameTitle.addEventListener('click', () => {
      titleTapCount++;

      // タイマーリセット（2秒以内に5回タップ）
      if (titleTapTimer) clearTimeout(titleTapTimer);
      titleTapTimer = setTimeout(() => {
        titleTapCount = 0;
      }, 2000);

      // 5回タップでデバッグモード有効化
      if (titleTapCount >= 5) {
        titleTapCount = 0;
        if (!isDebugMode) {
          isDebugMode = true;
          setupDebugPanel();
        }
      }
    });
  }
}

// ========================================
// 開発用：速度調整
// ========================================
window.setTypewriterSpeed = function(speed) {
  state.typewriterSpeed = Math.max(1, Math.min(100, speed));
  console.log(`Typewriter speed set to: ${state.typewriterSpeed}`);
};

window.getTypewriterSpeed = function() {
  return state.typewriterSpeed;
};

// デバッグ用
window.getState = function() {
  return state;
};

// ========================================
// リモート設定（Google Sheets）
// ========================================
async function loadRemoteConfig() {
  if (!CONFIG.configSheetId) return null;

  try {
    const data = await fetchSheetData(CONFIG.configSheetId);
    const config = {};
    data.table.rows.forEach(row => {
      if (row.c && row.c[0]?.v !== undefined && row.c[1]?.v !== undefined) {
        config[row.c[0].v] = row.c[1].v;
      }
    });
    return config;
  } catch (e) {
    console.error('Failed to load remote config:', e);
    return null;
  }
}

function startRemoteConfigPolling() {
  // 1分ごとにリモート設定を確認
  setInterval(async () => {
    const config = await loadRemoteConfig();
    if (!config) return;

    // 一時停止フラグの確認
    const isPaused = config.isPaused === true || config.isPaused === 'true' || config.isPaused === 'TRUE';
    if (isPaused && !state.isPaused) {
      console.log('Remote pause activated');
      state.isPaused = true;
      state.isGenerating = false;
      updatePageTitle();
      reportStatus();
    } else if (!isPaused && state.isPaused) {
      console.log('Remote pause deactivated');
      state.isPaused = false;
      updatePageTitle();
      reportStatus();
    }

    // 開始ルール番号の確認（次回リロード時に反映）
    if (config.startRule !== undefined) {
      const newStartRule = parseInt(config.startRule);
      if (!isNaN(newStartRule) && newStartRule !== CONFIG.startRule) {
        console.log(`Start rule updated: ${CONFIG.startRule} -> ${newStartRule}`);
        // URLパラメータがない場合のみリモート設定を使用
        if (!new URLSearchParams(window.location.search).has('startRule')) {
          CONFIG.startRule = newStartRule;
        }
      }
    }
  }, 60000); // 1分間隔
}

// ========================================
// デバッグパネル
// ========================================

// エクスポート可能な設定キー
const EXPORTABLE_KEYS = [
  'typewriterSpeed',
  'gaugeDuration',
  'gaugePausePoint',
  'gaugeWaveAmplitude',
  'gaugeWaveFrequency',
  'typoChance',
  'typoPause',
  'pauseNumToJa',
  'pauseJaToEn',
  'pauseEnToNum',
  'pauseKuten',
  'pauseTouten',
  'pauseOpenBracket',
  'pauseCloseBracket',
  'pausePeriod',
  'pauseComma',
  'pauseSpace',
  'varianceJa',
  'varianceEn',
];

// 設定をテキストにエクスポート
function exportSettings() {
  const settings = {};
  EXPORTABLE_KEYS.forEach(key => {
    settings[key] = state[key];
  });
  return JSON.stringify(settings, null, 2);
}

// テキストから設定をインポート
function importSettings(text) {
  try {
    const settings = JSON.parse(text);
    EXPORTABLE_KEYS.forEach(key => {
      if (settings[key] !== undefined) {
        state[key] = settings[key];
      }
    });
    // スライダーUIを更新
    refreshSliders();
    return true;
  } catch (e) {
    console.error('Import failed:', e);
    return false;
  }
}

// すべてのスライダーを現在のstate値で更新
function refreshSliders() {
  // setupSliderで登録した設定を再度反映
  const sliderConfigs = [
    { slider: 'speed-slider', value: 'speed-value', key: 'typewriterSpeed', scale: 1, toFixed: null },
    { slider: 'gauge-duration-slider', value: 'gauge-duration-value', key: 'gaugeDuration', scale: 1000, toFixed: null },
    { slider: 'gauge-pause-slider', value: 'gauge-pause-value', key: 'gaugePausePoint', scale: 0.01, toFixed: null },
    { slider: 'typo-chance-slider', value: 'typo-chance-value', key: 'typoChance', scale: 0.01, toFixed: null },
    { slider: 'typo-pause-slider', value: 'typo-pause-value', key: 'typoPause', scale: 1, toFixed: 1 },
    { slider: 'pause-num-ja-slider', value: 'pause-num-ja-value', key: 'pauseNumToJa', scale: 1, toFixed: 1 },
    { slider: 'pause-ja-en-slider', value: 'pause-ja-en-value', key: 'pauseJaToEn', scale: 1, toFixed: 1 },
    { slider: 'pause-en-num-slider', value: 'pause-en-num-value', key: 'pauseEnToNum', scale: 1, toFixed: null },
    { slider: 'pause-kuten-slider', value: 'pause-kuten-value', key: 'pauseKuten', scale: 1, toFixed: 1 },
    { slider: 'pause-touten-slider', value: 'pause-touten-value', key: 'pauseTouten', scale: 1, toFixed: 1 },
    { slider: 'pause-open-bracket-slider', value: 'pause-open-bracket-value', key: 'pauseOpenBracket', scale: 1, toFixed: 1 },
    { slider: 'pause-bracket-slider', value: 'pause-bracket-value', key: 'pauseCloseBracket', scale: 1, toFixed: 1 },
    { slider: 'pause-period-slider', value: 'pause-period-value', key: 'pausePeriod', scale: 1, toFixed: 1 },
    { slider: 'pause-comma-slider', value: 'pause-comma-value', key: 'pauseComma', scale: 1, toFixed: 1 },
    { slider: 'pause-space-slider', value: 'pause-space-value', key: 'pauseSpace', scale: 1, toFixed: 1 },
    { slider: 'variance-ja-slider', value: 'variance-ja-value', key: 'varianceJa', scale: 0.01, toFixed: null },
    { slider: 'variance-en-slider', value: 'variance-en-value', key: 'varianceEn', scale: 0.01, toFixed: null },
  ];

  sliderConfigs.forEach(({ slider, value, key, scale, toFixed }) => {
    const sliderEl = document.getElementById(slider);
    const valueEl = document.getElementById(value);
    if (sliderEl && valueEl) {
      const displayValue = state[key] / scale;
      sliderEl.value = displayValue;
      valueEl.textContent = toFixed !== null ? displayValue.toFixed(toFixed) : displayValue;
    }
  });
}

// スライダー設定ヘルパー
function setupSlider(sliderId, valueId, stateKey, options = {}) {
  const { scale = 1, suffix = '', toFixed = null } = options;
  const slider = document.getElementById(sliderId);
  const valueEl = document.getElementById(valueId);
  if (!slider || !valueEl) return;

  // 初期値を設定
  const currentValue = state[stateKey] / scale;
  slider.value = currentValue;
  valueEl.textContent = toFixed !== null ? currentValue.toFixed(toFixed) : currentValue;

  // 入力時に更新
  slider.addEventListener('input', (e) => {
    const rawValue = parseFloat(e.target.value);
    state[stateKey] = rawValue * scale;
    valueEl.textContent = toFixed !== null ? rawValue.toFixed(toFixed) : rawValue;
  });
}

function setupDebugPanel() {
  if (!isDebugMode) return;

  const panel = document.getElementById('debug-panel');
  const resetBtn = document.getElementById('debug-reset');
  const closeBtn = document.getElementById('debug-close');
  const cacheClearBtn = document.getElementById('debug-cache-clear');

  if (!panel) return;

  panel.hidden = false;

  // バージョン表示
  const versionEl = document.getElementById('debug-version');
  if (versionEl) versionEl.textContent = VERSION;

  // 基本設定
  setupSlider('speed-slider', 'speed-value', 'typewriterSpeed');

  // ゲージ設定
  setupSlider('gauge-duration-slider', 'gauge-duration-value', 'gaugeDuration', { scale: 1000 });
  setupSlider('gauge-pause-slider', 'gauge-pause-value', 'gaugePausePoint', { scale: 0.01 });
  setupSlider('gauge-wave-amp-slider', 'gauge-wave-amp-value', 'gaugeWaveAmplitude', { scale: 0.001, toFixed: 1 });
  setupSlider('gauge-wave-freq-slider', 'gauge-wave-freq-value', 'gaugeWaveFrequency', { scale: 0.1, toFixed: 1 });

  // タイポ設定
  setupSlider('typo-chance-slider', 'typo-chance-value', 'typoChance', { scale: 0.01 });
  setupSlider('typo-pause-slider', 'typo-pause-value', 'typoPause', { toFixed: 1 });

  // 切り替え停止
  setupSlider('pause-num-ja-slider', 'pause-num-ja-value', 'pauseNumToJa', { toFixed: 1 });
  setupSlider('pause-ja-en-slider', 'pause-ja-en-value', 'pauseJaToEn', { toFixed: 1 });
  setupSlider('pause-en-num-slider', 'pause-en-num-value', 'pauseEnToNum');

  // 句読点停止
  setupSlider('pause-kuten-slider', 'pause-kuten-value', 'pauseKuten', { toFixed: 1 });
  setupSlider('pause-touten-slider', 'pause-touten-value', 'pauseTouten', { toFixed: 1 });
  setupSlider('pause-open-bracket-slider', 'pause-open-bracket-value', 'pauseOpenBracket', { toFixed: 1 });
  setupSlider('pause-bracket-slider', 'pause-bracket-value', 'pauseCloseBracket', { toFixed: 1 });
  setupSlider('pause-period-slider', 'pause-period-value', 'pausePeriod', { toFixed: 1 });
  setupSlider('pause-comma-slider', 'pause-comma-value', 'pauseComma', { toFixed: 1 });
  setupSlider('pause-space-slider', 'pause-space-value', 'pauseSpace', { toFixed: 1 });

  // ランダム幅
  setupSlider('variance-ja-slider', 'variance-ja-value', 'varianceJa', { scale: 0.01 });
  setupSlider('variance-en-slider', 'variance-en-value', 'varianceEn', { scale: 0.01 });

  // リセットボタン（シンプルにリロード）
  resetBtn.addEventListener('click', () => {
    location.reload();
  });

  // 閉じるボタン（パネルを非表示にするだけ）
  closeBtn.addEventListener('click', () => {
    panel.hidden = true;
    isDebugMode = false;
  });

  // キャッシュクリア＆リロードボタン
  cacheClearBtn.addEventListener('click', async () => {
    // Service Worker のキャッシュをクリア
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map(name => caches.delete(name)));
    }
    // Service Worker を登録解除
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    }
    // 強制リロード
    location.reload(true);
  });

  // エクスポートボタン
  const exportBtn = document.getElementById('debug-export');
  const exportArea = document.getElementById('debug-export-area');
  if (exportBtn && exportArea) {
    exportBtn.addEventListener('click', () => {
      exportArea.value = exportSettings();
      exportArea.style.display = 'block';
      exportArea.select();
    });
  }

  // インポートボタン
  const importBtn = document.getElementById('debug-import');
  if (importBtn && exportArea) {
    importBtn.addEventListener('click', () => {
      if (exportArea.style.display === 'none') {
        exportArea.style.display = 'block';
        exportArea.value = '';
        exportArea.placeholder = 'Paste JSON here...';
        exportArea.focus();
      } else if (exportArea.value.trim()) {
        if (importSettings(exportArea.value)) {
          exportArea.style.display = 'none';
          exportArea.value = '';
        } else {
          alert('Invalid JSON format');
        }
      }
    });
  }

  // 定期的に状態表示を更新
  setInterval(() => {
    const segmentEl = document.getElementById('debug-segment');
    const totalEl = document.getElementById('debug-total');
    const statusEl = document.getElementById('debug-status');

    if (segmentEl) segmentEl.textContent = state.currentSegmentIndex;
    if (totalEl) totalEl.textContent = state.segments.length;
    if (statusEl) {
      if (state.isPaused) {
        statusEl.textContent = '停止中';
      } else if (state.isThinking) {
        statusEl.textContent = '思考中';
      } else if (state.isGenerating) {
        statusEl.textContent = '生成中';
      } else {
        statusEl.textContent = '待機中';
      }
    }
  }, 500);
}

// ========================================
// 初期化
// ========================================
async function init() {
  console.log('Initializing app...');

  setupEventListeners();

  // リモート設定を最初に読み込み（URLパラメータがない場合）
  if (!new URLSearchParams(window.location.search).has('startRule')) {
    const remoteConfig = await loadRemoteConfig();
    if (remoteConfig?.startRule !== undefined) {
      const startRule = parseInt(remoteConfig.startRule);
      if (!isNaN(startRule)) {
        CONFIG.startRule = startRule;
        console.log(`Start rule from remote config: ${startRule}`);
      }
    }
  }

  await Promise.all([
    loadGameInfo(),
    loadRules(),
  ]);

  // 初期ルールを表示
  displayInitialRules();

  // デバッグパネルをセットアップ
  setupDebugPanel();

  // リモート設定の定期確認を開始
  startRemoteConfigPolling();

  console.log('App initialized');
}

document.addEventListener('DOMContentLoaded', init);
