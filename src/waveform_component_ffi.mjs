// Glue: connect a custom-element root to the waveform pipeline.

import {
  loadRenderData,
  renderWaveform,
  setupCanvas,
  paletteByName,
  getLivePalette,
  subscribeLivePalette,
  getLivePlayhead,
  subscribeLivePlayhead,
} from "./waveform_ffi.mjs";
import { dispatchSeek } from "./audio_ffi.mjs";

const STATUS_EV = "apww:status";

function makeStrip(bg, mode) {
  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "absolute",
    top: "0",
    left: "0",
    height: "100%",
    background: bg,
    mixBlendMode: mode,
    pointerEvents: "none",
    zIndex: "1",
  });
  return el;
}

function triad(palette, offset) {
  if (!palette?.midParams) return "white";
  const { l, s, h } = palette.midParams;
  return `oklch(${l} ${s} ${(h + offset) % 360})`;
}

function resolveColor(name, mode, palette) {
  switch (name) {
    case "invert":
      return { bg: "white", mode: "difference" };
    case "black":
      return { bg: "black", mode };
    case "white":
      return { bg: "white", mode };
    case "triad1":
      return { bg: triad(palette, 120), mode };
    case "triad2":
      return { bg: triad(palette, 240), mode };
    default:
      return { bg: "white", mode };
  }
}

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
    isolation: "isolate",
  });
  Object.assign(host.style, { display: "block", width: "100%" });

  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    width: "100%",
    height: `${height}px`,
    display: "block",
  });
  inner.appendChild(canvas);

  const usingLive = !paletteAttr;
  let palette = usingLive ? getLivePalette() : paletteByName(paletteAttr);
  let ph = getLivePlayhead();
  let stripsLeft = [];
  let stripsCenter = [];
  let stripsRight = [];
  let lastPct = 0;
  // When hovering, the center + right strips track the cursor as a seek
  // preview while the left "trail" keeps the real elapsed length.
  let hoverPct = null;

  const positionStrips = () => {
    const half = ph.centerPx / 2;

    // Left trail = configured left-bar width anchored to current playback.
    if (ph.leftFill) {
      for (const s of stripsLeft) {
        s.style.left = "0";
        s.style.width = `calc(${lastPct}% - ${half}px)`;
      }
    } else {
      for (const s of stripsLeft) {
        s.style.left = `calc(${lastPct}% - ${half}px - ${ph.leftPct}%)`;
        s.style.width = `${ph.leftPct}%`;
      }
    }

    if (hoverPct !== null) {
      // Hover preview: right stripe spans from playPos to hoverPos = the
      // chunk that would be skipped. Width clamped to at least 2px.
      const start = Math.min(lastPct, hoverPct);
      const span = Math.abs(hoverPct - lastPct);
      const rLeft = `calc(${start}% + ${half}px)`;
      const rWidth = `max(2px, ${span}%)`;
      for (const s of stripsRight) {
        s.style.left = rLeft;
        s.style.width = rWidth;
      }
      // Center marker tracks the cursor.
      const centerLeft = `calc(${hoverPct}% - ${half}px)`;
      const centerWidth = `${ph.centerPx}px`;
      for (const s of stripsCenter) {
        s.style.left = centerLeft;
        s.style.width = centerWidth;
      }
    } else {
      // Idle: center sits on playhead, right uses its configured width.
      const centerLeft = `calc(${lastPct}% - ${half}px)`;
      const centerWidth = `${ph.centerPx}px`;
      for (const s of stripsCenter) {
        s.style.left = centerLeft;
        s.style.width = centerWidth;
      }
      const rLeft = `calc(${lastPct}% + ${half}px)`;
      for (const s of stripsRight) {
        s.style.left = rLeft;
        s.style.width = `${ph.rightPct}%`;
      }
    }
  };

  const rebuildStrips = () => {
    for (const s of [...stripsLeft, ...stripsCenter, ...stripsRight]) s.remove();
    const make = (colors, mode) =>
      (colors || []).map((c) => {
        const r = resolveColor(c, mode, palette);
        return makeStrip(r.bg, r.mode);
      });
    stripsLeft = make(ph.leftColors, ph.leftMode);
    stripsCenter = make(ph.centerColors, ph.centerMode);
    stripsRight = make(ph.rightColors, ph.rightMode);
    for (const s of [...stripsLeft, ...stripsCenter, ...stripsRight]) {
      inner.appendChild(s);
    }
    positionStrips();
  };

  rebuildStrips();

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
    const show = d.url === url;
    for (const s of [...stripsLeft, ...stripsCenter, ...stripsRight]) {
      s.style.display = show ? "block" : "none";
    }
    if (show) {
      lastPct = Math.max(0, Math.min(1, d.position || 0)) * 100;
      positionStrips();
    }
  };
  window.addEventListener(STATUS_EV, statusHandler);

  const pctFromEvent = (e) => {
    const rect = inner.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  const clickHandler = (e) => {
    dispatchSeek(url, pctFromEvent(e));
  };
  const moveHandler = (e) => {
    hoverPct = pctFromEvent(e) * 100;
    positionStrips();
  };
  const leaveHandler = () => {
    hoverPct = null;
    positionStrips();
  };
  inner.addEventListener("click", clickHandler);
  inner.addEventListener("mousemove", moveHandler);
  inner.addEventListener("mouseleave", leaveHandler);

  let unsubPalette = () => {};
  if (usingLive) {
    unsubPalette = subscribeLivePalette((p) => {
      palette = p;
      if (renderData) draw();
      rebuildStrips();
    });
  }

  const unsubPlayhead = subscribeLivePlayhead((p) => {
    ph = p;
    rebuildStrips();
  });

  inner.__apww_cleanup = () => {
    ro.disconnect();
    window.removeEventListener(STATUS_EV, statusHandler);
    inner.removeEventListener("click", clickHandler);
    inner.removeEventListener("mousemove", moveHandler);
    inner.removeEventListener("mouseleave", leaveHandler);
    unsubPalette();
    unsubPlayhead();
  };
}
