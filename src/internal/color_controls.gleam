//// Pure Gleam/Lustre color + playhead + input controls.
////
//// State lives entirely in this component's model. On every update, the
//// model is JSON-encoded and pushed through the JS glue into the live
//// pubsub channels read by mounted waveforms.

import gleam/dynamic/decode
import gleam/float
import gleam/int
import gleam/json
import gleam/list
import gleam/string
import lustre
import lustre/attribute.{type Attribute, attribute, checked, selected}
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/event

pub const element_name: String = "audio-player-color-controls"

@external(javascript, "../color_controls_glue_ffi.mjs", "applyState")
fn ffi_apply(json_str: String) -> Nil

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

pub type Palette {
  Palette(
    contrast: Float,
    lightness: Float,
    saturation: Float,
    hue: Float,
    hue_spread: Float,
  )
}

pub type Playhead {
  Playhead(
    left_pct: Float,
    center_px: Float,
    right_pct: Float,
    left_mode: String,
    center_mode: String,
    right_mode: String,
    left_colors: List(String),
    center_colors: List(String),
    right_colors: List(String),
    left_fill: Bool,
  )
}

pub type Model {
  Model(palette: Palette, playhead: Playhead, kbd: Bool)
}

pub type Msg {
  SetContrast(Float)
  SetLightness(Float)
  SetSaturation(Float)
  SetHue(Float)
  SetHueSpread(Float)
  SetLeftPct(Float)
  SetCenterPx(Float)
  SetRightPct(Float)
  SetLeftMode(String)
  SetCenterMode(String)
  SetRightMode(String)
  ToggleLeftColor(String)
  ToggleCenterColor(String)
  ToggleRightColor(String)
  SetLeftFill(Bool)
  SetKbd(Bool)
}

fn initial_model() -> Model {
  Model(
    palette: Palette(
      contrast: 1.0,
      lightness: 0.3,
      saturation: 0.1,
      hue: 212.0,
      hue_spread: 38.0,
    ),
    playhead: Playhead(
      left_pct: 1.0,
      center_px: 6.0,
      right_pct: 0.0,
      left_mode: "saturation",
      center_mode: "color-burn",
      right_mode: "overlay",
      left_colors: ["white"],
      center_colors: ["invert", "triad1", "triad2"],
      right_colors: ["black"],
      left_fill: True,
    ),
    kbd: True,
  )
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

fn toggle(xs: List(String), x: String) -> List(String) {
  case list.contains(xs, x) {
    True -> list.filter(xs, fn(y) { y != x })
    False -> list.append(xs, [x])
  }
}

fn init(_flags: Nil) -> #(Model, Effect(Msg)) {
  let m = initial_model()
  #(m, push_effect(m))
}

fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  let p = model.palette
  let h = model.playhead
  let next = case msg {
    SetContrast(v) -> Model(..model, palette: Palette(..p, contrast: v))
    SetLightness(v) -> Model(..model, palette: Palette(..p, lightness: v))
    SetSaturation(v) -> Model(..model, palette: Palette(..p, saturation: v))
    SetHue(v) -> Model(..model, palette: Palette(..p, hue: v))
    SetHueSpread(v) -> Model(..model, palette: Palette(..p, hue_spread: v))
    SetLeftPct(v) -> Model(..model, playhead: Playhead(..h, left_pct: v))
    SetCenterPx(v) -> Model(..model, playhead: Playhead(..h, center_px: v))
    SetRightPct(v) -> Model(..model, playhead: Playhead(..h, right_pct: v))
    SetLeftMode(v) -> Model(..model, playhead: Playhead(..h, left_mode: v))
    SetCenterMode(v) -> Model(..model, playhead: Playhead(..h, center_mode: v))
    SetRightMode(v) -> Model(..model, playhead: Playhead(..h, right_mode: v))
    ToggleLeftColor(c) ->
      Model(
        ..model,
        playhead: Playhead(..h, left_colors: toggle(h.left_colors, c)),
      )
    ToggleCenterColor(c) ->
      Model(
        ..model,
        playhead: Playhead(..h, center_colors: toggle(h.center_colors, c)),
      )
    ToggleRightColor(c) ->
      Model(
        ..model,
        playhead: Playhead(..h, right_colors: toggle(h.right_colors, c)),
      )
    SetLeftFill(v) -> Model(..model, playhead: Playhead(..h, left_fill: v))
    SetKbd(v) -> Model(..model, kbd: v)
  }
  #(next, push_effect(next))
}

fn push_effect(model: Model) -> Effect(Msg) {
  effect.from(fn(_dispatch) { ffi_apply(encode(model)) })
}

fn encode(m: Model) -> String {
  json.to_string(
    json.object([
      #("palette", encode_palette(m.palette)),
      #("playhead", encode_playhead(m.playhead)),
      #("kbd", json.bool(m.kbd)),
    ]),
  )
}

fn encode_palette(p: Palette) -> json.Json {
  json.object([
    #("contrast", json.float(p.contrast)),
    #("lightness", json.float(p.lightness)),
    #("saturation", json.float(p.saturation)),
    #("hue", json.float(p.hue)),
    #("hueSpread", json.float(p.hue_spread)),
  ])
}

fn encode_playhead(h: Playhead) -> json.Json {
  json.object([
    #("leftPct", json.float(h.left_pct)),
    #("centerPx", json.float(h.center_px)),
    #("rightPct", json.float(h.right_pct)),
    #("leftMode", json.string(h.left_mode)),
    #("centerMode", json.string(h.center_mode)),
    #("rightMode", json.string(h.right_mode)),
    #("leftColors", json.array(h.left_colors, json.string)),
    #("centerColors", json.array(h.center_colors, json.string)),
    #("rightColors", json.array(h.right_colors, json.string)),
    #("leftFill", json.bool(h.left_fill)),
  ])
}

// ---------------------------------------------------------------------------
// Event decoders
// ---------------------------------------------------------------------------

fn parse_num(s: String) -> Result(Float, Nil) {
  case float.parse(s) {
    Ok(v) -> Ok(v)
    Error(_) ->
      case int.parse(s) {
        Ok(i) -> Ok(int.to_float(i))
        Error(_) -> Error(Nil)
      }
  }
}

fn on_range(handler: fn(Float) -> Msg) -> Attribute(Msg) {
  event.on("input", {
    use s <- decode.subfield(["target", "value"], decode.string)
    case parse_num(s) {
      Ok(v) -> decode.success(handler(v))
      Error(_) -> decode.failure(handler(0.0), "float")
    }
  })
}

fn on_select(handler: fn(String) -> Msg) -> Attribute(Msg) {
  event.on("change", {
    use s <- decode.subfield(["target", "value"], decode.string)
    decode.success(handler(s))
  })
}

fn on_check(handler: fn(Bool) -> Msg) -> Attribute(Msg) {
  event.on("change", {
    use b <- decode.subfield(["target", "checked"], decode.bool)
    decode.success(handler(b))
  })
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const mono: String = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

const blend_modes: List(String) = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion", "hue", "saturation", "color", "luminosity",
]

const color_options: List(String) = ["black", "white", "invert", "triad1", "triad2"]

fn view(model: Model) -> Element(Msg) {
  let container_style =
    "display:flex;flex-direction:column;gap:14px;"
    <> "font-family: " <> mono <> ";font-size:11px;color:#000;"
    <> "user-select:none;"
  html.div([attribute("style", container_style)], [
    row("palette", [
      slider("ctr", model.palette.contrast, -1.0, 1.0, 0.01, SetContrast),
      slider("lgt", model.palette.lightness, 0.1, 0.9, 0.01, SetLightness),
      slider("sat", model.palette.saturation, 0.0, 0.4, 0.01, SetSaturation),
      slider("hue", model.palette.hue, 0.0, 360.0, 1.0, SetHue),
      slider("spr", model.palette.hue_spread, 0.0, 180.0, 1.0, SetHueSpread),
    ]),
    row("playhead", [
      slider("L%", model.playhead.left_pct, 0.0, 20.0, 0.1, SetLeftPct),
      slider("Cpx", model.playhead.center_px, 0.0, 40.0, 1.0, SetCenterPx),
      slider("R%", model.playhead.right_pct, 0.0, 20.0, 0.1, SetRightPct),
      check_box("L fill", model.playhead.left_fill, SetLeftFill),
    ]),
    row("blend", [
      blend_select("L mix", model.playhead.left_mode, SetLeftMode),
      blend_select("C mix", model.playhead.center_mode, SetCenterMode),
      blend_select("R mix", model.playhead.right_mode, SetRightMode),
    ]),
    row("colors", [
      color_picker("L col", model.playhead.left_colors, ToggleLeftColor),
      color_picker("C col", model.playhead.center_colors, ToggleCenterColor),
      color_picker("R col", model.playhead.right_colors, ToggleRightColor),
    ]),
    row("input", [check_box("pause with space", model.kbd, SetKbd)]),
    readout(model),
  ])
}

fn row(label: String, children: List(Element(Msg))) -> Element(Msg) {
  let style =
    "display:flex;flex-direction:row;flex-wrap:wrap;gap:14px;"
    <> "align-items:flex-end;border-top:1px dashed #000;padding-top:10px;"
  let label_style = "width:70px;align-self:center;font-family: " <> mono <> ";"
  let head = html.div([attribute("style", label_style)], [html.text(label)])
  html.section([attribute("style", style)], [head, ..children])
}

fn slider(
  label: String,
  value: Float,
  min: Float,
  max: Float,
  step: Float,
  to_msg: fn(Float) -> Msg,
) -> Element(Msg) {
  let col_style =
    "display:flex;flex-direction:column;align-items:center;gap:4px;width:36px;"
  let range_style =
    "writing-mode:vertical-lr;direction:rtl;width:20px;height:110px;"
    <> "padding:0;accent-color:#000;"
  html.label([attribute("style", col_style)], [
    html.input([
      attribute("type", "range"),
      attribute("min", float.to_string(min)),
      attribute("max", float.to_string(max)),
      attribute("step", float.to_string(step)),
      attribute("value", float.to_string(value)),
      attribute("style", range_style),
      on_range(to_msg),
    ]),
    html.span([], [html.text(label)]),
  ])
}

fn blend_select(
  label: String,
  current: String,
  to_msg: fn(String) -> Msg,
) -> Element(Msg) {
  let col_style =
    "display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:120px;"
  let sel_style =
    "height:24px;font-size:11px;font-family: "
    <> mono
    <> ";border:1px solid #000;background:#fff;color:#000;"
  html.label([attribute("style", col_style)], [
    html.span([], [html.text(label)]),
    html.select(
      [attribute("style", sel_style), on_select(to_msg)],
      list.map(blend_modes, fn(name) {
        html.option(
          [attribute("value", name), selected(name == current)],
          name,
        )
      }),
    ),
  ])
}

fn color_picker(
  label: String,
  selected_now: List(String),
  to_msg: fn(String) -> Msg,
) -> Element(Msg) {
  let col_style =
    "display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:110px;"
  let lbl_style = "color:#000;margin-bottom:2px;"
  let opt_style = "display:flex;gap:4px;align-items:center;color:#000;"
  let head = html.span([attribute("style", lbl_style)], [html.text(label)])
  let opts = list.map(color_options, fn(name) {
    html.label([attribute("style", opt_style)], [
      html.input([
        attribute("type", "checkbox"),
        attribute("style", "accent-color:#000;"),
        checked(list.contains(selected_now, name)),
        on_check(fn(_b) { to_msg(name) }),
      ]),
      html.span([], [html.text(name)]),
    ])
  })
  html.div([attribute("style", col_style)], [head, ..opts])
}

fn check_box(label: String, value: Bool, to_msg: fn(Bool) -> Msg) -> Element(Msg) {
  let style = "display:flex;align-items:center;gap:6px;color:#000;"
  html.label([attribute("style", style)], [
    html.input([
      attribute("type", "checkbox"),
      attribute("style", "accent-color:#000;"),
      checked(value),
      on_check(to_msg),
    ]),
    html.span([], [html.text(label)]),
  ])
}

fn readout(model: Model) -> Element(Msg) {
  let style =
    "margin:0;padding:10px 12px;background:#fff;border:1px solid #000;"
    <> "font-size:11px;font-family: " <> mono <> ";"
    <> "white-space:pre-wrap;color:#000;"
  html.pre([attribute("style", style)], [html.text(pretty(encode(model)))])
}

// Very small pretty-printer: just add line breaks after every comma + colon
// so the readout is more readable than compact JSON.
fn pretty(s: String) -> String {
  s
  |> string.replace(each: ",", with: ",\n  ")
  |> string.replace(each: "{", with: "{\n  ")
  |> string.replace(each: "}", with: "\n}")
  |> string.replace(each: "[", with: "[")
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

pub fn register() -> Result(Nil, lustre.Error) {
  case lustre.is_registered(element_name) {
    True -> Ok(Nil)
    False ->
      lustre.register(lustre.component(init, update, view, []), element_name)
  }
}
