# audio_player_with_waveform

[![Package Version](https://img.shields.io/hexpm/v/audio_player_with_waveform)](https://hex.pm/packages/audio_player_with_waveform)
[![Hex Docs](https://img.shields.io/badge/hex-docs-ffaff3)](https://hexdocs.pm/audio_player_with_waveform/)

Self-contained inline audio player + waveform for **Lustre**, shipped as
custom elements. Give it a URL — it fetches, transcodes any format the
browser can't play (via ffmpeg.wasm loaded on demand from CDN), renders the
waveform, drives an `<audio>` element, and publishes status events.

Ported from the React player in
[`janwirth/react-web-audio-platform`](https://github.com/janwirth/react-web-audio-platform/tree/main/packages/framework/src/media);
ffmpeg loading + custom-element wiring follows
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
import lustre/effect
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
    ap.host(),                                  // singleton, mount once
    ap.waveform(url: "/track.flac",
                opts: [ap.palette("vibrant"), ap.height(64)]),
    html.button([event.on_click(Toggle("/track.flac"))], [html.text("⏯")]),
    ap.now_playing(),                           // auto-updates "▶ 0:42 / 3:14"
  ])
}
```

That's the whole surface. Format unsupported (e.g. `.flac`, `.wav`)? The host
silently loads ffmpeg.wasm and transcodes to MP3 — the waveform and playback
just work. Clicking on the waveform seeks. Multiple `ap.waveform(...)` for
different URLs share the single audio element.

### Module surface

| | |
|---|---|
| `ap.register()` | Register the custom elements. Call once at startup. |
| `ap.host()` | Global player element. Mount once. |
| `ap.waveform(url:, opts:)` | Inline waveform; click to seek. |
| `ap.now_playing()` | Auto-updating "▶ time / duration" line. |
| `ap.palette(name)` | `"classic" \| "vibrant" \| "dark" \| "neon" \| "monochrome"` |
| `ap.height(px)` | Waveform height. |
| `ap.play(url)` / `ap.pause()` / `ap.toggle(url)` / `ap.seek(url, pct)` | `Effect(msg)` — return from `update`. |

### Status events

The host fires DOM CustomEvents on `window`:

- `apww:status` → `{ url, playing, currentTime, duration, position }`
- `apww:ffmpeg-status` → `{ state: "loading" | "transcoding" | "ready" | "error", progress?, error? }`

Subscribe via FFI for richer integrations; the `now_playing` element shows
how (see `src/now_playing_ffi.mjs`).

## Development

```sh
gleam run -m lustre/dev start    # dev server with the demo in src/demo.gleam
gleam test
```

ffmpeg.wasm needs cross-origin isolation for SharedArrayBuffer in some
browsers — Lustre's dev server ships with COOP/COEP headers; in production,
set them yourself.
