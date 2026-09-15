const BUCKET_COUNT = 32768;

const hist = {
  n: new Uint32Array(BUCKET_COUNT),
  r: new Float64Array(BUCKET_COUNT),
  g: new Float64Array(BUCKET_COUNT),
  b: new Float64Array(BUCKET_COUNT)
};
const touched = new Int32Array(BUCKET_COUNT);
let touchedLen = 0;
const nearestCache = new Int16Array(BUCKET_COUNT);

function bucketOf(r, g, b) {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

function resetHistogram() {
  for (let i = 0; i < touchedLen; i++) {
    const k = touched[i];
    hist.n[k] = 0;
    hist.r[k] = 0;
    hist.g[k] = 0;
    hist.b[k] = 0;
  }
  touchedLen = 0;
}

function boxStats(keys, start, end) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, count = 0;
  for (let i = start; i < end; i++) {
    const k = keys[i];
    const r = (k >> 10) & 31;
    const g = (k >> 5) & 31;
    const b = k & 31;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
    count += hist.n[k];
  }
  const rangeR = rMax - rMin;
  const rangeG = gMax - gMin;
  const rangeB = bMax - bMin;
  let channel = 0;
  let range = rangeR;
  if (rangeG > range) { channel = 1; range = rangeG; }
  if (rangeB > range) { channel = 2; range = rangeB; }
  return { start, end, count, channel, range };
}

function channelValue(key, channel) {
  if (channel === 0) return (key >> 10) & 31;
  if (channel === 1) return (key >> 5) & 31;
  return key & 31;
}

export function buildPalette(data, imageWidth, box, mask, maxColors) {
  /**
   * Construit une palette par median cut sur la region demandee.
   * Retourne { palette: Uint8Array(size*3), size }.
   */
  resetHistogram();
  const { x, y, width, height } = box;
  for (let j = 0; j < height; j++) {
    const rowStart = (y + j) * imageWidth + x;
    for (let i = 0; i < width; i++) {
      const p = rowStart + i;
      if (mask && mask[p] === 0) continue;
      const o = p << 2;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const k = bucketOf(r, g, b);
      if (hist.n[k] === 0) touched[touchedLen++] = k;
      hist.n[k]++;
      hist.r[k] += r;
      hist.g[k] += g;
      hist.b[k] += b;
    }
  }

  if (touchedLen === 0) {
    return { palette: new Uint8Array(3), size: 1 };
  }

  const keys = touched.slice(0, touchedLen);

  const emit = (boxes) => {
    const palette = new Uint8Array(boxes.length * 3);
    for (let i = 0; i < boxes.length; i++) {
      const { start, end } = boxes[i];
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let j = start; j < end; j++) {
        const k = keys[j];
        sr += hist.r[k];
        sg += hist.g[k];
        sb += hist.b[k];
        sn += hist.n[k];
      }
      const o = i * 3;
      palette[o] = Math.round(sr / sn);
      palette[o + 1] = Math.round(sg / sn);
      palette[o + 2] = Math.round(sb / sn);
    }
    return { palette, size: boxes.length };
  };

  if (touchedLen <= maxColors) {
    const boxes = [];
    for (let i = 0; i < touchedLen; i++) boxes.push({ start: i, end: i + 1 });
    return emit(boxes);
  }

  let boxes = [boxStats(keys, 0, touchedLen)];
  while (boxes.length < maxColors) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.range === 0 || b.end - b.start < 2) continue;
      const score = b.count * (b.range + 1);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) break;

    const target = boxes[best];
    const slice = keys.subarray(target.start, target.end);
    const ch = target.channel;
    slice.sort((a, b) => channelValue(a, ch) - channelValue(b, ch));

    const half = target.count / 2;
    let acc = 0;
    let split = target.start + 1;
    for (let i = target.start; i < target.end - 1; i++) {
      acc += hist.n[keys[i]];
      if (acc >= half) { split = i + 1; break; }
      split = i + 2;
    }
    if (split <= target.start) split = target.start + 1;
    if (split >= target.end) split = target.end - 1;

    boxes[best] = boxStats(keys, target.start, split);
    boxes.push(boxStats(keys, split, target.end));
  }

  return emit(boxes);
}

export function createMapper(palette, size) {
  nearestCache.fill(-1);
  return function nearest(r, g, b) {
    const key = bucketOf(r, g, b);
    const cached = nearestCache[key];
    if (cached >= 0) return cached;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < size; i++) {
      const o = i * 3;
      const dr = r - palette[o];
      const dg = g - palette[o + 1];
      const db = b - palette[o + 2];
      const dist = dr * dr * 3 + dg * dg * 6 + db * db;
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    nearestCache[key] = best;
    return best;
  };
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function mapPixels(data, imageWidth, box, mask, palette, size, transparentIndex, dither) {
  /**
   * Projette la region sur la palette, avec tramage Floyd-Steinberg optionnel.
   */
  const { x, y, width, height } = box;
  const indices = new Uint8Array(width * height);
  const nearest = createMapper(palette, size);

  if (!dither) {
    for (let j = 0; j < height; j++) {
      const rowStart = (y + j) * imageWidth + x;
      const outRow = j * width;
      for (let i = 0; i < width; i++) {
        const p = rowStart + i;
        if (mask && mask[p] === 0) {
          indices[outRow + i] = transparentIndex;
          continue;
        }
        const o = p << 2;
        indices[outRow + i] = nearest(data[o], data[o + 1], data[o + 2]);
      }
    }
    return indices;
  }

  let curErr = new Float32Array((width + 2) * 3);
  let nextErr = new Float32Array((width + 2) * 3);

  for (let j = 0; j < height; j++) {
    const rowStart = (y + j) * imageWidth + x;
    const outRow = j * width;
    nextErr.fill(0);
    for (let i = 0; i < width; i++) {
      const p = rowStart + i;
      if (mask && mask[p] === 0) {
        indices[outRow + i] = transparentIndex;
        continue;
      }
      const o = p << 2;
      const e = (i + 1) * 3;
      const r = clamp255(data[o] + curErr[e]);
      const g = clamp255(data[o + 1] + curErr[e + 1]);
      const b = clamp255(data[o + 2] + curErr[e + 2]);
      const idx = nearest(Math.round(r), Math.round(g), Math.round(b));
      indices[outRow + i] = idx;

      const po = idx * 3;
      const er = r - palette[po];
      const eg = g - palette[po + 1];
      const eb = b - palette[po + 2];

      curErr[e + 3] += er * 0.4375;
      curErr[e + 4] += eg * 0.4375;
      curErr[e + 5] += eb * 0.4375;
      nextErr[e - 3] += er * 0.1875;
      nextErr[e - 2] += eg * 0.1875;
      nextErr[e - 1] += eb * 0.1875;
      nextErr[e] += er * 0.3125;
      nextErr[e + 1] += eg * 0.3125;
      nextErr[e + 2] += eb * 0.3125;
      nextErr[e + 3] += er * 0.0625;
      nextErr[e + 4] += eg * 0.0625;
      nextErr[e + 5] += eb * 0.0625;
    }
    const swap = curErr;
    curErr = nextErr;
    nextErr = swap;
  }

  return indices;
}
