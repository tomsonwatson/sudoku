'use strict';

// ============================================================
// Phase 1: 盤面検出
// OpenCV.js を使って撮影画像から数独グリッドを切り出す
// ============================================================

/**
 * OpenCV.js のロード待ち
 */
function waitForOpenCV() {
  return new Promise((resolve, reject) => {
    if (typeof cv !== 'undefined' && cv.Mat) { resolve(); return; }
    const timer = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
    setTimeout(() => { clearInterval(timer); reject(new Error('OpenCV の読み込みがタイムアウトしました')); }, 15000);
  });
}

/**
 * canvas から数独グリッドを検出して切り出し、
 * 正規化した 450x450 の canvas を返す
 * @param {HTMLCanvasElement} srcCanvas
 * @returns {HTMLCanvasElement} 正規化済みcanvas（失敗時は srcCanvas をそのまま返す）
 */
async function detectAndWarpGrid(srcCanvas) {
  await waitForOpenCV();

  const src = cv.imread(srcCanvas);
  let result = null;

  try {
    result = _detectGrid(src, srcCanvas);
  } catch (e) {
    console.warn('グリッド検出失敗:', e.message);
    result = null;
  } finally {
    src.delete();
  }

  return result;
}

function _detectGrid(src, srcCanvas) {
  const SIZE = 450;

  // 1. グレースケール + ブラー
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // 2. 適応的二値化（照明ムラに強い）
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(blurred, thresh, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

  // 3. 輪郭検出
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy,
    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // 4. 最大面積の四角形輪郭を探す
  let bestContour = null;
  let bestArea = 0;
  const minArea = srcCanvas.width * srcCanvas.height * 0.1; // 画像面積の10%以上

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);
    if (area < minArea) { contour.delete(); continue; }

    const peri = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, 0.02 * peri, true);

    if (approx.rows === 4 && area > bestArea) {
      bestArea = area;
      if (bestContour) bestContour.delete();
      bestContour = approx;
    } else {
      approx.delete();
    }
    contour.delete();
  }

  // クリーンアップ
  contours.delete();
  hierarchy.delete();
  gray.delete();
  blurred.delete();
  thresh.delete();

  if (!bestContour) {
    throw new Error('数独グリッドの四角形が見つかりませんでした');
  }

  // 5. 4頂点を順序付け（左上・右上・右下・左下）
  const corners = orderPoints(bestContour);
  bestContour.delete();

  // 6. 透視変換で正面視に補正
  const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    SIZE, 0,
    SIZE, SIZE,
    0, SIZE,
  ]);
  const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());

  const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
  const warped = new cv.Mat();
  const dsize = new cv.Size(SIZE, SIZE);
  cv.warpPerspective(src, warped, M, dsize);

  // 7. 結果を canvas に描画
  const outCanvas = document.createElement('canvas');
  outCanvas.width = SIZE;
  outCanvas.height = SIZE;
  cv.imshow(outCanvas, warped);

  // クリーンアップ
  dstPoints.delete();
  srcPoints.delete();
  M.delete();
  warped.delete();

  return outCanvas;
}

/**
 * 4頂点を [左上, 右上, 右下, 左下] の順に並べる
 */
function orderPoints(mat) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    pts.push([mat.data32F[i * 2], mat.data32F[i * 2 + 1]]);
  }

  // x+y が最小 → 左上、最大 → 右下
  pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const tl = pts[0];
  const br = pts[3];

  // 残り2点: x-y が小さい → 右上、大きい → 左下
  const mid = [pts[1], pts[2]].sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
  const tr = mid[0];
  const bl = mid[1];

  return [tl, tr, br, bl];
}

/**
 * 正規化済みグリッド canvas を 81 個のセル canvas に分割する
 * @param {HTMLCanvasElement} gridCanvas 450x450
 * @returns {HTMLCanvasElement[]} 81個のセル画像（行順）
 */
function splitGridIntoCells(gridCanvas) {
  const SIZE = gridCanvas.width;
  const cellSize = SIZE / 9;
  const cells = [];
  const ctx = gridCanvas.getContext('2d');

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const cellCanvas = document.createElement('canvas');
      const pad = Math.floor(cellSize * 0.1); // 10%パディング（枠線除去）
      cellCanvas.width  = cellSize - pad * 2;
      cellCanvas.height = cellSize - pad * 2;
      const cellCtx = cellCanvas.getContext('2d');
      cellCtx.drawImage(
        gridCanvas,
        col * cellSize + pad,
        row * cellSize + pad,
        cellSize - pad * 2,
        cellSize - pad * 2,
        0, 0,
        cellCanvas.width,
        cellCanvas.height
      );
      cells.push(cellCanvas);
    }
  }
  return cells;
}

/**
 * セル画像が空白かどうかを判定する（簡易版：輝度の分散で判断）
 * @param {HTMLCanvasElement} cellCanvas
 * @returns {boolean}
 */
function isCellEmpty(cellCanvas) {
  const ctx = cellCanvas.getContext('2d');
  const data = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height).data;
  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
    if (brightness < 128) darkPixels++;
  }
  const ratio = darkPixels / (data.length / 4);
  return ratio < 0.05; // 暗いピクセルが5%未満なら空
}

/**
 * デバッグ用：検出したグリッドの輪郭を元画像に描画する
 */
function drawDetectionDebug(srcCanvas, detectedCanvas) {
  const ctx = srcCanvas.getContext('2d');
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, srcCanvas.width, srcCanvas.height);
}
