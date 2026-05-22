// Worker for CPU-heavy waveform + spectral analysis. Pure compute, no DOM.
// Receives Float32Array PCM (transferred), posts back arrays.

function getWaveformData(rawData, samples) {
  const target = samples ?? 600;
  const len = rawData.length;
  const MAX = 100000;
  const toProcess = Math.min(len, MAX);
  const sampleStep = len / toProcess;
  const sampled = new Float32Array(toProcess);
  for (let i = 0; i < toProcess; i++) {
    sampled[i] = rawData[Math.floor(i * sampleStep)] || 0;
  }
  const maxSamples = Math.min(target, 600);
  const blockSize = Math.max(1, Math.floor(toProcess / maxSamples));
  const waveform = new Array(maxSamples);
  for (let i = 0; i < maxSamples; i++) {
    const startIdx = i * blockSize;
    const endIdx = i === maxSamples - 1 ? toProcess : startIdx + blockSize;
    let sum = 0;
    const n = endIdx - startIdx;
    for (let j = startIdx; j < endIdx; j++) {
      const s = sampled[j] || 0;
      sum += s < 0 ? -s : s;
    }
    waveform[i] = n > 0 ? sum / n : 0;
  }
  return waveform;
}

function getSpectralData(rawData, waveformData) {
  const len = rawData.length;
  const wl = waveformData.length;
  const perPos = Math.max(1, Math.floor(len / wl));
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
      const s = rawData[i];
      rms += s * s;
      if (i < highEnd) {
        highV += Math.abs(s - rawData[i + highStep]);
        highC++;
      }
    }
    const lowEnd = end - lowStep;
    for (let i = start; i < lowEnd; i += lowInc) {
      lowV += Math.abs(rawData[i] - rawData[i + lowStep]);
      lowC++;
    }
    const midEnd = end - midStep;
    for (let i = start; i < midEnd; i += midInc) {
      midV += Math.abs(rawData[i] - rawData[i + midStep]);
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

self.onmessage = function (e) {
  const { jobId, channelData } = e.data;
  try {
    const waveformData = getWaveformData(channelData, 600);
    const spectralData = getSpectralData(channelData, waveformData);
    self.postMessage({ jobId, ok: true, waveformData, spectralData });
  } catch (err) {
    self.postMessage({ jobId, ok: false, error: String(err) });
  }
};
