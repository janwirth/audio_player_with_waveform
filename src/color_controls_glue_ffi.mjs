// Thin glue: Gleam-side color-controls component owns the state and serializes
// it to JSON; this FFI parses it and pushes into the live pubsub channels.

import {
  oklchPalette,
  setLivePalette,
  setLivePlayhead,
} from "./waveform_ffi.mjs";
import { setKeyboardEnabled } from "./audio_ffi.mjs";

export function applyState(jsonStr) {
  let s;
  try {
    s = JSON.parse(jsonStr);
  } catch (e) {
    console.error("apww color-controls: bad json", e);
    return;
  }
  if (s.palette) {
    setLivePalette(oklchPalette(s.palette));
  }
  if (s.playhead) {
    setLivePlayhead(s.playhead);
  }
  if (typeof s.kbd === "boolean") {
    setKeyboardEnabled(s.kbd);
  }
}
