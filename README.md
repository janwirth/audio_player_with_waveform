# audio_player_with_waveform

[![Package Version](https://img.shields.io/hexpm/v/audio_player_with_waveform)](https://hex.pm/packages/audio_player_with_waveform)
[![Hex Docs](https://img.shields.io/badge/hex-docs-ffaff3)](https://hexdocs.pm/audio_player_with_waveform/)

Self-contained inline audio player + waveform for **Lustre**, shipped as
custom elements. Give it a URL — it decodes, renders the waveform, drives a
single `<audio>` element shared across the page, and publishes status events.

Ported from the React player in
[`janwirth/react-web-audio-platform`](https://github.com/janwirth/react-web-audio-platform/tree/main/packages/framework/src/media);
custom-element wiring follows
[`janwirth/kompas`](https://github.com/janwirth/kompas).

## Install

```sh
gleam add audio_player_with_waveform
```

## API proposal

One global custom element holds playback state. View functions render the
waveform / status; effect helpers send commands to the host from `update`.

```gleam
import audio_player_with_waveform as ap
import lustre
import lustre/element/html
import lustre/event

pub type Msg { Toggle(String) | Seek(String, Float) }

pub fn main() {
  let assert Ok(_) = ap.register()              // register custom elements
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
}

fn update(model, msg) {
  case msg {
    Toggle(url)    -> #(model, ap.toggle(url))
    Seek(url, pct) -> #(model, ap.seek(url, pct))
  }
}

fn view(_model) {
  html.div([], [
    ap.host(),                                   // singleton, mount once
    ap.waveform(url: "/track.mp3",
                opts: [ap.palette("vibrant"), ap.height(64)]),
    html.button([event.on_click(Toggle("/track.mp3"))], [html.text("⏯")]),
    ap.now_playing(),                            // "▶ 0:42 / 3:14"
  ])
}
```

Click the waveform to seek. Multiple `ap.waveform(...)` for different URLs
share the single audio element; the most-recently-played URL wins.

## Module surface

| | |
|---|---|
| `ap.register()` | Register all custom elements. Call once at startup. |
| `ap.host()` | Global player. Mount once. |
| `ap.waveform(url:, opts:)` | Inline waveform; click to seek; live playhead. |
| `ap.now_playing()` | Auto-updating `"▶ 0:42 / 3:14"` line. |
| `ap.stereo()` | Tiny live spectrum visualiser (see below). |
| `ap.queue_status()` | Debug badge showing render-queue state (see below). |
| `ap.color_controls()` | Sliders + selects + checkboxes driving the live OKLCH palette and playhead strip styling. |
| `ap.palette(name)` | `"classic" \| "vibrant" \| "dark" \| "neon" \| "monochrome"`. Omit to use the live palette from `color_controls`. |
| `ap.height(px)` | Waveform height. |
| `ap.size(px)` | Square size for `ap.stereo()`. |
| `ap.play(url)` / `ap.pause()` / `ap.toggle(url)` / `ap.seek(url, pct)` | `Effect(msg)` — return from `update`. |
| `ap.enable_keyboard(bool)` | Toggle the global Space = play/pause hotkey. |

## Little waveform viz (`ap.stereo`)

A 32×32 px live spectrum analyser tapped off the singleton audio element via
`createMediaElementSource` → `ChannelSplitter` → two `AnalyserNode`s (one per
L/R channel). For each band, the louder of L/R is plotted; bands grow from
the centre, the low end on the right.

```gleam
fn view(_model) {
  html.div([attribute.style([#("display", "flex"), #("gap", "8px")])], [
    ap.host(),
    ap.stereo(),                            // default 32 px
    // or scale it up:
    ap.element_with([ap.size(64)], ap.stereo()),
  ])
}
```

Notes:
- The AudioContext is deferred until the first user gesture (click / tap /
  keydown) to satisfy browser autoplay policy — until then the viz renders
  but stays empty.
- One instance per page is enough; subsequent mounts share the analyser.
- Default size: `32 px`. Override with `ap.size(N)` as an attribute on the
  element if you wire it through `ap.host_attribute(...)` (see source for
  the attribute helper).

## Queue debug info (`ap.queue_status`)

Waveform rendering uses a LIFO worker pool (max 3 in flight, queue capped at
50) with an IndexedDB cache. `ap.queue_status()` is a tiny monospace badge
that subscribes to the pool's status events:

```
queue: 2 active · 7 pending · cache: 18
```

- `active` — pipeline jobs currently fetching, decoding, or running spectral
  analysis on a worker.
- `pending` — URLs waiting in the LIFO stack. Newest scroll-ins run first;
  anything pushed over the queue cap (50) is dropped from the bottom.
- `cache` — number of `{url → {waveformData, spectralData}}` entries in
  IndexedDB (`apww-waveform-cache` / `renderData` store). Cached entries
  skip the worker entirely on next visit.

```gleam
fn view(_model) {
  html.div([], [
    ap.host(),
    ap.waveform(url: "/track.mp3", opts: []),
    ap.queue_status(),                      // drop anywhere
  ])
}
```

Useful while scrolling long playlists to verify backpressure is working: in
flight should hover at 3 under load, pending should never exceed 50.

## Status events

The host fires DOM CustomEvents on `window`. Subscribe directly if you want
your own UI:

- `apww:status` → `{ url, playing, currentTime, duration, position }` — fires
  on every `timeupdate` / `play` / `pause` / `seeked`.

The bundled `now_playing` and `queue_status` elements are 20-line wrappers
around these events; copy the patterns from `src/now_playing_ffi.mjs` or
`src/queue_status_ffi.mjs` for richer integrations.

## Development

```sh
gleam run -m lustre/dev start    # dev server with the demo in src/audio_player_with_waveform.gleam:main
gleam test
```
