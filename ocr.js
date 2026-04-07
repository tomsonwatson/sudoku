'use strict';

// ============================================================
// Phase 2: 数字認識
// Tesseract.js を使ってセル画像から数字を読み取る
// ============================================================

let _tesseractWorker = null;

/**
 * Tesseract Worker を初期化（初回のみ）
 */
async function initTesseract() {
  if (_tesseractWorker) return _tesseractWorker;
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: () => {},
  });
  await worker.setParameters({
    tessedit_char_whitelist: '123456789',
    tessedit_pageseg_mode: '10', // PSM_SINGLE_CHAR
  });
  _tesseractWorker = worker;
  return worker;
}

/**
 * セル画像の配列から数字を認識して boardData に書き込む
 * @param {HTMLCanvasElement[]} cells 81個のセル画像
 * @param {boolean[]} emptyFlags 空セルフラグ
 * @param {number[]} boardData 結果書き込み先（0〜9）
 */
async function recognizeDigits(cells, emptyFlags, boardData) {
  const worker = await initTesseract();

  for (let i = 0; i < 81; i++) {
    if (emptyFlags[i]) {
      boardData[i] = 0;
      continue;
    }

    // セル画像を前処理してから認識
    const processedCanvas = preprocessCell(cells[i]);
    const { data: { text } } = await worker.recognize(processedCanvas);
    const digit = parseInt(text.trim(), 10);
    boardData[i] = (digit >= 1 && digit <= 9) ? digit : 0;
  }
}

/**
 * セル画像を OCR 向けに前処理する
 * - グレースケール化
 * - コントラスト強調
 * - 余白追加（Tesseract は余白があると精度が上がる）
 */
function preprocessCell(cellCanvas) {
  const PAD = 8;
  const out = document.createElement('canvas');
  out.width  = cellCanvas.width  + PAD * 2;
  out.height = cellCanvas.height + PAD * 2;
  const ctx = out.getContext('2d');

  // 白背景
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);

  // セル画像を中央に配置
  ctx.drawImage(cellCanvas, PAD, PAD);

  // グレースケール + コントラスト強調
  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    // コントラスト強調：128を境に白黒に寄せる
    const val = gray > 128 ? Math.min(255, gray * 1.2) : Math.max(0, gray * 0.8);
    data[i] = data[i+1] = data[i+2] = val;
  }
  ctx.putImageData(imgData, 0, 0);

  return out;
}
