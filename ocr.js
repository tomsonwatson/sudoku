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

  // モデル出力形状をデバッグ
  let debugCount = 0;

  for (let i = 0; i < 81; i++) {
    if (emptyFlags[i]) {
      boardData[i] = 0;
      continue;
    }

    const { digit, probs } = await predictDigitWithProbs(model, cells[i]);
    boardData[i] = digit;

    // 最初の3つの非空セルの生の確率値をログ
    if (debugCount < 3) {
      const top3 = probs
        .map((p, c) => ({ c, p }))
        .sort((a, b) => b.p - a.p)
        .slice(0, 3)
        .map(x => `${x.c}:${(x.p*100).toFixed(0)}%`)
        .join(' ');
      console.log(`セル${i}(行${Math.floor(i/9)+1}列${i%9+1}) → ${digit} [${top3}]`);
      debugCount++;
    }
  }

  // 全行結果をまとめてログ
  for (let r = 0; r < 9; r++) {
    console.log(`行${r+1}: ${boardData.slice(r*9, r*9+9).join(' ')}`);
  }
}

/**
 * 単一セル画像から数字を予測する
 * @param {tf.LayersModel} model
 * @param {HTMLCanvasElement} cellCanvas
 * @returns {number} 1〜9、判定不能なら 0
 */
async function predictDigitWithProbs(model, cellCanvas) {
  const result = tf.tidy(() => {
    // 1. 28x28 グレースケールに変換
    const tensor = tf.browser.fromPixels(cellCanvas, 1)
      .resizeBilinear([28, 28])
      .toFloat();

    // 2. 反転（数字=白, 背景=黒 のMNIST形式に）
    const normalized = tf.scalar(255).sub(tensor).div(tf.scalar(255));

    // 3. バッチ次元追加 [1, 28, 28, 1]
    const batched = normalized.expandDims(0);

    // 4. 推論 → softmaxで確率化
    const logits = model.predict(batched);
    const probs = tf.softmax(logits);
    return Array.from(probs.dataSync());
  });

  // 1〜9で最高確率を探す
  let maxProb = 0, maxClass = 0;
  for (let c = 1; c <= 9; c++) {
    if (result[c] > maxProb) {
      maxProb = result[c];
      maxClass = c;
    }
  }

  return {
    digit: maxProb < 0.25 ? 0 : maxClass,
    probs: result,
  };
}

// 後方互換用
async function predictDigit(model, cellCanvas) {
  const { digit } = await predictDigitWithProbs(model, cellCanvas);
  return digit;
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
