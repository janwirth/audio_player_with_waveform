//// Self-contained audio player + waveform for Lustre.
////
//// One global custom element holds the playback state; effect helpers
//// emit commands to it via DOM CustomEvents and read status the same way.
//// Pass a URL — the host fetches metadata, transcodes via ffmpeg.wasm when
//// the format isn't browser-playable, and publishes status.

import gleam/result
import lustre
import lustre/attribute.{type Attribute, attribute}
import lustre/effect.{type Effect}
import lustre/element.{type Element, element}
import lustre/element/html
import lustre/event

import internal/color_controls
import internal/host
import internal/now_playing
import internal/queue_status
import internal/stereo
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
  use _ <- result.try(stereo.register())
  use _ <- result.try(queue_status.register())
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

/// Live 32-band stereo spectrum (max of L/R channels). Tiny by default
/// (32px square); pass [`size(64)`](#size) to scale up.
pub fn stereo() -> Element(msg) {
  element(stereo.element_name, [], [])
}

/// Square px for the stereo visualiser.
pub fn size(px: Int) -> Attribute(msg) {
  attribute("size", int_to_string(px))
}

/// Self-updating waveform queue badge: shows worker-pool active + pending
/// counts plus persistent IndexedDB cache size. Max 3 workers, newest job
/// runs first (LIFO).
pub fn queue_status() -> Element(msg) {
  element(queue_status.element_name, [], [])
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

/// Toggle the global keyboard handler (Space = play/pause). Enabled by
/// default when the host element mounts. Dispatch from `update` whenever
/// the user toggles a "Pause with space" preference.
pub fn enable_keyboard(enabled: Bool) -> Effect(msg) {
  effect.from(fn(_dispatch) { ffi_set_keyboard_enabled(enabled) })
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

@external(javascript, "./audio_ffi.mjs", "setKeyboardEnabled")
fn ffi_set_keyboard_enabled(enabled: Bool) -> Nil

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
  let mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
  let page =
    "padding: 24px clamp(16px, 4vw, 56px);"
    <> "width: 100%; box-sizing: border-box;"
    <> "font-family: "
    <> mono
    <> "; color: #000; background: #fff; min-height: 100vh;"
  let title = "font-size: 18px; margin: 0; font-weight: 700;"
  let sub = "font-size: 12px; margin: 4px 0 18px 0; color: #000;"
  let card = "border: 1px solid #000; padding: 14px; background: #fff;"
  let row =
    "display:flex; gap:8px; align-items:center; margin-top:12px; flex-wrap:wrap;"
  let btn =
    "background:#fff; color:#000; border:1px solid #000; padding:4px 10px;"
    <> "font-family: inherit; font-size: 12px; cursor: pointer;"
  let now_box = "border: 1px solid #000; padding: 4px 8px; font-size: 12px;"
  let controls_card =
    "border: 1px solid #000; padding: 14px; margin-top: 16px; background: #fff;"

  let track = fn(label: String, url: String) {
    html.div([attribute("style", card <> "margin-top:12px;")], [
      html.div([attribute("style", "font-size:11px;margin-bottom:8px;opacity:.7;")], [
        html.text(label),
      ]),
      waveform(url: url, opts: [height(96)]),
      html.div([attribute("style", row)], [
        html.button(
          [event.on_click(TogglePlay(url)), attribute("style", btn)],
          [html.text("play / pause")],
        ),
        html.button(
          [event.on_click(SeekHalf(url)), attribute("style", btn)],
          [html.text("seek 50%")],
        ),
      ]),
    ])
  }

  html.div([attribute("style", page)], [
    host(),
    html.h1([attribute("style", title)], [html.text("audio_player_with_waveform")]),
    html.p([attribute("style", sub)], [
      html.text(
        "click the wave to seek · space toggles play · playing one swaps the active track",
      ),
    ]),
    html.div([attribute("style", row)], [
      stereo(),
      html.div([attribute("style", now_box)], [now_playing()]),
      html.div([attribute("style", now_box)], [queue_status()]),
    ]),
    track("track 1", demo_url),
    html.div([attribute("style", controls_card)], [color_controls()]),
  ])
}
