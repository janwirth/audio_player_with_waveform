// Mini stereo spectrum (32 frequency bands, max of L/R). Ported from
// react-web-audio-platform/.../MiniSpectro.tsx — same band layout, crop,
// frequency-gain curve and grayscale mapping.
//
// Uses `createMediaElementSource` on the singleton audio element. The audio
// element keeps `crossOrigin="anonymous"` so cross-origin streams work.

import { getAudio } from "./audio_ffi.mjs";

const DEFAULT_SIZE = 32;
const BAND_COUNT = 32;

let sharedState = null;

function initAudio(audio) {
  if (sharedState) return sharedState;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaElementSource(audio);
  const splitter = ctx.createChannelSplitter(2);
  const leftA = ctx.createAnalyser();
  const rightA = ctx.createAnalyser();
  leftA.fftSize = 2048;
  rightA.fftSize = 2048;
  leftA.smoothingTimeConstant = 0.8;
  rightA.smoothingTimeConstant = 0.8;
  src.connect(splitter);
  splitter.connect(leftA, 0);
  splitter.connect(rightA, 1);
  src.connect(ctx.destination);
  sharedState = { ctx, leftA, rightA };
  // Some browsers require a user gesture before AudioContext can run.
  const resume = () => ctx.resume().catch(() => {});
  window.addEventListener("click", resume, { once: true });
  window.addEventListener("touchstart", resume, { once: true });
  return sharedState;
}

export function mountStereo(root, innerId) {
  const wrap = root?.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!wrap || wrap.__apww_stereo) return;
  wrap.__apww_stereo = true;
  const host = root?.host || wrap.parentElement;

  const size = parseInt(host?.getAttribute?.("size") || String(DEFAULT_SIZE), 10);
  const growFromCenter =
    (host?.getAttribute?.("grow") || "center") !== "bottom";

  if (host) host.style.display = "inline-block";
  Object.assign(wrap.style, {
    width: `${size}px`,
    height: `${size}px`,
    display: "inline-block",
  });

  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  wrap.appendChild(canvas);
  const ctx2 = canvas.getContext("2d");
  ctx2.scale(dpr, dpr);

  const audio = getAudio();
  const state = initAudio(audio);
  if (!state) return;

  const leftData = new Uint8Array(state.leftA.frequencyBinCount);
  const rightData = new Uint8Array(state.rightA.frequencyBinCount);

  let raf = 0;
  let rendering = true;
  const render = () => {
    if (!rendering) return;
    if (state.ctx.state === "suspended") state.ctx.resume().catch(() => {});

    state.leftA.getByteFrequencyData(leftData);
    state.rightA.getByteFrequencyData(rightData);
    ctx2.clearRect(0, 0, size, size);

    const startOffset = Math.floor(leftData.length * 0.05);
    const endOffset = Math.floor(leftData.length * 0.25);
    const usable = leftData.length - startOffset - endOffset;
    const dataStep = Math.max(1, Math.floor(usable / BAND_COUNT));
    const barWidth = size / BAND_COUNT;

    const isDark =
      document.documentElement.classList.contains("dark") ||
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    for (let i = 0; i < BAND_COUNT; i++) {
      const idx = startOffset + i * dataStep;
      const l = (leftData[idx] || 0) / 255;
      const r = (rightData[idx] || 0) / 255;
      let v = Math.max(l, r);
      const gain = 1 + i / BAND_COUNT;
      v = Math.min(1, v * gain);

      const gray = isDark
        ? Math.floor(30 + v * 180)
        : Math.floor(255 - v * 180);
      ctx2.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;

      const bh = v * size;
      // Flip: low frequencies on the right, high on the left.
      const x = (BAND_COUNT - 1 - i) * barWidth;
      const w = barWidth * 0.95;
      if (growFromCenter) {
        const cy = size / 2;
        ctx2.fillRect(x, cy - bh / 2, w, bh);
      } else {
        ctx2.fillRect(x, size - bh, w, bh);
      }
    }

    raf = requestAnimationFrame(render);
  };
  render();

  wrap.__apww_cleanup = () => {
    rendering = false;
    if (raf) cancelAnimationFrame(raf);
  };
}
