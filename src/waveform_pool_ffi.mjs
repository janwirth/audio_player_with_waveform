// Worker pool + LIFO queue + IndexedDB cache for waveform render data.
//
// Pool size 3. Newest job in `schedule()` runs first (stack semantics).
// Subscribers get `{queued, active}` on every state change.

const MAX_WORKERS = 3;

const stack = []; // pending jobs, newest at the end
const idle = []; // idle worker pool
const inflight = new Map(); // jobId -> {resolve, reject, worker}
let nextJobId = 1;
let workersCreated = 0;
let busy = 0;
const subs = new Set();

let cacheCount = 0;
let cacheCountInitialized = false;

function emit() {
  const detail = {
    queued: stack.length,
    active: busy,
    cacheSize: cacheCount,
  };
  for (const fn of subs) {
    try {
      fn(detail);
    } catch (e) {
      console.error(e);
    }
  }
}

export function subscribeQueueStatus(fn) {
  subs.add(fn);
  fn({ queued: stack.length, active: busy, cacheSize: cacheCount });
  ensureCacheCount();
  return () => subs.delete(fn);
}

async function ensureCacheCount() {
  if (cacheCountInitialized) return;
  cacheCountInitialized = true;
  try {
    const db = await openDB();
    const n = await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
    cacheCount = n;
    emit();
  } catch (_) {}
}

function createWorker() {
  workersCreated++;
  const w = new Worker(
    new URL("./waveform_worker.mjs", import.meta.url),
    { type: "module" },
  );
  w.addEventListener("message", (e) => {
    const { jobId, ok, waveformData, spectralData, error } = e.data;
    const cb = inflight.get(jobId);
    if (!cb) return;
    inflight.delete(jobId);
    busy--;
    idle.push(w);
    if (ok) cb.resolve({ waveformData, spectralData });
    else cb.reject(new Error(error));
    emit();
    dispatch();
  });
  w.addEventListener("error", (err) => {
    console.error("apww worker error", err);
  });
  return w;
}

function dispatch() {
  while (stack.length > 0) {
    const haveWorker = idle.length > 0 || workersCreated < MAX_WORKERS;
    if (!haveWorker) return;
    const job = stack.pop(); // LIFO: newest first
    const w = idle.pop() || createWorker();
    busy++;
    inflight.set(job.jobId, { resolve: job.resolve, reject: job.reject });
    w.postMessage({ jobId: job.jobId, channelData: job.channelData }, [
      job.channelData.buffer,
    ]);
    emit();
  }
}

export function schedule(channelData) {
  return new Promise((resolve, reject) => {
    const jobId = nextJobId++;
    stack.push({ jobId, channelData, resolve, reject });
    emit();
    dispatch();
  });
}

// ---- IndexedDB cache ----------------------------------------------------

const DB_NAME = "apww-waveform-cache";
const STORE = "renderData";
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function cacheGet(url) {
  try {
    const db = await openDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

export async function cachePut(url, data) {
  try {
    const db = await openDB();
    const existed = await cacheGet(url);
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(data, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    if (!existed) {
      cacheCount++;
      emit();
    }
  } catch (_) {
    // best-effort cache
  }
}
