// Lazy FFmpeg loader. Loads from CDN — no npm deps.
// Transcodes formats the browser can't play (e.g. flac/wav/m4a -> mp3).

const FFMPEG_VERSION = "0.12.15";
const UTIL_VERSION = "0.12.2";
const CORE_BASE =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const EV = "apww:ffmpeg-status";

let ffmpegInstance = null;
let loadingPromise = null;

function emit(detail) {
  window.dispatchEvent(new CustomEvent(EV, { detail }));
}

export function loadFfmpeg() {
  if (ffmpegInstance) {
    emit({ state: "ready" });
    return Promise.resolve(ffmpegInstance);
  }
  if (loadingPromise) return loadingPromise;

  emit({ state: "loading" });
  loadingPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import(/* @vite-ignore */ `https://esm.sh/@ffmpeg/ffmpeg@${FFMPEG_VERSION}`),
      import(/* @vite-ignore */ `https://esm.sh/@ffmpeg/util@${UTIL_VERSION}`),
    ]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) =>
      emit({
        state: "transcoding",
        progress: typeof progress === "number" ? progress : 0,
      }),
    );
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    emit({ state: "ready" });
    return ffmpeg;
  })().catch((err) => {
    emit({ state: "error", error: String(err) });
    loadingPromise = null;
    throw err;
  });
  return loadingPromise;
}

function extOf(url) {
  try {
    const u = new URL(url, window.location.href).pathname;
    const dot = u.lastIndexOf(".");
    return dot > 0 ? u.slice(dot + 1).toLowerCase() : "bin";
  } catch (_) {
    return "bin";
  }
}

export async function transcodeToMp3(url) {
  const ffmpeg = await loadFfmpeg();
  const ext = extOf(url);
  const inputName = `in.${ext}`;
  const outputName = "out.mp3";

  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  await ffmpeg.writeFile(inputName, buf);
  await ffmpeg.exec(["-i", inputName, "-acodec", "libmp3lame", outputName]);
  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}
