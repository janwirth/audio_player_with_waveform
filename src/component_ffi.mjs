// Helpers used by Gleam components for DOM/timing things
// that Lustre doesn't expose directly.

export function intToString(n) {
  return String(n);
}

// Inject a <link rel=stylesheet> once. Used by the cute demo to pull
// Mochiy Pop One + M PLUS Rounded 1c from Google Fonts.
export function injectStylesheet(href) {
  if (document.querySelector(`link[data-apww-font="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.apwwFont = href;
  document.head.appendChild(link);
}

export function getElementById(id) {
  return document.getElementById(id);
}

export function nextFrame(cb) {
  requestAnimationFrame(cb);
}
