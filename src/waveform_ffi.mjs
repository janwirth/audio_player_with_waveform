// Decode audio buffer -> waveform + spectral data and render to canvas.
// Port of janwirth/react-web-audio-platform waveform pipeline.

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
    const buf = await fetch(url).then((r) => r.arrayBuffer());
    const audioBuffer = await ctx().decodeAudioData(buf.slice(0));
    const waveformData = getWaveformData(audioBuffer, 600);
    const spectralData = getSpectralData(audioBuffer, waveformData);
    const data = { waveformData, spectralData };
    renderCache.set(url, data);
    inflight.delete(url);
    return data;
  })();
  inflight.set(url, p);
  return p;
}

function getWaveformData(audioBuffer, samples = 600) {
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

function getSpectralData(audioBuffer, waveformData) {
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

  const maxW = Math.max(...waveformData);
  if (maxW <= 0) return;

  // Normalize: ensure median sample reaches full height (constraints [0.5, 1.0])
  const sorted = [...waveformData].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length * 0.5)] || maxW;
  const effectiveMax = median > 0 ? median : maxW;
  const QL = 8;
  const FQL = 16;
  const normWave = waveformData.map((v) => {
    const n = Math.min(1, v / effectiveMax);
    const q = Math.floor(n * QL) / QL;
    return q * (h - 1);
  });

  let maxLow = 0, maxMid = 0, maxHigh = 0;
  for (const s of spectralData) {
    if (s.lowEnergy > maxLow) maxLow = s.lowEnergy;
    if (s.midEnergy > maxMid) maxMid = s.midEnergy;
    if (s.highEnergy > maxHigh) maxHigh = s.highEnergy;
  }

  const step = w / waveformData.length;
  const rectW = Math.max(1, Math.floor(step));
  const bottom = Math.floor(h);

  ctx2.imageSmoothingEnabled = false;

  for (let i = 0; i < waveformData.length; i++) {
    const amp = normWave[i];
    if (amp <= 0) continue;
    const s = spectralData[i];
    const nl = maxLow > 0 ? Math.max(0.1, s.lowEnergy / maxLow) : 0.1;
    const nm = maxMid > 0 ? Math.max(0.1, s.midEnergy / maxMid) : 0.1;
    const nh = maxHigh > 0 ? Math.max(0.1, s.highEnergy / maxHigh) : 0.1;
    const tot = nl + nm + nh;
    let la = amp * (nl / tot);
    let ma = amp * (nm / tot);
    let ha = amp * (nh / tot);

    const qlv = (v) =>
      (Math.min(FQL - 1, Math.max(0, Math.floor((v / (h - 1)) * FQL))) / FQL) *
      (h - 1);
    la = Math.floor(qlv(la));
    ma = Math.floor(qlv(ma));
    ha = Math.floor(qlv(ha));

    const x = Math.floor(i * step);

    ctx2.fillStyle = palette.low;
    ctx2.fillRect(x, bottom - la, rectW, la);
    ctx2.fillStyle = palette.mid;
    ctx2.fillRect(x, bottom - la - ma, rectW, ma);
    ctx2.fillStyle = palette.high;
    ctx2.fillRect(x, bottom - la - ma - ha, rectW, ha);
  }

  // baseline
  ctx2.fillStyle = palette.low;
  const lineH = Math.max(1, Math.round(h / 24));
  ctx2.fillRect(0, bottom - lineH, w, lineH);
}
