// Sliders + selects + checkboxes driving the OKLCH palette and the three
// playhead strips. Plain monospace, b&w. Groups laid out in separate rows.

import { oklchPalette, setLivePalette, setLivePlayhead } from "./waveform_ffi.mjs";
import { setKeyboardEnabled } from "./audio_ffi.mjs";

const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

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
  { key: "contrast", label: "ctr", min: -1, max: 1, step: 0.01 },
  { key: "lightness", label: "lgt", min: 0.1, max: 0.9, step: 0.01 },
  { key: "saturation", label: "sat", min: 0, max: 0.4, step: 0.01 },
  { key: "hue", label: "hue", min: 0, max: 360, step: 1 },
  { key: "hueSpread", label: "spr", min: 0, max: 180, step: 1 },
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
  { key: "leftMode", label: "L mix" },
  { key: "centerMode", label: "C mix" },
  { key: "rightMode", label: "R mix" },
];

const COLOR_OPTIONS = ["black", "white", "invert", "triad1", "triad2"];

const COLOR_MULTI = [
  { key: "leftColors", label: "L col" },
  { key: "centerColors", label: "C col" },
  { key: "rightColors", label: "R col" },
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
    gap: "14px",
    fontFamily: MONO,
    fontSize: "11px",
    color: "#000",
    userSelect: "none",
  });
  if (root.host) root.host.style.display = "block";

  const readout = document.createElement("pre");
  Object.assign(readout.style, {
    margin: "0",
    padding: "10px 12px",
    background: "#fff",
    border: "1px solid #000",
    fontSize: "11px",
    fontFamily: MONO,
    whiteSpace: "pre-wrap",
    color: "#000",
  });

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

  const group = (label, children) => {
    const wrap = document.createElement("section");
    Object.assign(wrap.style, {
      display: "flex",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: "14px",
      alignItems: "flex-end",
      borderTop: "1px dashed #000",
      paddingTop: "10px",
    });
    const lbl = document.createElement("div");
    Object.assign(lbl.style, {
      width: "70px",
      alignSelf: "center",
      fontFamily: MONO,
      color: "#000",
    });
    lbl.textContent = label;
    wrap.appendChild(lbl);
    for (const c of children) wrap.appendChild(c);
    return wrap;
  };

  const buildSlider = (s, state, push) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "4px",
      width: "36px",
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
      height: "110px",
      padding: "0",
      accentColor: "#000",
    });
    input.addEventListener("input", () => {
      state[s.key] = parseFloat(input.value);
      push();
    });
    const lbl = document.createElement("span");
    lbl.textContent = s.label;
    lbl.style.color = "#000";
    col.appendChild(input);
    col.appendChild(lbl);
    return col;
  };

  const buildSelect = (def, state, push) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "4px",
      minWidth: "120px",
    });
    const select = document.createElement("select");
    for (const m of BLEND_MODES) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === state[def.key]) opt.selected = true;
      select.appendChild(opt);
    }
    Object.assign(select.style, {
      height: "24px",
      fontSize: "11px",
      fontFamily: MONO,
      border: "1px solid #000",
      background: "#fff",
      color: "#000",
    });
    select.addEventListener("change", () => {
      state[def.key] = select.value;
      push();
    });
    const lbl = document.createElement("span");
    lbl.textContent = def.label;
    lbl.style.color = "#000";
    col.appendChild(lbl);
    col.appendChild(select);
    return col;
  };

  const buildMulti = (def, state, push) => {
    const col = document.createElement("div");
    Object.assign(col.style, {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "2px",
      minWidth: "110px",
    });
    const lbl = document.createElement("span");
    lbl.textContent = def.label;
    Object.assign(lbl.style, { color: "#000", marginBottom: "2px" });
    col.appendChild(lbl);
    for (const name of COLOR_OPTIONS) {
      const r = document.createElement("label");
      Object.assign(r.style, {
        display: "flex",
        gap: "4px",
        alignItems: "center",
        color: "#000",
      });
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = state[def.key].includes(name);
      cb.style.accentColor = "#000";
      cb.addEventListener("change", () => {
        const cur = new Set(state[def.key]);
        if (cb.checked) cur.add(name);
        else cur.delete(name);
        state[def.key] = [...cur];
        push();
      });
      const txt = document.createElement("span");
      txt.textContent = name;
      r.appendChild(cb);
      r.appendChild(txt);
      col.appendChild(r);
    }
    return col;
  };

  const buildBoolToggle = (label, initial, onChange) => {
    const col = document.createElement("label");
    Object.assign(col.style, {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      color: "#000",
    });
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = initial;
    cb.style.accentColor = "#000";
    cb.addEventListener("change", () => onChange(cb.checked));
    const lbl = document.createElement("span");
    lbl.textContent = label;
    col.appendChild(cb);
    col.appendChild(lbl);
    return col;
  };

  // Row 1: palette sliders
  container.appendChild(
    group(
      "palette",
      COLOR_SLIDERS.map((s) => buildSlider(s, colorState, pushColor)),
    ),
  );
  // Row 2: playhead width sliders + fill toggle
  container.appendChild(
    group("playhead", [
      ...PLAYHEAD_SLIDERS.map((s) => buildSlider(s, phState, pushPlayhead)),
      buildBoolToggle("L fill", phState.leftFill, (v) => {
        phState.leftFill = v;
        pushPlayhead();
      }),
    ]),
  );
  // Row 3: blend modes
  container.appendChild(
    group(
      "blend",
      MODE_SELECTS.map((s) => buildSelect(s, phState, pushPlayhead)),
    ),
  );
  // Row 4: stripe colors
  container.appendChild(
    group(
      "colors",
      COLOR_MULTI.map((s) => buildMulti(s, phState, pushPlayhead)),
    ),
  );
  // Row 5: input + readout
  container.appendChild(
    group("input", [
      buildBoolToggle("pause with space", true, (v) =>
        setKeyboardEnabled(v),
      ),
    ]),
  );
  container.appendChild(readout);

  pushColor();
  pushPlayhead();
}
