//// Self-contained audio player + waveform for Lustre.
////
//// One global custom element holds the playback state; effect helpers
//// emit commands to it via DOM CustomEvents and read status the same way.
//// Pass a URL — the host fetches metadata, transcodes via ffmpeg.wasm when
//// the format isn't browser-playable, and publishes status.

import gleam/result
import lustre
import lustre/attribute.{type Attribute, attribute, class}
import lustre/effect.{type Effect}
import lustre/element.{type Element, element}
import lustre/element/html
import lustre/event

import internal/color_controls
import internal/host
import internal/now_playing
import internal/waveform

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/// Register the custom elements with the browser. Call once at app start,
/// before your Lustre app first renders.
pub fn register() -> Result(Nil, lustre.Error) {
  use _ <- result.try(host.register())
  use _ <- result.try(waveform.register())
  use _ <- result.try(now_playing.register())
  color_controls.register()
}

// ---------------------------------------------------------------------------
// Custom elements
// ---------------------------------------------------------------------------

/// The global player. Mount **once** at the top of your view. Holds the
/// `<audio>` element and listens for command events from the effect helpers.
pub fn host() -> Element(msg) {
  element(host.element_name, [], [])
}

/// Inline waveform. Decodes the audio at `url`, renders it, draws a playhead
/// from playback status, and seeks on click.
pub fn waveform(
  url url: String,
  opts opts: List(Attribute(msg)),
) -> Element(msg) {
  element(waveform.element_name, [attribute("url", url), ..opts], [])
}

/// Auto-updating status line (▶ 0:42 / 3:14). Self-listens to status events.
pub fn now_playing() -> Element(msg) {
  element(now_playing.element_name, [], [])
}

/// Five vertical sliders driving the OKLCH waveform palette:
/// contrast, lightness, saturation, hue, hue-spread. Any `waveform(...)`
/// without an explicit `palette(...)` opts into the live palette and
/// re-renders as sliders move.
pub fn color_controls() -> Element(msg) {
  element(color_controls.element_name, [], [])
}

// ---------------------------------------------------------------------------
// Waveform attributes
// ---------------------------------------------------------------------------

/// Named palette: `"classic" | "vibrant" | "dark" | "neon" | "monochrome"`.
pub fn palette(name: String) -> Attribute(msg) {
  attribute("palette", name)
}

/// Waveform render height in CSS pixels.
pub fn height(px: Int) -> Attribute(msg) {
  attribute("height", int_to_string(px))
}

// ---------------------------------------------------------------------------
// Effect helpers — dispatch from your `update`.
// They fire DOM CustomEvents that the host element listens for.
// ---------------------------------------------------------------------------

/// Play (or resume) `url` on the global player.
pub fn play(url: String) -> Effect(msg) {
  effect.from(fn(_dispatch) { ffi_dispatch_play(url) })
}

/// Pause the global player.
pub fn pause() -> Effect(msg) {
  effect.from(fn(_dispatch) { ffi_dispatch_pause() })
}

/// Toggle play / pause for `url`.
pub fn toggle(url: String) -> Effect(msg) {
  effect.from(fn(_dispatch) { ffi_dispatch_toggle(url) })
}

/// Seek to `percent` (0.0 — 1.0) and resume.
pub fn seek(url: String, percent: Float) -> Effect(msg) {
  effect.from(fn(_dispatch) { ffi_dispatch_seek(url, percent) })
}

// ---------------------------------------------------------------------------
// FFI
// ---------------------------------------------------------------------------

@external(javascript, "./audio_ffi.mjs", "dispatchPlay")
fn ffi_dispatch_play(url: String) -> Nil

@external(javascript, "./audio_ffi.mjs", "dispatchPause")
fn ffi_dispatch_pause() -> Nil

@external(javascript, "./audio_ffi.mjs", "dispatchToggle")
fn ffi_dispatch_toggle(url: String) -> Nil

@external(javascript, "./audio_ffi.mjs", "dispatchSeek")
fn ffi_dispatch_seek(url: String, percent: Float) -> Nil

@external(javascript, "./component_ffi.mjs", "intToString")
fn int_to_string(n: Int) -> String

// ---------------------------------------------------------------------------
// Demo — runs when this module is invoked as the Lustre app entry.
// `gleam run -m lustre/dev start` boots `<project>.main()`. Library users
// importing this module never call `main` so this code is inert for them.
// ---------------------------------------------------------------------------

const demo_url: String = "https://samplelib.com/mp3/sample-40s.mp3"

type DemoMsg {
  TogglePlay(String)
  SeekHalf(String)
}

pub fn main() -> Nil {
  let assert Ok(_) = register()
  let app = lustre.application(demo_init, demo_update, demo_view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
  Nil
}

fn demo_init(_) -> #(Nil, Effect(DemoMsg)) {
  #(Nil, effect.none())
}

fn demo_update(_model: Nil, msg: DemoMsg) -> #(Nil, Effect(DemoMsg)) {
  case msg {
    TogglePlay(url) -> #(Nil, toggle(url))
    SeekHalf(url) -> #(Nil, seek(url, 0.5))
  }
}

fn demo_view(_model: Nil) -> Element(DemoMsg) {
  html.div([class("demo"), attribute("style", "padding: 24px; font-family: sans-serif; max-width: 720px;")], [
    host(),
    html.h1([], [html.text("audio_player_with_waveform — demo")]),
    waveform(url: demo_url, opts: [height(72)]),
    html.div([attribute("style", "display: flex; gap: 8px; align-items: center; margin-top: 12px;")], [
      html.button([event.on_click(TogglePlay(demo_url))], [html.text("⏯  Toggle")]),
      html.button([event.on_click(SeekHalf(demo_url))], [html.text("⤳ Seek 50%")]),
      now_playing(),
    ]),
    html.div([attribute("style", "margin-top: 24px;")], [color_controls()]),
  ])
}
