// Sliders + selects + checkboxes driving the OKLCH palette and the three
// playhead strips. All inputs push into the live pub/sub channels.

import { oklchPalette, setLivePalette, setLivePlayhead } from "./waveform_ffi.mjs";
import { setKeyboardEnabled } from "./audio_ffi.mjs";

const COLOR_DEFAULTS = {
  hue: 212,
  saturation: 0.1,
  hueSpread: 38,
  contrast: 1,
  lightness: 0.3,
};

const PLAYHEAD_DEFAULTS = {
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

const COLOR_SLIDERS = [
  { key: "contrast", label: "CTR", min: -1, max: 1, step: 0.01 },
  { key: "lightness", label: "LGT", min: 0.1, max: 0.9, step: 0.01 },
  { key: "saturation", label: "SAT", min: 0, max: 0.4, step: 0.01 },
  { key: "hue", label: "HUE", min: 0, max: 360, step: 1 },
  { key: "hueSpread", label: "SPR", min: 0, max: 180, step: 1 },
];

const PLAYHEAD_SLIDERS = [
  { key: "leftPct", label: "L%", min: 0, max: 20, step: 0.1 },
  { key: "centerPx", label: "Cpx", min: 0, max: 40, step: 1 },
  { key: "rightPct", label: "R%", min: 0, max: 20, step: 0.1 },
];

const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

const MODE_SELECTS = [
  { key: "leftMode", label: "L MIX" },
  { key: "centerMode", label: "C MIX" },
  { key: "rightMode", label: "R MIX" },
];

const COLOR_OPTIONS = ["black", "white", "invert", "triad1", "triad2"];

const COLOR_MULTI = [
  { key: "leftColors", label: "L COL" },
  { key: "centerColors", label: "C COL" },
  { key: "rightColors", label: "R COL" },
];

export function mountColorControls(root, innerId) {
  const wrap = root?.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!wrap || wrap.__apww_cc) return;
  wrap.__apww_cc = true;

  const colorState = { ...COLOR_DEFAULTS };
  const phState = {
    ...PLAYHEAD_DEFAULTS,
    leftColors: [...PLAYHEAD_DEFAULTS.leftColors],
    centerColors: [...PLAYHEAD_DEFAULTS.centerColors],
    rightColors: [...PLAYHEAD_DEFAULTS.rightColors],
  };

  const container = document.createElement("div");
  Object.assign(container.style, {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    fontFamily: "sans-serif",
    fontSize: "11px",
    userSelect: "none",
  });
  if (root.host) root.host.style.display = "block";

  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "flex-end",
  });
  container.appendChild(row);

  const readout = document.createElement("pre");
  Object.assign(readout.style, {
    margin: "0",
    padding: "8px 10px",
    background: "#f4f4f4",
    border: "1px solid #ddd",
    borderRadius: "4px",
    fontSize: "10px",
    fontFamily: "ui-monospace, monospace",
    whiteSpace: "pre-wrap",
    color: "#333",
  });
  container.appendChild(readout);

  wrap.appendChild(container);

  const refreshReadout = () => {
    readout.textContent = JSON.stringify(
      { palette: colorState, playhead: phState },
      null,
      2,
    );
  };
  const pushColor = () => {
    setLivePalette(oklchPalette(colorState));
    refreshReadout();
  };
  const pushPlayhead = () => {
    setLivePlayhead(phState);
    refreshReadout();
  };

  const sep = () => {
    const s = document.createElement("div");
    Object.assign(s.style, {
      width: "1px",
      height: "120px",
      background: "#ddd",
      alignSelf: "flex-end",
    });
    return s;
  };

  const buildSlider = (s, state, push) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      width: "32px",
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
    return col;
  };

  const buildSelect = (def, state, push) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
    });
    const select = document.createElement("select");
    for (const m of BLEND_MODES) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === state[def.key]) opt.selected = true;
      select.appendChild(opt);
    }
    Object.assign(select.style, { height: "24px", fontSize: "11px" });
    select.addEventListener("change", () => {
      state[def.key] = select.value;
      push();
    });
    const lbl = document.createElement("span");
    lbl.textContent = def.label;
    lbl.style.color = "#555";
    col.appendChild(select);
    col.appendChild(lbl);
    return col;
  };

  const buildMulti = (def, state, push) => {
    const col = document.createElement("div");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "2px",
    });
    for (const name of COLOR_OPTIONS) {
      const r = document.createElement("label");
      Object.assign(r.style, {
        display: "flex",
        gap: "4px",
        alignItems: "center",
      });
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state[def.key].includes(name);
      cb.addEventListener("change", () => {
        const cur = new Set(state[def.key]);
        if (cb.checked) cur.add(name);
        else cur.delete(name);
        state[def.key] = [...cur];
        push();
      });
      const txt = document.createElement("span");
      txt.textContent = name;
      txt.style.color = "#555";
      r.appendChild(cb);
      r.appendChild(txt);
      col.appendChild(r);
    }
    const lbl = document.createElement("span");
    lbl.textContent = def.label;
    Object.assign(lbl.style, { color: "#555", marginTop: "4px" });
    col.appendChild(lbl);
    return col;
  };

  const buildBoolToggle = (label, initial, onChange) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
    });
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = initial;
    cb.addEventListener("change", () => onChange(cb.checked));
    const lbl = document.createElement("span");
    lbl.textContent = label;
    lbl.style.color = "#555";
    col.appendChild(cb);
    col.appendChild(lbl);
    return col;
  };

  for (const s of COLOR_SLIDERS) row.appendChild(buildSlider(s, colorState, pushColor));
  row.appendChild(sep());
  for (const s of PLAYHEAD_SLIDERS) row.appendChild(buildSlider(s, phState, pushPlayhead));
  row.appendChild(
    buildBoolToggle("L FILL", phState.leftFill, (v) => {
      phState.leftFill = v;
      pushPlayhead();
    }),
  );
  row.appendChild(
    buildBoolToggle("Pause with space", true, (v) => setKeyboardEnabled(v)),
  );
  for (const s of MODE_SELECTS) row.appendChild(buildSelect(s, phState, pushPlayhead));
  for (const s of COLOR_MULTI) row.appendChild(buildMulti(s, phState, pushPlayhead));

  pushColor();
  pushPlayhead();
}
