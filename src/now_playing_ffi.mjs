// Self-updating "now playing" display. Listens to status events and rewrites
// its own textContent — no Lustre re-renders involved.

const STATUS_EV = "apww:status";

function fmt(t) {
  if (!t || !isFinite(t)) return "0:00";
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor(t / 60);
  return `${m}:${s}`;
}

export function mountNowPlaying(root, innerId) {
  const el = root?.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!el || el.__apww_np) return;
  el.__apww_np = true;
  el.style.display = "inline-block";
  el.style.fontVariantNumeric = "tabular-nums";
  el.textContent = "—";
  window.addEventListener(STATUS_EV, (e) => {
    const d = e.detail || {};
    if (!d.url) {
      el.textContent = "—";
      return;
    }
    el.textContent = `${d.playing ? "▶" : "❚❚"} ${fmt(d.currentTime)} / ${fmt(
      d.duration,
    )}`;
  });
}
