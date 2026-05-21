// Helpers used by Gleam components for DOM/timing things
// that Lustre doesn't expose directly.

export function intToString(n) {
  return String(n);
}

export function getElementById(id) {
  return document.getElementById(id);
}

export function nextFrame(cb) {
  requestAnimationFrame(cb);
}
