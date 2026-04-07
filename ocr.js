'use strict';

// ============================================================
// Phase 2: 数字認識
// Tesseract.js + 印刷数字向け前処理
// ============================================================

let _worker = null;

async function initTesseract() {
  if (_worker) return _worker;
  _worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
  await _worker.setParameters({
    tessedit_char_whitelist: '123456789',
    tessedit_pageseg_mode: '10',   // PSM_SINGLE_CHAR
    tessedit_ocr_engine_mode: '1', // LSTM only
  });
  console.log('Tesseract 準備完了');
  return _worker;
}

/**
 * セル画像配列から数字を認識して boardData に書き込む
 */
async function recognizeDigits(cells, emptyFlags, boardData) {
  const worker = await initTesseract();

  for (let i = 0; i < 81; i++) {
    if (emptyFlags[i]) { boardData[i] = 0; continue; }

    const processed = preprocessForOCR(cells[i]);
    const { data: { text, confidence } } = await worker.recognize(processed);
    const digit = parseInt(text.trim(), 10);
    const valid = digit >= 1 && digit <= 9;
    boardData[i] = (valid && confidence > 30) ? digit : 0;
  }

  for (let r = 0; r < 9; r++) {
    console.log(`行${r+1}: ${boardData.slice(r*9, r*9+9).join(' ')}`);
  }
}

/**
 * Tesseract 向け前処理
 * 印刷数字に最適化：大津二値化 → 反転 → 膨張 → 余白追加
 */
function preprocessForOCR(cellCanvas) {
  const SIZE = 64;
  const PAD  = 12;

  // 1. リサイズ
  const c1 = document.createElement('canvas');
  c1.width = c1.height = SIZE;
  c1.getContext('2d').drawImage(cellCanvas, 0, 0, SIZE, SIZE);

  // 2. グレースケール化
  const ctx1 = c1.getContext('2d');
  const img = ctx1.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const gray = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < d.length; i += 4) {
    gray[i/4] = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
  }

  // 3. 大津の二値化
  const threshold = otsuThreshold(gray);

  // 4. 二値化 + 反転（Tesseractは黒背景・白文字を期待）
  const c2 = document.createElement('canvas');
  c2.width = c2.height = SIZE;
  const ctx2 = c2.getContext('2d');
  const img2 = ctx2.createImageData(SIZE, SIZE);
  for (let i = 0; i < gray.length; i++) {
    // 印刷数字: 背景=白(高輝度)、文字=黒(低輝度) → 反転して文字=白
    const val = gray[i] < threshold ? 255 : 0;
    img2.data[i*4]   = val;
    img2.data[i*4+1] = val;
    img2.data[i*4+2] = val;
    img2.data[i*4+3] = 255;
  }
  ctx2.putImageData(img2, 0, 0);

  // 5. 余白追加（Tesseractの精度向上に効果的）
  const c3 = document.createElement('canvas');
  c3.width = c3.height = SIZE + PAD * 2;
  const ctx3 = c3.getContext('2d');
  ctx3.fillStyle = 'black';
  ctx3.fillRect(0, 0, c3.width, c3.height);
  ctx3.drawImage(c2, PAD, PAD);

  return c3;
}

/**
 * 大津の二値化しきい値を計算
 */
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, max = 0, thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) { max = between; thresh = t; }
  }
  return thresh;
}

/**
 * コントラスト強調（手動修正画面用、enhanceCellContrastとして公開）
 */
function enhanceCellContrast(cellCanvas) {
  return cellCanvas; // Tesseract版ではpreprocessForOCR内で処理するためスルー
}
