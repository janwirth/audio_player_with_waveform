// Glue: connect a custom-element root to the waveform pipeline.
// Decodes the audio at `url`, renders to canvas, draws a playhead overlay
// from status events, and dispatches `apww:seek` on click.
//
// The `root` arg from Lustre's `after_paint` is the component's ShadowRoot.
// Read host attrs via `root.host`; place visuals inside an inner element
// looked up by id.

import {
  loadRenderData,
  renderWaveform,
  setupCanvas,
  paletteByName,
  getLivePalette,
  subscribeLivePalette,
} from "./waveform_ffi.mjs";
import { dispatchSeek } from "./audio_ffi.mjs";

const STATUS_EV = "apww:status";

export function mountWaveform(root, innerId) {
  if (!root) return;
  const inner = root.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!inner) return;
  const host = root.host || inner.parentElement;
  if (!host) return;

  const url = host.getAttribute?.("url") || "";
  const paletteAttr = host.getAttribute?.("palette") || "";
  const height = parseInt(host.getAttribute?.("height") || "64", 10);

  if (!url) return;
  if (inner.__apww_url === url) return;
  if (inner.__apww_cleanup) inner.__apww_cleanup();
  inner.__apww_url = url;

  inner.innerHTML = "";
  Object.assign(inner.style, {
    position: "relative",
    display: "block",
    width: "100%",
    height: `${height}px`,
    cursor: "pointer",
  });
  Object.assign(host.style, { display: "block", width: "100%" });

  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    width: "100%",
    height: `${height}px`,
    display: "block",
  });
  inner.appendChild(canvas);

  const playhead = document.createElement("div");
  Object.assign(playhead.style, {
    position: "absolute",
    top: "0",
    left: "0",
    height: "100%",
    width: "0",
    background: "rgba(0,0,0,0.18)",
    pointerEvents: "none",
    zIndex: "1",
    transition: "width 80ms linear",
  });
  inner.appendChild(playhead);

  // Static named palette wins if user explicitly set one; otherwise the
  // live (color-controls-driven) palette is used and we re-render on change.
  const usingLive = !paletteAttr;
  let palette = usingLive ? getLivePalette() : paletteByName(paletteAttr);
  let renderData = null;
  let drawWidth = inner.clientWidth || host.clientWidth || 600;

  const draw = () => {
    setupCanvas(canvas, drawWidth, height);
    renderWaveform(canvas, renderData, palette);
  };

  loadRenderData(url)
    .then((data) => {
      renderData = data;
      draw();
    })
    .catch((err) => console.error("apww waveform load failed", err));

  const ro = new ResizeObserver(() => {
    const w = inner.clientWidth || host.clientWidth;
    if (w && Math.abs(w - drawWidth) > 1) {
      drawWidth = w;
      if (renderData) draw();
    }
  });
  ro.observe(inner);

  const statusHandler = (e) => {
    const d = e.detail || {};
    if (d.url !== url) {
      playhead.style.width = "0";
      return;
    }
    playhead.style.width = `${Math.max(0, Math.min(1, d.position || 0)) * 100}%`;
  };
  window.addEventListener(STATUS_EV, statusHandler);

  const clickHandler = (e) => {
    const rect = inner.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    dispatchSeek(url, pct);
  };
  inner.addEventListener("click", clickHandler);

  let unsubPalette = () => {};
  if (usingLive) {
    unsubPalette = subscribeLivePalette((p) => {
      palette = p;
      if (renderData) draw();
    });
  }

  inner.__apww_cleanup = () => {
    ro.disconnect();
    window.removeEventListener(STATUS_EV, statusHandler);
    inner.removeEventListener("click", clickHandler);
    unsubPalette();
  };
}
