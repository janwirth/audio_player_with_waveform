// Decode audio buffer -> waveform + spectral data and render to canvas.
// Port of janwirth/react-web-audio-platform waveform pipeline.
//
// Pipeline:
//   1. IndexedDB cache lookup (persistent).
//   2. fetch URL + decodeAudioData on main thread (transcode via ffmpeg
//      first if the browser can't decode this format).
//   3. Hand the PCM Float32Array to the worker pool (LIFO, max 3 in flight)
//      for waveform + spectral analysis.
//   4. Persist result back to IndexedDB.

import {
  schedule as scheduleAnalysis,
  cacheGet,
  cachePut,
} from "./waveform_pool_ffi.mjs";

let audioCtx = null;
const renderCache = new Map(); // url -> { waveformData, spectralData }
const inflight = new Map(); // url -> Promise

function ctx() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export async function loadRenderData(url) {
  if (renderCache.has(url)) return renderCache.get(url);
  if (inflight.has(url)) return inflight.get(url);

  const p = (async () => {
    // 1. IDB cache hit?
    const cached = await cacheGet(url);
    if (cached && cached.waveformData && cached.spectralData) {
      renderCache.set(url, cached);
      inflight.delete(url);
      return cached;
    }

    // 2. Decode (main thread; browser uses a separate native thread anyway).
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const audioBuffer = await ctx().decodeAudioData(buf.slice(0));

    // 3. Schedule analysis on a worker. Copy the channel data since the
    // transfer detaches the buffer (AudioBuffer keeps its own copy).
    const ch = audioBuffer.getChannelData(0);
    const pcm = new Float32Array(ch);
    const data = await scheduleAnalysis(pcm);

    // 4. Persist for next session.
    cachePut(url, data);
    renderCache.set(url, data);
    inflight.delete(url);
    return data;
  })().catch((err) => {
    inflight.delete(url);
    throw err;
  });
  inflight.set(url, p);
  return p;
}

// (kept for reference; analysis now lives in waveform_worker.mjs)
// eslint-disable-next-line no-unused-vars
function _legacyGetWaveformData(audioBuffer, samples = 600) {
  const raw = audioBuffer.getChannelData(0);
  const len = raw.length;
  const MAX = 100000;
  const toProcess = Math.min(len, MAX);
  const sampleStep = len / toProcess;
  const sampled = new Float32Array(toProcess);
  for (let i = 0; i < toProcess; i++) {
    sampled[i] = raw[Math.floor(i * sampleStep)] ?? 0;
  }
  const maxSamples = Math.min(samples, 600);
  const blockSize = Math.floor(toProcess / maxSamples);
  const waveform = new Array(maxSamples);
  for (let i = 0; i < maxSamples; i++) {
    const startIdx = i * blockSize;
    const endIdx = i === maxSamples - 1 ? toProcess : startIdx + blockSize;
    let sum = 0;
    const n = endIdx - startIdx;
    for (let j = startIdx; j < endIdx; j++) {
      const s = sampled[j] ?? 0;
      sum += s < 0 ? -s : s;
    }
    waveform[i] = n > 0 ? sum / n : 0;
  }
  return waveform;
}

// eslint-disable-next-line no-unused-vars
function _legacyGetSpectralData(audioBuffer, waveformData) {
  const raw = audioBuffer.getChannelData(0);
  const len = raw.length;
  const wl = waveformData.length;
  const perPos = Math.floor(len / wl);
  const windowSize = Math.min(2048, perPos * 2);
  const out = new Array(wl);
  const SCALE = 100;
  for (let pos = 0; pos < wl; pos++) {
    const start = pos * perPos;
    const end = Math.min(start + windowSize, len);
    const segLen = end - start;
    if (segLen === 0) {
      out[pos] = { lowEnergy: 0, midEnergy: 0, highEnergy: 0 };
      continue;
    }
    const lowStep = Math.max(1, segLen >> 3);
    const midStep = Math.max(1, segLen >> 5);
    const highStep = Math.max(1, segLen >> 6);
    const lowInc = Math.max(1, lowStep >> 1);
    const midInc = Math.max(1, midStep >> 1);

    let rms = 0;
    let lowV = 0, lowC = 0, midV = 0, midC = 0, highV = 0, highC = 0;
    const highEnd = end - highStep;
    for (let i = start; i < end; i++) {
      const s = raw[i];
      rms += s * s;
      if (i < highEnd) {
        highV += Math.abs(s - raw[i + highStep]);
        highC++;
      }
    }
    const lowEnd = end - lowStep;
    for (let i = start; i < lowEnd; i += lowInc) {
      lowV += Math.abs(raw[i] - raw[i + lowStep]);
      lowC++;
    }
    const midEnd = end - midStep;
    for (let i = start; i < midEnd; i += midInc) {
      midV += Math.abs(raw[i] - raw[i + midStep]);
      midC++;
    }
    const rmsVal = Math.sqrt(rms / segLen);
    out[pos] = {
      lowEnergy: (lowV / Math.max(1, lowC)) * rmsVal * SCALE,
      midEnergy: (midV / Math.max(1, midC)) * rmsVal * SCALE,
      highEnergy: (highV / Math.max(1, highC)) * rmsVal * SCALE,
    };
  }
  return out;
}

const PALETTES = {
  classic: { bg: "#fff", low: "#000", mid: "#555", high: "#000" },
  vibrant: { bg: "#fff", low: "#FF6B6B", mid: "#4ECDC4", high: "#45B7D1" },
  dark: { bg: "#1a1a1a", low: "#E74C3C", mid: "#3498DB", high: "#2ECC71" },
  neon: { bg: "#000", low: "#FF00FF", mid: "#00FFFF", high: "#FFFF00" },
  monochrome: { bg: "#fff", low: "#333", mid: "#666", high: "#999" },
};

export function paletteByName(name) {
  return PALETTES[name] || PALETTES.classic;
}

// Generate an OKLCH-based palette. Ported from
// react-web-audio-platform/.../color-palettes.ts:generateOklchPalette.
export function oklchPalette({
  hue = 0,
  saturation = 0.2,
  hueSpread = 60,
  contrast = 0,
  lightness = 0.5,
} = {}) {
  const h = Math.max(0, Math.min(360, hue));
  const s = Math.max(0, Math.min(0.4, saturation));
  const sp = Math.max(0, Math.min(180, hueSpread));
  const c = Math.max(-1, Math.min(1, contrast));
  const l = Math.max(0.1, Math.min(0.9, lightness));

  const range = Math.abs(c) * 0.4;
  const inverted = c < 0;
  const lowL = clamp01(l + (inverted ? range : -range));
  const midL = l;
  const highL = clamp01(l + (inverted ? -range : range));

  const midShift = sp / 3;
  const highShift = (sp * 2) / 3;
  const lowH = h;
  const midH = (h + midShift) % 360;
  const highH = (h + highShift) % 360;

  const lowS = Math.min(0.4, s * 1.2);
  const midS = Math.min(0.4, s);
  const highS = Math.min(0.4, s * 0.8);

  return {
    bg: "oklch(0.98 0 0)",
    low: `oklch(${lowL} ${lowS} ${lowH})`,
    mid: `oklch(${midL} ${midS} ${midH})`,
    high: `oklch(${highL} ${highS} ${highH})`,
    midParams: { l: midL, s: midS, h: midH },
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// ---- live palette pub/sub ------------------------------------------------
// Color-controls element mutates this; mounted waveforms re-render on change.

let livePalette = oklchPalette({
  hue: 212,
  saturation: 0.1,
  hueSpread: 38,
  contrast: 1,
  lightness: 0.3,
});
const liveSubs = new Set();

export function getLivePalette() {
  return livePalette;
}

export function setLivePalette(p) {
  livePalette = p;
  for (const fn of liveSubs) {
    try {
      fn(p);
    } catch (e) {
      console.error(e);
    }
  }
}

export function subscribeLivePalette(fn) {
  liveSubs.add(fn);
  return () => liveSubs.delete(fn);
}

// ---- live playhead settings ---------------------------------------------
// Controls the two invert strips around the play cursor: their widths in %
// of the waveform, and the backdrop-filter invert strength.

let livePlayhead = {
  leftPct: 1,
  centerPx: 6,
  rightPct: 0,
  leftMode: "saturation",
  centerMode: "color-burn",
  rightMode: "overlay",
  leftColors: ["white"],
  centerColors: ["invert", "triad1", "triad2"],
  rightColors: ["black"],
  leftFill: true,
};
const playheadSubs = new Set();

export function getLivePlayhead() {
  return livePlayhead;
}

export function setLivePlayhead(patch) {
  livePlayhead = { ...livePlayhead, ...patch };
  for (const fn of playheadSubs) {
    try {
      fn(livePlayhead);
    } catch (e) {
      console.error(e);
    }
  }
}

export function subscribeLivePlayhead(fn) {
  playheadSubs.add(fn);
  return () => playheadSubs.delete(fn);
}

export function setupCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const c = canvas.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.scale(dpr, dpr);
}

export function renderWaveform(canvas, data, palette) {
  if (!data) return;
  const { waveformData, spectralData } = data;
  const ctx2 = canvas.getContext("2d");
  if (!ctx2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  ctx2.clearRect(0, 0, w, h);

  const N = waveformData.length;
  if (N === 0) return;
  const maxW = Math.max(...waveformData);
  if (maxW <= 0) return;

  // Normalize: ensure median sample reaches full height (constraints [0.5, 1.0])
  const sorted = [...waveformData].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)] || maxW;
  const effectiveMax = median > 0 ? median : maxW;
  const QL = 8;
  const FQL = 16;
  const maxAmp = h - 1;
  const normWave = waveformData.map((v) => {
    const n = Math.min(1, v / effectiveMax);
    const q = Math.floor(n * QL) / QL;
    return q * maxAmp;
  });

  let maxLow = 0, maxMid = 0, maxHigh = 0;
  for (const s of spectralData) {
    if (s.lowEnergy > maxLow) maxLow = s.lowEnergy;
    if (s.midEnergy > maxMid) maxMid = s.midEnergy;
    if (s.highEnergy > maxHigh) maxHigh = s.highEnergy;
  }

  // Iterate by pixel column, sampling the waveform with linear interpolation,
  // so every pixel is covered regardless of canvas width vs sample count.
  const step = w / N;
  const rectW = Math.max(1, Math.floor(step));
  const bottom = Math.floor(h);

  ctx2.imageSmoothingEnabled = false;

  const sampleAt = (pixelX) => {
    const idx = pixelX / step;
    const i0 = Math.max(0, Math.min(N - 1, Math.floor(idx)));
    const i1 = Math.max(0, Math.min(N - 1, i0 + 1));
    const t = idx - i0;
    const amp = normWave[i0] * (1 - t) + normWave[i1] * t;
    const s0 = spectralData[i0];
    const s1 = spectralData[i1];
    const sp = {
      low: s0.lowEnergy * (1 - t) + s1.lowEnergy * t,
      mid: s0.midEnergy * (1 - t) + s1.midEnergy * t,
      high: s0.highEnergy * (1 - t) + s1.highEnergy * t,
    };
    return { amp, sp };
  };

  const qlv = (v) =>
    (Math.min(FQL - 1, Math.max(0, Math.floor((v / maxAmp) * FQL))) / FQL) *
    maxAmp;

  for (let pixelX = 0; pixelX < w; pixelX += rectW) {
    const { amp, sp } = sampleAt(pixelX);
    if (amp <= 0) continue;

    const nl = maxLow > 0 ? Math.max(0.1, sp.low / maxLow) : 0.1;
    const nm = maxMid > 0 ? Math.max(0.1, sp.mid / maxMid) : 0.1;
    const nh = maxHigh > 0 ? Math.max(0.1, sp.high / maxHigh) : 0.1;
    const tot = nl + nm + nh;
    const la = Math.floor(qlv(amp * (nl / tot)));
    const ma = Math.floor(qlv(amp * (nm / tot)));
    const ha = Math.floor(qlv(amp * (nh / tot)));

    const x = Math.floor(pixelX);
    // Cover any remainder pixels on the last column.
    const drawW = Math.min(rectW, Math.ceil(w) - x);

    ctx2.fillStyle = palette.low;
    ctx2.fillRect(x, bottom - la, drawW, la);
    ctx2.fillStyle = palette.mid;
    ctx2.fillRect(x, bottom - la - ma, drawW, ma);
    ctx2.fillStyle = palette.high;
    ctx2.fillRect(x, bottom - la - ma - ha, drawW, ha);
  }

  // baseline
  ctx2.fillStyle = palette.low;
  const lineH = Math.max(1, Math.round(h / 24));
  ctx2.fillRect(0, bottom - lineH, w, lineH);
}
