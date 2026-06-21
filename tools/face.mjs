// Best-face photo ranking for the sync pipeline.
//
// Given a missionary's submitted photos, rank them so the cleanest solo
// portrait comes first (becomes the main hex image); group shots and
// off-centre candids sink to the back (they feed the gallery hex).
//
// Pure-JS: @vladmandic/face-api's node-wasm build on the tfjs CPU backend
// (no native @tensorflow/tfjs-node binary, no .wasm fetch) + jpeg-js for
// decoding. Models ship inside the face-api package. Everything is wrapped
// so a failure (missing dep, odd image) degrades to "keep original order"
// rather than breaking the sync.

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const require = createRequire(import.meta.url);

let _ready = null;
let tf, faceapi, opts;

async function init() {
  if (_ready) return _ready;
  _ready = (async () => {
    tf = require('@tensorflow/tfjs');
    faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
    await tf.setBackend('cpu');
    await tf.ready();
    // Resolve the model dir from the package itself (robust to npm hoisting).
    const pkg = require.resolve('@vladmandic/face-api/package.json');
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(resolve(dirname(pkg), 'model'));
    opts = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 });
  })();
  return _ready;
}

// "Is this a clean solo portrait of the subject?" — higher is better, 0 if no
// face is found. Solo, centred, reasonably-sized faces win; multi-face (group)
// and off-centre shots are penalised.
async function scorePhoto(absPath) {
  let img;
  try {
    img = jpeg.decode(await readFile(absPath), { useTArray: true, formatAsRGBA: false });
  } catch {
    return 0; // not a decodable JPEG
  }
  const { width, height, data } = img;
  const t = tf.tensor3d(data, [height, width, 3]);
  let dets;
  try { dets = await faceapi.detectAllFaces(t, opts); }
  finally { t.dispose(); }
  if (!dets.length) return 0;

  const imgArea = width * height;
  const largest = dets
    .map(d => {
      const b = d.box;
      const cx = (b.x + b.width / 2) / width;
      const cy = (b.y + b.height / 2) / height;
      const centeredness = 1 - Math.min(1, Math.hypot(cx - 0.5, cy - 0.5) / 0.5);
      return { area: (b.width * b.height) / imgArea, centeredness };
    })
    .sort((a, b) => b.area - a.area)[0];

  const solo = 1 / dets.length; // 1 face → 1.0, group → smaller
  return solo * (0.3 + 0.7 * largest.centeredness) * Math.sqrt(largest.area);
}

// Reorder absolute image paths best-first. <2 photos or any failure → returns
// the input order unchanged.
export async function rankPhotosByFace(absPaths, { log = console } = {}) {
  if (absPaths.length < 2) return absPaths.slice();
  try {
    await init();
  } catch (err) {
    log.warn?.(`[face] disabled (${err.message}) — keeping submission order`);
    return absPaths.slice();
  }
  const scored = [];
  for (const p of absPaths) {
    let score = 0;
    try { score = await scorePhoto(p); }
    catch (err) { log.warn?.(`[face] ${p}: ${err.message}`); }
    scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  log.log?.(`[face] ranked ${absPaths.length} photos: ${scored.map(s => s.score.toFixed(3)).join(', ')}`);
  return scored.map(s => s.p);
}
