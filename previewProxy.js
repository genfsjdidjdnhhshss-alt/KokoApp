import { asClipList } from './TimelineEngine';

let bakePaused = false;

export function setPreviewBakePaused(paused) {
  bakePaused = !!paused;
}

export function previewUriOf(clip) {
  if (!clip) return null;
  const proxy = typeof clip.previewUri === 'string' ? clip.previewUri.trim() : '';
  return proxy || null;
}

export function originalUriOf(clip) {
  if (!clip) return null;
  const uri = typeof clip.uri === 'string' ? clip.uri.trim() : '';
  if (uri) return uri;
  const original = typeof clip.originalUri === 'string' ? clip.originalUri.trim() : '';
  return original || null;
}

export function isFullPreviewProxy(uri) {
  if (!uri || typeof uri !== 'string') return false;
  return /prev(-|\/|_|\.)|preview|360p|proxy/i.test(uri);
}

/** Prefer the source file the timeline already reads; proxy is optional perf. */
export function immediatePlayUri(clip) {
  const original = originalUriOf(clip);
  if (original) return original;
  return previewUriOf(clip);
}

export function syncPreviewProxies(clips, onReady) {
  if (bakePaused || typeof onReady !== 'function') return undefined;
  const list = asClipList(clips);
  if (!list.length) return undefined;
  // Proxy bake stays optional; playback no longer waits on previewUri.
  return undefined;
}
