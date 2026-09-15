import { GifWriter } from './gif.js';
import { buildPalette, mapPixels } from './quantize.js';
import { parseMp4Timing } from './mp4.js';

const MAX_FRAMES = 600;

function waitEvent(target, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error('Erreur de lecture de la video')); };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      target.removeEventListener(name, onOk);
      target.removeEventListener('error', onErr);
    };
    target.addEventListener(name, onOk);
    target.addEventListener('error', onErr);
    if (timeoutMs) timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
  });
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function seekTo(video, time, presentation) {
  const done = waitEvent(video, 'seeked', 4000);
  video.currentTime = time;
  await done;

  const state = presentation || { enabled: true, misses: 0 };
  if (!state.enabled || typeof video.requestVideoFrameCallback !== 'function') return;

  const fired = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    video.requestVideoFrameCallback(() => finish(true));
    setTimeout(() => finish(false), 40);
  });

  if (fired) {
    state.misses = 0;
  } else if (++state.misses >= 3) {
    state.enabled = false;
  }
}

async function probeFps(video) {
  if (typeof video.requestVideoFrameCallback !== 'function') return null;
  const samples = [];
  const estimate = await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.pause();
      if (samples.length < 3) return resolve(null);
      const deltas = [];
      for (let i = 1; i < samples.length; i++) {
        const delta = samples[i] - samples[i - 1];
        if (delta > 0.0005) deltas.push(delta);
      }
      if (!deltas.length) return resolve(null);
      deltas.sort((a, b) => a - b);
      resolve(1 / deltas[deltas.length >> 1]);
    };
    const onFrame = (now, meta) => {
      samples.push(meta.mediaTime);
      if (samples.length >= 14 || meta.mediaTime > 1.5) return finish();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.muted = true;
    video.play().catch(finish);
    setTimeout(finish, 2500);
  });
  video.pause();
  try {
    video.currentTime = 0;
  } catch (error) {
    void error;
  }
  if (!estimate || !isFinite(estimate)) return null;
  return Math.min(60, Math.max(5, estimate));
}

export function planFromDurations(durations, maxFps) {
  /**
   * Choisit les images source a conserver pour tenir le plafond de FPS.
   * La cadence vise une echeance fixe : une source a 30 im/s plafonnee a 25
   * garde 25 images sur 30, au lieu d'en jeter une sur deux.
   * Les images ecartees voient leur duree reportee sur l'image conservee precedente.
   */
  const interval = 1 / maxFps;
  const plan = [];
  let time = 0;
  let nextDue = 0;

  for (let i = 0; i < durations.length; i++) {
    const duration = durations[i];
    const start = time;
    time += duration;

    if (plan.length > 0 && start + 1e-9 < nextDue) {
      plan[plan.length - 1].seconds += duration;
      continue;
    }

    if (plan.length >= MAX_FRAMES) break;

    plan.push({ time: start + duration / 2, seconds: duration });
    nextDue += interval;
    if (nextDue < time - interval) nextDue = time - interval;
  }

  return plan;
}

function planUniform(duration, fps) {
  const step = 1 / fps;
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration * fps)));
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push({ time: Math.min(duration - 1e-3, (i + 0.5) * step), seconds: step });
  }
  return plan;
}

function computeDiff(previous, current, width, height, tolerance) {
  const mask = new Uint8Array(width * height);
  const threshold = tolerance * tolerance * 3;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const o = (row + x) << 2;
      const dr = current[o] - previous[o];
      const dg = current[o + 1] - previous[o + 1];
      const db = current[o + 2] - previous[o + 2];
      if (dr * dr + dg * dg + db * db > threshold) {
        mask[row + x] = 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null;
  return { mask, box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}

export async function convertToGif(sourceUrl, options, onProgress) {
  /**
   * Telecharge un mp4 et le reencode en GIF89a anime.
   */
  const opts = Object.assign(
    { maxFps: 25, maxWidth: 640, maxHeight: 640, dither: true, tolerance: 8, loop: true },
    options || {}
  );

  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error('Telechargement impossible (' + response.status + ')');
  const buffer = await response.arrayBuffer();

  let timing = null;
  try {
    timing = parseMp4Timing(buffer);
  } catch (error) {
    timing = null;
  }

  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'video/mp4' }));
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await waitEvent(video, 'loadedmetadata', 15000);
    if (!video.videoWidth || !video.videoHeight) throw new Error('Video illisible');

    let duration = video.duration;
    if (!isFinite(duration) || duration <= 0) {
      if (timing) {
        duration = timing.duration;
      } else {
        await seekTo(video, 1e6).catch(() => {});
        duration = isFinite(video.duration) ? video.duration : video.currentTime;
      }
    }
    if (!isFinite(duration) || duration <= 0) throw new Error('Duree inconnue');

    let plan;
    let sourceFps;
    if (timing && Math.abs(timing.duration - duration) < Math.max(0.5, duration * 0.25)) {
      sourceFps = timing.frameCount / timing.duration;
      plan = planFromDurations(timing.durations, opts.maxFps);
    } else {
      sourceFps = (await probeFps(video)) || 25;
      plan = planUniform(duration, Math.min(sourceFps, opts.maxFps));
    }
    if (!plan.length) plan = planUniform(duration, Math.min(sourceFps || 25, opts.maxFps));

    const scale = Math.min(1, opts.maxWidth / video.videoWidth, opts.maxHeight / video.videoHeight);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const writer = new GifWriter(width, height, opts.loop ? 0 : 1);
    const presentation = { enabled: true, misses: 0 };
    let previous = null;
    let cumulativeSeconds = 0;
    let writtenCs = 0;

    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i];
      await seekTo(video, Math.max(0, Math.min(duration - 1e-3, entry.time)), presentation);
      ctx.drawImage(video, 0, 0, width, height);
      const frame = ctx.getImageData(0, 0, width, height).data;

      cumulativeSeconds += entry.seconds;
      const delayCs = Math.max(2, Math.round(cumulativeSeconds * 100) - writtenCs);
      writtenCs += delayCs;

      if (previous === null) {
        const box = { x: 0, y: 0, width, height };
        const { palette, size } = buildPalette(frame, width, box, null, 256);
        const indices = mapPixels(frame, width, box, null, palette, size, 0, opts.dither);
        writer.addFrame({
          indices, palette, colorCount: size,
          x: 0, y: 0, width, height,
          delayCs, transparentIndex: -1
        });
        previous = frame;
      } else {
        const diff = computeDiff(previous, frame, width, height, opts.tolerance);
        if (!diff) {
          writer.extendLastDelay(delayCs);
        } else {
          const { mask, box } = diff;
          const { palette, size } = buildPalette(frame, width, box, mask, 255);
          const indices = mapPixels(frame, width, box, mask, palette, size, size, opts.dither);
          writer.addFrame({
            indices, palette, colorCount: size,
            x: box.x, y: box.y, width: box.width, height: box.height,
            delayCs, transparentIndex: size
          });
          previous = frame;
        }
      }

      if (onProgress) onProgress(Math.round(((i + 1) / plan.length) * 100));
      if ((i & 3) === 0) await nextTick();
    }

    return {
      bytes: writer.finish(),
      width,
      height,
      frames: writer.frameCount,
      fps: sourceFps,
      duration,
      timedFromContainer: Boolean(timing)
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
