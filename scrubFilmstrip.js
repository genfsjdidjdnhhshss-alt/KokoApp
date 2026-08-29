import { asClipList, clipAtCompositionTime, sourceTimeForClip } from './TimelineEngine';
import { originalUriOf, previewUriOf } from './previewProxy';
import { peekNearest, peekThumb, requestThumb } from './thumbBank';

let filmstripPaused = false;

export function setFilmstripPaused(paused) {
  filmstripPaused = !!paused;
}

function scrubUriForClip(clip) {
  return originalUriOf(clip) || previewUriOf(clip);
}

/** Same media source as the timeline filmstrip (original file URI). */
export function resolveScrubSource(clips, compositionTime) {
  const list = asClipList(clips);
  const clip = clipAtCompositionTime(list, compositionTime) || list[0];
  if (!clip) return null;
  const uri = scrubUriForClip(clip);
  if (!uri) return null;
  return {
    uri,
    sourceSec: sourceTimeForClip(clip, compositionTime),
    clipId: clip.id,
  };
}

export function peekExactThumb(uri, timeSec) {
  const hit = peekThumb(uri, timeSec);
  return hit?.uri || null;
}

export { peekThumb, peekNearest };

export function grabFrame(uri, timeSec) {
  if (filmstripPaused || !uri) return Promise.resolve(null);
  const cached = peekThumb(uri, timeSec);
  if (cached?.uri) return Promise.resolve(cached.uri);
  return requestThumb(uri, timeSec, 12).then((frame) => frame?.uri || null);
}
