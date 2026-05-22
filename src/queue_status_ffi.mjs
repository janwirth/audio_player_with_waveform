// Self-updating waveform queue badge. Listens to the pool pubsub.

import { subscribeQueueStatus } from "./waveform_pool_ffi.mjs";

export function mountQueueStatus(root, innerId) {
  const el = root?.getElementById
    ? root.getElementById(innerId)
    : document.getElementById(innerId);
  if (!el || el.__apww_qs) return;
  el.__apww_qs = true;
  el.style.fontFamily = "ui-monospace, Menlo, Consolas, monospace";
  el.style.fontSize = "11px";
  subscribeQueueStatus(({ queued, active, cacheSize }) => {
    el.textContent =
      `queue: ${active} active · ${queued} pending · cache: ${cacheSize}`;
  });
}
