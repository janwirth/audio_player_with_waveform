// Singleton HTMLAudioElement + global event bus for the player.
// One audio element per page. Status broadcast via window CustomEvents
// so any view fn (button, waveform) can emit msgs to the host.

const BUS = "apww:bus";
export const EVENTS = {
  PLAY: "apww:play",
  PAUSE: "apww:pause",
  TOGGLE: "apww:toggle",
  SEEK: "apww:seek",
  SET_SRC: "apww:set-src",
  STATUS: "apww:status",
  FFMPEG: "apww:ffmpeg-status",
};

let audioEl = null;
let currentSrc = null;

export function getAudio() {
  if (audioEl) return audioEl;
  audioEl = new Audio();
  audioEl.crossOrigin = "anonymous";
  audioEl.preload = "metadata";
  bindStatusEvents(audioEl);
  return audioEl;
}

export function attachAudioToHost(root, innerId) {
  const target = root?.getElementById
    ? root.getElementById(innerId) || root
    : root;
  const audio = getAudio();
  if (target && audio.parentNode !== target) {
    target.appendChild(audio);
  }
  return audio;
}

function bindStatusEvents(audio) {
  const emit = () => {
    window.dispatchEvent(
      new CustomEvent(EVENTS.STATUS, {
        detail: {
          url: currentSrc,
          playing: !audio.paused,
          currentTime: isFinite(audio.currentTime) ? audio.currentTime : 0,
          duration: isFinite(audio.duration) ? audio.duration : 0,
          position:
            audio.duration && isFinite(audio.duration)
              ? audio.currentTime / audio.duration
              : 0,
        },
      }),
    );
  };
  audio.addEventListener("timeupdate", emit);
  audio.addEventListener("play", emit);
  audio.addEventListener("pause", emit);
  audio.addEventListener("ended", emit);
  audio.addEventListener("loadedmetadata", emit);
  audio.addEventListener("loadeddata", emit);
  audio.addEventListener("seeked", emit);
}

export async function setSrc(url) {
  if (!url || currentSrc === url) return;
  const audio = getAudio();
  currentSrc = url;
  audio.src = url;
  audio.load();
}

export function play(url) {
  const audio = getAudio();
  const go = () => audio.play().catch((e) => console.error(e));
  if (url && url !== currentSrc) {
    setSrc(url).then(() => waitReady(audio, go));
  } else {
    go();
  }
}

export function pause() {
  getAudio().pause();
}

export function toggle(url) {
  const audio = getAudio();
  if (audio.paused) play(url);
  else audio.pause();
}

export function seekPercent(url, pct) {
  const audio = getAudio();
  const apply = () => {
    if (isFinite(audio.duration)) {
      audio.currentTime = Math.max(0, Math.min(1, pct)) * audio.duration;
      audio.play().catch((e) => console.error(e));
    }
  };
  if (url && url !== currentSrc) {
    setSrc(url).then(() => waitReady(audio, apply));
  } else {
    waitReady(audio, apply);
  }
}

function waitReady(audio, cb) {
  if (audio.readyState >= 1 && isFinite(audio.duration)) return cb();
  const handler = () => {
    audio.removeEventListener("loadedmetadata", handler);
    cb();
  };
  audio.addEventListener("loadedmetadata", handler);
}

// Listen for view-fn emitted commands and route to the audio element.
export function installBus() {
  if (window[BUS]) return;
  window[BUS] = true;
  setKeyboardEnabled(true);
  window.addEventListener(EVENTS.PLAY, (e) => play(e.detail?.url));
  window.addEventListener(EVENTS.PAUSE, () => pause());
  window.addEventListener(EVENTS.TOGGLE, (e) => toggle(e.detail?.url));
  window.addEventListener(EVENTS.SEEK, (e) =>
    seekPercent(e.detail?.url, e.detail?.percent ?? 0),
  );
  window.addEventListener(EVENTS.SET_SRC, (e) => setSrc(e.detail?.url));
}

// Dispatch helpers used from button/click view fns.
export function dispatchPlay(url) {
  window.dispatchEvent(new CustomEvent(EVENTS.PLAY, { detail: { url } }));
}
export function dispatchPause() {
  window.dispatchEvent(new CustomEvent(EVENTS.PAUSE));
}
export function dispatchToggle(url) {
  window.dispatchEvent(new CustomEvent(EVENTS.TOGGLE, { detail: { url } }));
}
export function dispatchSeek(url, percent) {
  window.dispatchEvent(
    new CustomEvent(EVENTS.SEEK, { detail: { url, percent } }),
  );
}

// ---- global keyboard handler --------------------------------------------
// When enabled, Space toggles play/pause anywhere on the page (except when
// the user is typing in an input / textarea / contenteditable element).

let keyboardListener = null;

export function setKeyboardEnabled(enabled) {
  if (enabled && !keyboardListener) {
    keyboardListener = (e) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      const audio = getAudio();
      if (audio.paused) audio.play().catch((err) => console.error(err));
      else audio.pause();
    };
    document.addEventListener("keydown", keyboardListener);
  } else if (!enabled && keyboardListener) {
    document.removeEventListener("keydown", keyboardListener);
    keyboardListener = null;
  }
}

// Subscribe — called from host element so it can re-render on status.
export function subscribeStatus(handler) {
  const fn = (e) => handler(e.detail);
  window.addEventListener(EVENTS.STATUS, fn);
  return () => window.removeEventListener(EVENTS.STATUS, fn);
}
export function subscribeFfmpegStatus(handler) {
  const fn = (e) => handler(e.detail);
  window.addEventListener(EVENTS.FFMPEG, fn);
  return () => window.removeEventListener(EVENTS.FFMPEG, fn);
}
