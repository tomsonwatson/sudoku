'use strict';

// ============================================================
// Phase 1: 盤面検出
// OpenCV.js を使って撮影画像から数独グリッドを切り出す
// ============================================================

let _cvReady = false;

// OpenCV.js の onRuntimeInitialized コールバック
function onOpenCvReady() {
  _cvReady = true;
  console.log('OpenCV.js 準備完了');
}

function waitForOpenCV() {
  return new Promise((resolve, reject) => {
    if (_cvReady && typeof cv !== 'undefined') { resolve(); return; }
    const timer = setInterval(() => {
      if (_cvReady && typeof cv !== 'undefined') {
        clearInterval(timer);
        resolve();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error('OpenCV の読み込みがタイムアウトしました（15秒）'));
    }, 15000);
  });
}

/**
 * canvas から数独グリッドを検出して切り出し、
 * 正規化した 450x450 の canvas を返す。失敗時は null。
 */
async function detectAndWarpGrid(srcCanvas) {
  try {
    await waitForOpenCV();
  } catch (e) {
    console.warn(e.message);
    return null;
  }

  const src = cv.imread(srcCanvas);
  let result = null;
  try {
    result = _detectGrid(src, srcCanvas);
  } catch (e) {
    console.warn('グリッド検出失敗:', e.message);
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
  cv.GaussianBlur(gray, blurred, new cv.Size(9, 9), 0);

  // 2. 適応的二値化
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(blurred, thresh, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

  // 3. モルフォロジー処理（ノイズ除去・線を繋げる）
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  const cleaned = new cv.Mat();
  cv.dilate(thresh, cleaned, kernel);
  kernel.delete();

  // 4. 輪郭検出
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(cleaned, contours, hierarchy,
    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // デバッグ: 輪郭数をログ
  console.log('検出輪郭数:', contours.size());

  // 5. 最大面積の四角形輪郭を探す
  let bestContour = null;
  let bestArea = 0;
  const minArea = srcCanvas.width * srcCanvas.height * 0.05; // 5%以上（緩和）

  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area = cv.contourArea(contour);

    if (area < minArea) { contour.delete(); continue; }

    const peri = cv.arcLength(contour, true);
    const approx = new cv.Mat();
    // epsilon を少し大きめにして4点に収まりやすくする
    cv.approxPolyDP(contour, approx, 0.02 * peri, true);

    console.log(`輪郭 ${i}: 面積=${Math.round(area)}, 頂点数=${approx.rows}`);

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
  cleaned.delete();

  if (!bestContour) {
    throw new Error('4頂点の四角形が見つかりませんでした');
  }

  // 6. 4頂点を順序付け（左上・右上・右下・左下）
  // approxPolyDP は CV_32S（int32）で返す
  const corners = orderPoints32S(bestContour);
  bestContour.delete();

  console.log('検出コーナー:', corners);

  // 7. 透視変換
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,  SIZE, 0,  SIZE, SIZE,  0, SIZE,
  ]);
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());

  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(src, warped, M, new cv.Size(SIZE, SIZE));

  // 結果を canvas に描画
  const outCanvas = document.createElement('canvas');
  outCanvas.width  = SIZE;
  outCanvas.height = SIZE;
  cv.imshow(outCanvas, warped);

  dstPts.delete(); srcPts.delete(); M.delete(); warped.delete();

  return outCanvas;
}

/**
 * approxPolyDP の結果（CV_32S）から4頂点を読み取り
 * [左上, 右上, 右下, 左下] の順に返す
 */
function orderPoints32S(mat) {
  const pts = [];
  for (let i = 0; i < 4; i++) {
    // CV_32S: data32S を使う（data32F ではない）
    pts.push([mat.data32S[i * 2], mat.data32S[i * 2 + 1]]);
  }

  // x+y 最小 → 左上、最大 → 右下
  pts.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  const tl = pts[0];
  const br = pts[3];

  // 残り2点: x-y 小 → 右上、大 → 左下
  const mid = [pts[1], pts[2]].sort((a, b) => (a[0] - a[1]) - (b[0] - b[1]));
  const tr = mid[0];
  const bl = mid[1];

  return [tl, tr, br, bl];
}

/**
 * 正規化済みグリッド canvas を 81 個のセル canvas に分割する
 */
function splitGridIntoCells(gridCanvas) {
  const SIZE = gridCanvas.width;
  const cellSize = SIZE / 9;
  const cells = [];

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 9; col++) {
      const pad = Math.floor(cellSize * 0.12);
      const cellCanvas = document.createElement('canvas');
      cellCanvas.width  = cellSize - pad * 2;
      cellCanvas.height = cellSize - pad * 2;
      const ctx = cellCanvas.getContext('2d');
      ctx.drawImage(
        gridCanvas,
        col * cellSize + pad, row * cellSize + pad,
        cellSize - pad * 2,  cellSize - pad * 2,
        0, 0, cellCanvas.width, cellCanvas.height
      );
      cells.push(cellCanvas);
    }
  }
  return cells;
}

/**
 * セルが空かどうかを判定（暗いピクセル比率で判断）
 */
function isCellEmpty(cellCanvas) {
  const ctx = cellCanvas.getContext('2d');
  const data = ctx.getImageData(0, 0, cellCanvas.width, cellCanvas.height).data;
  let darkPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
    if (brightness < 100) darkPixels++;
  }
  const ratio = darkPixels / (data.length / 4);
  return ratio < 0.04;
}
