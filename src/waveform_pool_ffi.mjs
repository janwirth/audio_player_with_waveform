// Concurrency gate + worker pool + IndexedDB cache for waveform render data.
//
// `scheduleJob(asyncFn)` gates the full pipeline (fetch + decode + analysis)
// at MAX_CONCURRENT in flight, newest first (LIFO stack).
//
// Internally, the CPU-bound analysis step uses a small pool of module
// workers reused across jobs.

const MAX_CONCURRENT = 3;
const MAX_WORKERS = 3;
const MAX_QUEUE = 50;

// ---- outer pipeline scheduler ------------------------------------------

const jobStack = []; // pending {key, fn, resolve, reject}
const jobPromises = new Map(); // key -> Promise (pending or active; deduped)
let jobActive = 0;
const subs = new Set();

function emit() {
  const detail = {
    queued: jobStack.length,
    active: jobActive,
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

function pumpJobs() {
  while (jobStack.length > 0 && jobActive < MAX_CONCURRENT) {
    const job = jobStack.pop(); // LIFO
    jobActive++;
    emit();
    Promise.resolve()
      .then(() => job.fn())
      .then(
        (val) => {
          jobActive--;
          job.resolve(val);
          emit();
          pumpJobs();
        },
        (err) => {
          jobActive--;
          job.reject(err);
          emit();
          pumpJobs();
        },
      );
  }
}

// Schedule a pipeline job keyed by `key` (e.g. URL).
// - Same key already pending or active → return the existing promise (dedup).
// - Stack capped at MAX_QUEUE; oldest entries (bottom of the stack) are
//   dropped when the cap is exceeded.
export function scheduleJob(key, fn) {
  const existing = jobPromises.get(key);
  if (existing) return existing;
  const promise = new Promise((resolve, reject) => {
    jobStack.push({ key, fn, resolve, reject });
    while (jobStack.length > MAX_QUEUE) {
      const dropped = jobStack.shift();
      jobPromises.delete(dropped.key);
      dropped.reject(new Error("queue overflow"));
    }
    emit();
    pumpJobs();
  });
  jobPromises.set(key, promise);
  // Always clear the map entry once the job settles, even on rejection.
  promise.then(
    () => jobPromises.delete(key),
    () => jobPromises.delete(key),
  );
  return promise;
}

// ---- analysis worker pool (internal; used inside scheduleJob bodies) ----

const stack = []; // pending analysis tasks, newest at the end
const idle = []; // idle worker pool
const inflight = new Map(); // jobId -> {resolve, reject}
let nextJobId = 1;
let workersCreated = 0;

let cacheCount = 0;
let cacheCountInitialized = false;

export function subscribeQueueStatus(fn) {
  subs.add(fn);
  fn({ queued: jobStack.length, active: jobActive, cacheSize: cacheCount });
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
    idle.push(w);
    if (ok) cb.resolve({ waveformData, spectralData });
    else cb.reject(new Error(error));
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
    inflight.set(job.jobId, { resolve: job.resolve, reject: job.reject });
    w.postMessage({ jobId: job.jobId, channelData: job.channelData }, [
      job.channelData.buffer,
    ]);
  }
}

export function schedule(channelData) {
  return new Promise((resolve, reject) => {
    const jobId = nextJobId++;
    stack.push({ jobId, channelData, resolve, reject });
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
