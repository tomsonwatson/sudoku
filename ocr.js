'use strict';

// ============================================================
// Phase 2: 数字認識
// TensorFlow.js + MNIST ベース CNN で手書き数字を認識
// ============================================================

let _model = null;

/**
 * モデルをロード（初回のみ）
 * MNISTで学習済みの軽量CNNをTensorFlow.js形式で使用
 */
async function loadDigitModel() {
  if (_model) return _model;
  // TensorFlow.js の公式 MNIST サンプルモデルを使用
  _model = await tf.loadLayersModel(
    'https://storage.googleapis.com/tfjs-models/tfjs/mnist_transfer_cnn_v1/model.json'
  );
  console.log('MNISTモデル読み込み完了');
  return _model;
}

/**
 * セル画像の配列から数字を認識して boardData に書き込む
 * @param {HTMLCanvasElement[]} cells 81個のセル画像
 * @param {boolean[]} emptyFlags 空セルフラグ
 * @param {number[]} boardData 結果書き込み先（0〜9）
 */
async function recognizeDigits(cells, emptyFlags, boardData) {
  const model = await loadDigitModel();

  for (let i = 0; i < 81; i++) {
    if (emptyFlags[i]) {
      boardData[i] = 0;
      continue;
    }

    const digit = await predictDigit(model, cells[i]);
    boardData[i] = digit;
    if (i % 9 === 8) console.log(`OCR行${Math.floor(i/9)+1}: ${boardData.slice(i-8, i+1).join(' ')}`);
  }
}

/**
 * 単一セル画像から数字を予測する
 * @param {tf.LayersModel} model
 * @param {HTMLCanvasElement} cellCanvas
 * @returns {number} 1〜9、判定不能なら 0
 */
async function predictDigit(model, cellCanvas) {
  return tf.tidy(() => {
    // 1. 28x28 グレースケールに変換
    const tensor = tf.browser.fromPixels(cellCanvas, 1)
      .resizeBilinear([28, 28])
      .toFloat();

    // 2. MNIST形式に正規化（背景黒・数字白）
    // enhanceCellContrast後: 数字=黒(0), 背景=白(255)
    // MNISTは数字=白(1), 背景=黒(0) なので反転
    const normalized = tf.scalar(255).sub(tensor).div(tf.scalar(255));

    // 3. バッチ次元追加 [1, 28, 28, 1]
    const batched = normalized.expandDims(0);

    // 4. 推論
    const prediction = model.predict(batched);
    const probs = Array.from(prediction.dataSync());

    // 5. 1〜9の中で最高スコアを探す（0は数独に存在しない）
    let maxProb = 0, maxClass = 0;
    for (let c = 1; c <= 9; c++) {
      if (probs[c] > maxProb) {
        maxProb = probs[c];
        maxClass = c;
      }
    }

    // 信頼度が低すぎる場合は0（空）として扱う
    if (maxProb < 0.3) return 0;
    return maxClass;
  });
}

/**
 * セル画像を前処理してコントラストを強調する
 * （splitGridIntoCells の後に呼ぶ任意の前処理）
 */
function enhanceCellContrast(cellCanvas) {
  const out = document.createElement('canvas');
  out.width  = cellCanvas.width;
  out.height = cellCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(cellCanvas, 0, 0);

  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;

  // グレースケール化 + 大津の二値化的処理
  let sum = 0;
  const grays = new Uint8Array(d.length / 4);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
    grays[i/4] = g;
    sum += g;
  }
  const mean = sum / grays.length;

  for (let i = 0; i < d.length; i += 4) {
    const val = grays[i/4] > mean ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}
