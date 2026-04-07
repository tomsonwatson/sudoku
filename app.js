'use strict';

// ============================================================
// State
// ============================================================
const state = {
  board: Array(81).fill(0),   // 0 = 空, 1-9 = 確定
  given: Array(81).fill(false), // 問題の初期数字か
  notes: Array(81).fill(null).map(() => new Set()), // 候補メモ
  selected: -1,
  stream: null,
};

// ============================================================
// DOM refs
// ============================================================
const $ = id => document.getElementById(id);
const video        = $('video');
const captureBtn   = $('capture-btn');
const previewCanvas = $('preview-canvas');
const retakeBtn    = $('retake-btn');
const analyzeBtn   = $('analyze-btn');
const gridEl       = $('sudoku-grid');
const hintText     = $('hint-text');
const nextHintBtn  = $('next-hint-btn');
const clearBtn     = $('clear-board-btn');
const statusBar    = $('status-bar');
const loadingOverlay = $('loading-overlay');
const loadingMsg   = $('loading-msg');
const fileInput    = $('file-input');
const numpad       = $('numpad');
const hintPanel    = $('hint-panel');
const modeDoneBtn  = $('mode-done-btn');
const manualGridEl = $('manual-grid');
const manualDoneBtn = $('manual-done-btn');

// 現在のモード: 'edit' | 'hint'
let currentMode = 'edit';

// 手入力盤面の状態
const manualBoard = Array(81).fill(0);
let manualSelected = -1;

// ============================================================
// モード切替（修正 / ヒント）
// ============================================================
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

modeDoneBtn.addEventListener('click', () => setMode('hint'));

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  if (mode === 'edit') {
    numpad.classList.remove('hidden');
    hintPanel.classList.add('hidden');
    // 全セルをタップ可能に
    document.querySelectorAll('.sudoku-cell').forEach(c => c.classList.add('editable'));
  } else {
    numpad.classList.add('hidden');
    hintPanel.classList.remove('hidden');
    document.querySelectorAll('.sudoku-cell').forEach(c => {
      c.classList.remove('editable', 'selected');
    });
    state.selected = -1;
    // ヒントモードに入ったら候補を再計算
    computeAllNotes();
    showNextHint();
  }
}

// 数字キーパッド（touchstart で即反応、clickも併用）
function onNumpadPress(btn) {
  if (state.selected < 0) return;
  const n = parseInt(btn.dataset.n, 10);
  const i = state.selected;

  state.board[i] = n;
  if (n === 0) {
    state.given[i] = false;
    gridEl.children[i].classList.remove('given', 'user-input');
  } else {
    state.given[i] = true;
    gridEl.children[i].classList.remove('user-input');
    gridEl.children[i].classList.add('given');
  }
  state.notes[i] = new Set();
  refreshCell(i);
  updateStatus();

  // 視覚フィードバック
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 150);
}

document.querySelectorAll('.numpad-btn[data-n]').forEach(btn => {
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault(); // iOSのダブルタップズームを防止
    onNumpadPress(btn);
  }, { passive: false });
  btn.addEventListener('click', () => onNumpadPress(btn));
});

// ============================================================
// タブ切り替え
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target + '-screen').classList.add('active');
    if (target === 'camera') startCamera();
    else stopCamera();
    if (target === 'manual') renderManualGrid();
  });
});

// ============================================================
// 手入力モード
// ============================================================
function renderManualGrid() {
  manualGridEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'sudoku-cell editable';
    cell.dataset.idx = i;
    if (manualBoard[i] !== 0) {
      cell.textContent = manualBoard[i];
      cell.classList.add('given');
    }
    if (manualSelected === i) cell.classList.add('selected');
    const handler = () => {
      manualSelected = i;
      document.querySelectorAll('#manual-grid .sudoku-cell').forEach(c => c.classList.remove('selected'));
      cell.classList.add('selected');
    };
    cell.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
    cell.addEventListener('click', handler);
    manualGridEl.appendChild(cell);
  }
}

document.querySelectorAll('.manual-num').forEach(btn => {
  const handler = () => {
    if (manualSelected < 0) return;
    const n = parseInt(btn.dataset.n, 10);
    manualBoard[manualSelected] = n;
    const cell = manualGridEl.children[manualSelected];
    cell.textContent = n === 0 ? '' : n;
    cell.classList.toggle('given', n !== 0);
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 150);
  };
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, { passive: false });
  btn.addEventListener('click', handler);
});

manualDoneBtn.addEventListener('touchstart', (e) => { e.preventDefault(); applyManualBoard(); }, { passive: false });
manualDoneBtn.addEventListener('click', applyManualBoard);

function applyManualBoard() {
  state.board = [...manualBoard];
  state.given = manualBoard.map(v => v !== 0);
  state.notes = Array(81).fill(null).map(() => new Set());
  // 盤面タブへ移動
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'board'));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'board-screen'));
  stopCamera();
  renderBoard();
  setMode('hint');
  updateStatus();
}

// ============================================================
// カメラ
// ============================================================
async function startCamera() {
  if (state.stream) return;
  // 制約を段階的に緩めて試みる（PWA環境でも動作するよう）
  const constraints = [
    { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } } },
    { video: { facingMode: 'environment' } },
    { video: true },
  ];
  for (const c of constraints) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ ...c, audio: false });
      video.srcObject = state.stream;
      await video.play();
      return;
    } catch (err) {
      console.warn('カメラ制約失敗、次の制約を試行:', err.message);
    }
  }
  showNoCameraMessage(new Error('カメラへのアクセスが許可されていないか、利用できません'));
}

function stopCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach(t => t.stop());
  state.stream = null;
  video.srcObject = null;
}

function showNoCameraMessage(err) {
  video.replaceWith(Object.assign(document.createElement('div'), {
    className: 'no-camera',
    innerHTML: `<p>カメラを起動できませんでした。<br><small>${err.message}</small></p>
                <p>カメラのアクセス許可を確認してください。</p>`
  }));
}

// ファイルから読み込む
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const ox = (img.width  - size) / 2;
      const oy = (img.height - size) / 2;
      previewCanvas.width  = size;
      previewCanvas.height = size;
      const ctx = previewCanvas.getContext('2d');
      ctx.drawImage(img, ox, oy, size, size, 0, 0, size, size);
      switchToScreen('preview');
      stopCamera();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

// 撮影
captureBtn.addEventListener('click', () => {
  const canvas = previewCanvas;
  const size = Math.min(video.videoWidth, video.videoHeight);
  const ox = (video.videoWidth - size) / 2;
  const oy = (video.videoHeight - size) / 2;
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, ox, oy, size, size, 0, 0, size, size);

  // プレビュー画面へ
  switchToScreen('preview');
  stopCamera();
});

// ============================================================
// プレビュー
// ============================================================
retakeBtn.addEventListener('click', () => {
  switchToScreen('camera');
  startCamera();
});

analyzeBtn.addEventListener('click', async () => {
  showLoading('盤面を解析中...');
  await sleep(50); // UIを更新させる
  try {
    await analyzeImage(previewCanvas);
    switchToScreen('board');
    renderBoard();
    // OCR直後は編集モードで開く（修正しやすいように）
    setMode('edit');
  } catch (e) {
    hideLoading();
    alert('解析に失敗しました。盤面が枠内に収まっているか確認してください。\n' + e.message);
  }
  hideLoading();
});

// ============================================================
// 画像解析（グリッド検出 + OCR）
// ※ Phase 1 & 2 の実装。現段階はサンプル入力で動作確認。
// ============================================================
async function analyzeImage(canvas) {
  // Phase1: OpenCV.js でグリッド検出
  showLoading('OpenCV 読み込み中... (初回は少し時間がかかります)');
  let gridCanvas;
  try {
    gridCanvas = await detectAndWarpGrid(canvas);
  } catch (e) {
    console.warn('グリッド検出例外:', e.message);
  }

  if (!gridCanvas) {
    console.warn('グリッド検出失敗 → 手入力モードへ');
    // 検出失敗 → 空盤面で編集モードへ（サンプルは出さない）
    state.board = Array(81).fill(0);
    state.given = Array(81).fill(false);
    state.notes = Array(81).fill(null).map(() => new Set());
    return;
  }

  // 検出結果をプレビューに反映
  const ctx = canvas.getContext('2d');
  canvas.width  = gridCanvas.width;
  canvas.height = gridCanvas.height;
  ctx.drawImage(gridCanvas, 0, 0);

  // Phase2: セル分割 + 数字認識
  showLoading('数字を認識中...');
  const rawCells = splitGridIntoCells(gridCanvas);

  // 空セル判定はRAWセルの中央部分で行う
  const boardData = Array(81).fill(0);
  const emptyFlags = rawCells.map(c => isCellEmpty(c));
  console.log('空セル数:', emptyFlags.filter(Boolean).length);

  const cells = rawCells;

  // Tesseract.js で数字認識
  try {
    await recognizeDigits(cells, emptyFlags, boardData);
  } catch (e) {
    console.warn('OCR失敗:', e.message);
    // 失敗してもグリッド検出結果は使う（全0の空盤面として編集モードへ）
  }

  state.board = boardData;
  state.given = boardData.map(v => v !== 0);
  state.notes = Array(81).fill(null).map(() => new Set());
}

function loadSampleBoard() {
  // 実際の有名な数独問題（難易度：中級）
  const sample = [
    5,3,0, 0,7,0, 0,0,0,
    6,0,0, 1,9,5, 0,0,0,
    0,9,8, 0,0,0, 0,6,0,

    8,0,0, 0,6,0, 0,0,3,
    4,0,0, 8,0,3, 0,0,1,
    7,0,0, 0,2,0, 0,0,6,

    0,6,0, 0,0,0, 2,8,0,
    0,0,0, 4,1,9, 0,0,5,
    0,0,0, 0,8,0, 0,7,9,
  ];
  state.board = [...sample];
  state.given = sample.map(v => v !== 0);
  state.notes = Array(81).fill(null).map(() => new Set());
}

// ============================================================
// 数独グリッド描画
// ============================================================
function renderBoard() {
  gridEl.innerHTML = '';
  for (let i = 0; i < 81; i++) {
    const cell = document.createElement('div');
    cell.className = 'sudoku-cell';
    cell.dataset.idx = i;
    if (state.given[i]) cell.classList.add('given');
    if (currentMode === 'edit') cell.classList.add('editable');
    updateCellDisplay(cell, i);
    cell.addEventListener('touchstart', (e) => {
      e.preventDefault();
      selectCell(i);
    }, { passive: false });
    cell.addEventListener('click', () => selectCell(i));
    gridEl.appendChild(cell);
  }
}

function updateCellDisplay(cellEl, i) {
  cellEl.innerHTML = '';
  if (state.board[i] !== 0) {
    cellEl.textContent = state.board[i];
  } else if (state.notes[i].size > 0) {
    const grid = document.createElement('div');
    grid.className = 'cell-notes';
    for (let n = 1; n <= 9; n++) {
      const note = document.createElement('span');
      note.className = 'cell-note';
      note.textContent = state.notes[i].has(n) ? n : '';
      grid.appendChild(note);
    }
    cellEl.appendChild(grid);
  }
}

function refreshCell(i) {
  const cell = gridEl.children[i];
  if (!cell) return;
  updateCellDisplay(cell, i);
}

function selectCell(i) {
  if (currentMode !== 'edit') return;
  document.querySelectorAll('.sudoku-cell').forEach(c => c.classList.remove('selected'));
  state.selected = i;
  gridEl.children[i].classList.add('selected');
}

function highlightHintCells(indices, className = 'hint') {
  document.querySelectorAll('.sudoku-cell').forEach(c => c.classList.remove('hint'));
  indices.forEach(i => gridEl.children[i]?.classList.add(className));
}

// ============================================================
// 候補計算
// ============================================================
function getPeers(i) {
  const row = Math.floor(i / 9);
  const col = i % 9;
  const boxR = Math.floor(row / 3) * 3;
  const boxC = Math.floor(col / 3) * 3;
  const peers = new Set();
  for (let j = 0; j < 9; j++) {
    peers.add(row * 9 + j);
    peers.add(j * 9 + col);
    peers.add((boxR + Math.floor(j / 3)) * 9 + (boxC + j % 3));
  }
  peers.delete(i);
  return peers;
}

function getCandidates(i) {
  if (state.board[i] !== 0) return new Set();
  const used = new Set();
  for (const p of getPeers(i)) {
    if (state.board[p] !== 0) used.add(state.board[p]);
  }
  const cands = new Set();
  for (let n = 1; n <= 9; n++) {
    if (!used.has(n)) cands.add(n);
  }
  return cands;
}

function computeAllNotes() {
  for (let i = 0; i < 81; i++) {
    state.notes[i] = getCandidates(i);
  }
  for (let i = 0; i < 81; i++) refreshCell(i);
}

// ============================================================
// ヒントエンジン
// ============================================================
const hintHistory = [];

function showNextHint() {
  const hint = findHint();
  if (!hint) {
    hintText.textContent = '次のヒントが見つかりません。盤面を確認してください。';
    highlightHintCells([]);
    return;
  }
  hintText.textContent = hint.message;
  highlightHintCells(hint.cells);
  hintHistory.push(hint);
  updateStatus();
}

function findHint() {
  return findNakedSingle()
    || findHiddenSingle()
    || findNakedPair()
    || findPointingPair()
    || { message: 'より高度な手法が必要です。候補メモを確認してください。', cells: [] };
}

// ── ネイキッドシングル ──────────────────────────
function findNakedSingle() {
  for (let i = 0; i < 81; i++) {
    if (state.board[i] !== 0) continue;
    const cands = state.notes[i];
    if (cands.size === 1) {
      const n = [...cands][0];
      return {
        type: 'naked-single',
        cells: [i],
        value: n,
        message: `【ネイキッドシングル】${cellName(i)} に入る数字は ${n} だけです。`,
        apply() {
          state.board[i] = n;
          state.notes[i] = new Set();
          for (const p of getPeers(i)) {
            state.notes[p].delete(n);
            refreshCell(p);
          }
          refreshCell(i);
        }
      };
    }
  }
  return null;
}

// ── ヒドゥンシングル ──────────────────────────
function findHiddenSingle() {
  const houses = getHouses();
  for (const house of houses) {
    for (let n = 1; n <= 9; n++) {
      const targets = house.filter(i => state.board[i] === 0 && state.notes[i].has(n));
      if (targets.length === 1) {
        const i = targets[0];
        return {
          type: 'hidden-single',
          cells: [i],
          value: n,
          message: `【ヒドゥンシングル】${houseName(house)} の中で ${n} が入れるのは ${cellName(i)} だけです。`,
          apply() {
            state.board[i] = n;
            state.notes[i] = new Set();
            for (const p of getPeers(i)) {
              state.notes[p].delete(n);
              refreshCell(p);
            }
            refreshCell(i);
          }
        };
      }
    }
  }
  return null;
}

// ── ネイキッドペア ──────────────────────────
function findNakedPair() {
  const houses = getHouses();
  for (const house of houses) {
    const empties = house.filter(i => state.board[i] === 0);
    for (let a = 0; a < empties.length; a++) {
      for (let b = a + 1; b < empties.length; b++) {
        const ca = state.notes[empties[a]];
        const cb = state.notes[empties[b]];
        if (ca.size === 2 && cb.size === 2 && setsEqual(ca, cb)) {
          const pair = [...ca];
          const affected = empties.filter((_, k) => k !== a && k !== b)
            .filter(i => state.notes[i].has(pair[0]) || state.notes[i].has(pair[1]));
          if (affected.length > 0) {
            return {
              type: 'naked-pair',
              cells: [empties[a], empties[b], ...affected],
              message: `【ネイキッドペア】${cellName(empties[a])} と ${cellName(empties[b])} は {${pair.join(',')}} のペアです。同じハウスの他のセルから ${pair.join(',')} を候補から除外できます。`,
              apply() {
                for (const i of affected) {
                  pair.forEach(n => state.notes[i].delete(n));
                  refreshCell(i);
                }
              }
            };
          }
        }
      }
    }
  }
  return null;
}

// ── ポインティングペア ──────────────────────────
function findPointingPair() {
  for (let box = 0; box < 9; box++) {
    const boxCells = getBox(box);
    for (let n = 1; n <= 9; n++) {
      const targets = boxCells.filter(i => state.board[i] === 0 && state.notes[i].has(n));
      if (targets.length < 2 || targets.length > 3) continue;

      // 同一行か？
      const rows = [...new Set(targets.map(i => Math.floor(i / 9)))];
      if (rows.length === 1) {
        const rowCells = getRow(rows[0]).filter(i => !boxCells.includes(i));
        const affected = rowCells.filter(i => state.board[i] === 0 && state.notes[i].has(n));
        if (affected.length > 0) {
          return {
            type: 'pointing-pair',
            cells: [...targets, ...affected],
            message: `【ポインティングペア】ボックス内で ${n} の候補が同じ行に並んでいます。その行の他セルから ${n} を除外できます。`,
            apply() {
              affected.forEach(i => { state.notes[i].delete(n); refreshCell(i); });
            }
          };
        }
      }

      // 同一列か？
      const cols = [...new Set(targets.map(i => i % 9))];
      if (cols.length === 1) {
        const colCells = getCol(cols[0]).filter(i => !boxCells.includes(i));
        const affected = colCells.filter(i => state.board[i] === 0 && state.notes[i].has(n));
        if (affected.length > 0) {
          return {
            type: 'pointing-pair',
            cells: [...targets, ...affected],
            message: `【ポインティングペア】ボックス内で ${n} の候補が同じ列に並んでいます。その列の他セルから ${n} を除外できます。`,
            apply() {
              affected.forEach(i => { state.notes[i].delete(n); refreshCell(i); });
            }
          };
        }
      }
    }
  }
  return null;
}

// ============================================================
// ヒント適用ボタン
// ============================================================
nextHintBtn.addEventListener('click', () => {
  const hint = findHint();
  if (!hint) return;
  if (hint.apply) hint.apply();
  showNextHint();
});

// ============================================================
// ボード初期化
// ============================================================
clearBtn.addEventListener('click', () => {
  if (!confirm('盤面をリセットしますか？')) return;
  state.board = Array(81).fill(0);
  state.given = Array(81).fill(false);
  state.notes = Array(81).fill(null).map(() => new Set());
  renderBoard();
  hintText.textContent = '盤面をリセットしました。カメラで撮影するか、手入力してください。';
  highlightHintCells([]);
  updateStatus();
});

// ============================================================
// ハウスユーティリティ
// ============================================================
function getRow(r)  { return Array.from({length:9}, (_, i) => r*9 + i); }
function getCol(c)  { return Array.from({length:9}, (_, i) => i*9 + c); }
function getBox(b)  {
  const r = Math.floor(b/3)*3, c = (b%3)*3;
  return Array.from({length:9}, (_, i) => (r + Math.floor(i/3))*9 + (c + i%3));
}
function getHouses() {
  const h = [];
  for (let i = 0; i < 9; i++) { h.push(getRow(i)); h.push(getCol(i)); h.push(getBox(i)); }
  return h;
}

function houseName(house) {
  const r0 = Math.floor(house[0]/9), c0 = house[0]%9;
  const r8 = Math.floor(house[8]/9), c8 = house[8]%9;
  if (r0 === r8) return `${r0+1}行目`;
  if (c0 === c8) return `${c0+1}列目`;
  return `ボックス(${Math.floor(r0/3)+1},${Math.floor(c0/3)+1})`;
}

function cellName(i) {
  return `${Math.floor(i/9)+1}行${i%9+1}列`;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

// ============================================================
// UI ユーティリティ
// ============================================================
function switchToScreen(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === name + '-screen'));
}

function showLoading(msg) {
  loadingMsg.textContent = msg;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function updateStatus() {
  const filled = state.board.filter(v => v !== 0).length;
  statusBar.textContent = `${filled} / 81 マス確定`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// デバッグログを画面に表示
const _debugEl = $('debug-log');
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
function _appendLog(prefix, args) {
  _origLog(prefix, ...args);
  if (!_debugEl) return;
  const line = prefix + ' ' + args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  _debugEl.textContent += '\n' + line;
  _debugEl.scrollTop = _debugEl.scrollHeight;
}
console.log  = (...a) => _appendLog('[LOG]',  a);
console.warn = (...a) => _appendLog('[WARN]', a);

// ============================================================
// Service Worker 登録
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

// ============================================================
// 起動
// ============================================================
startCamera();
updateStatus();
