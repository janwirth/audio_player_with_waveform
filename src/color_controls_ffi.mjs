// Five vertical sliders (CTR/LGT/SAT/HUE/SPR). Each input event recomputes
// the OKLCH palette and pushes it through the live-palette pub/sub so any
// mounted waveform redraws.

import { oklchPalette, setLivePalette } from "./waveform_ffi.mjs";

const DEFAULTS = {
  hue: 200,
  saturation: 0.2,
  hueSpread: 60,
  contrast: 0,
  lightness: 0.5,
};

const SLIDERS = [
  { key: "contrast", label: "CTR", min: -1, max: 1, step: 0.01 },
  { key: "lightness", label: "LGT", min: 0.1, max: 0.9, step: 0.01 },
  { key: "saturation", label: "SAT", min: 0, max: 0.4, step: 0.01 },
  { key: "hue", label: "HUE", min: 0, max: 360, step: 1 },
  { key: "hueSpread", label: "SPR", min: 0, max: 180, step: 1 },
];

export function mountColorControls(root, innerId) {
  const wrap = root?.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!wrap || wrap.__apww_cc) return;
  wrap.__apww_cc = true;

  const state = { ...DEFAULTS };

  Object.assign(wrap.style, {
    display: "flex",
    flexDirection: "row",
    gap: "12px",
    alignItems: "flex-end",
    fontFamily: "sans-serif",
    fontSize: "11px",
    userSelect: "none",
  });
  if (root.host) {
    root.host.style.display = "inline-block";
  }

  const push = () => setLivePalette(oklchPalette(state));

  for (const s of SLIDERS) {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      width: "28px",
    });
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(state[s.key]);
    Object.assign(input.style, {
      writingMode: "vertical-lr",
      direction: "rtl",
      width: "20px",
      height: "120px",
      padding: "0",
    });
    input.addEventListener("input", () => {
      state[s.key] = parseFloat(input.value);
      push();
    });
    const lbl = document.createElement("span");
    lbl.textContent = s.label;
    lbl.style.color = "#555";
    col.appendChild(input);
    col.appendChild(lbl);
    wrap.appendChild(col);
  }

  // Push the initial palette so waveforms render with the OKLCH defaults
  // instead of the hard-coded module default.
  push();
}
