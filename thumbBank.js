import { loadVideoThumbnails } from './mediaNative';

const MAX_ENTRIES = 256;
const MAX_ACTIVE = 2;
const MAX_WAITERS = 8;
const BUCKET_MS = 250;
const MAX_THUMB_MS = 3 * 60 * 60 * 1000;

const jobs = new Map();
const resolved = new Map();
const byUri = new Map();
const lru = [];
const waiters = [];
let active = 0;

export const FILM_ASPECT = 16 / 9;

export function thumbMs(timeSec) {
  const ms = Math.min(MAX_THUMB_MS, Math.max(0, Number(timeSec) * 1000));
  return Math.round(ms / BUCKET_MS) * BUCKET_MS;
}

function cacheKey(uri, ms) {
  return `${uri}|${ms}`;
}

function toFileUri(path) {
  if (!path || typeof path !== 'string') return null;
  if (
    path.startsWith('file:')
    || path.startsWith('content:')
    || path.startsWith('http:')
    || path.startsWith('https:')
    || path.startsWith('ph://')
    || path.startsWith('assets-library:')
  ) {
    return path;
  }
  if (path.startsWith('/')) return `file://${path}`;
  return path;
}

function sourceCandidates(uri) {
  const list = [];
  if (!uri || typeof uri !== 'string') return list;
  list.push(uri);
  if (uri.startsWith('/')) list.push(`file://${uri}`);
  try {
    const decoded = decodeURI(uri);
    if (decoded && decoded !== uri) list.push(decoded);
  } catch (_) {}
  return list;
}

function evictOne() {
  const drop = lru.shift();
  if (!drop) return;
  jobs.delete(drop);
  const frame = resolved.get(drop);
  resolved.delete(drop);
  const sep = drop.lastIndexOf('|');
  if (sep < 0) return;
  const uri = drop.slice(0, sep);
  const ms = Number(drop.slice(sep + 1));
  const bucket = byUri.get(uri);
  if (!bucket) return;
  bucket.delete(ms);
  if (!bucket.size) byUri.delete(uri);
  return frame;
}

function touch(key) {
  const at = lru.indexOf(key);
  if (at >= 0) lru.splice(at, 1);
  lru.push(key);
  while (lru.length > MAX_ENTRIES) evictOne();
}

function store(uri, ms, frame) {
  const key = cacheKey(uri, ms);
  resolved.set(key, frame);
  let bucket = byUri.get(uri);
  if (!bucket) {
    bucket = new Map();
    byUri.set(uri, bucket);
  }
  bucket.set(ms, frame);
  touch(key);
}

async function extractNativeThumb(uri, ms) {
  const api = loadVideoThumbnails();
  if (!api?.getThumbnailAsync) return null;
  const sources = sourceCandidates(uri);
  for (let i = 0; i < sources.length; i += 1) {
    try {
      const result = await api.getThumbnailAsync(sources[i], { time: ms, quality: 0.32 });
      const fileUri = toFileUri(result?.uri);
      if (!fileUri) continue;
      const width = Number(result?.width) || 0;
      const height = Number(result?.height) || 0;
      return {
        uri: fileUri,
        width,
        height,
        aspect: height > 0 ? width / height : FILM_ASPECT,
      };
    } catch (_) {}
  }
  return null;
}

function pump() {
  while (active < MAX_ACTIVE && waiters.length) {
    waiters.sort((a, b) => b.priority - a.priority);
    const item = waiters.shift();
    if (!item) break;
    const ready = resolved.get(item.key);
    if (ready) {
      item.resolve(ready);
      continue;
    }
    active += 1;
    extractNativeThumb(item.uri, item.ms)
      .then((frame) => {
        if (frame) store(item.uri, item.ms, frame);
        item.resolve(frame);
      })
      .catch(() => item.resolve(null))
      .finally(() => {
        jobs.delete(item.key);
        active -= 1;
        setTimeout(pump, 0);
      });
  }
}

export function peekThumb(uri, timeSec) {
  if (!uri) return null;
  const ms = thumbMs(timeSec);
  const key = cacheKey(uri, ms);
  const hit = resolved.get(key);
  if (!hit) return null;
  touch(key);
  return hit;
}

export function peekNearest(uri, timeSec) {
  if (!uri) return null;
  const exact = peekThumb(uri, timeSec);
  if (exact) return exact;
  const bucket = byUri.get(uri);
  if (!bucket || !bucket.size) return null;
  const want = thumbMs(timeSec);
  let best = null;
  let bestDist = Infinity;
  bucket.forEach((frame, ms) => {
    const dist = Math.abs(ms - want);
    if (dist < bestDist) {
      bestDist = dist;
      best = frame;
    }
  });
  return best;
}

export function requestThumb(uri, timeSec, priority = 1) {
  if (!uri) return Promise.resolve(null);
  const ms = thumbMs(timeSec);
  const key = cacheKey(uri, ms);
  const ready = resolved.get(key);
  if (ready) {
    touch(key);
    return Promise.resolve(ready);
  }
  const pending = jobs.get(key);
  if (pending) {
    pending.priority = Math.max(pending.priority, priority);
    return pending.promise;
  }
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  while (waiters.length >= MAX_WAITERS) {
    const drop = waiters.pop();
    if (!drop) break;
    jobs.delete(drop.key);
    drop.resolve?.(null);
  }
  const item = { uri, ms, key, priority, resolve, promise };
  jobs.set(key, item);
  if (priority >= 10) waiters.unshift(item);
  else waiters.push(item);
  pump();
  return promise;
}

export async function requestThumbs(uri, times, priority = 1) {
  const list = Array.isArray(times) ? times : [];
  return Promise.all(list.map((time) => requestThumb(uri, time, priority)));
}
