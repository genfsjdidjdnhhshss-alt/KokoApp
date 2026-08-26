import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { Canvas, matchFont, Picture, Skia } from '@shopify/react-native-skia';
import { peekNearest, peekThumb, requestThumb } from './thumbBank';

const FPS = 30;
const FRAME = 1 / FPS;
const FRAME_LABEL_MAX = 29;
const FRAME_SLOTS = FPS;
const FRAME_LABEL_GAP = 32;
const PPS_MIN = 10;
const PPS_DEFAULT = 64;
const PPS_MAX = 8 * FPS;
const RULER_H = 40;
const CLIP_H = 44;
const FILM_ASPECT = 16 / 9;
const CLOCK_THROTTLE_MS = 200;
const VISIBLE_MARGIN_PX = 160;
const FRAME_MS = 1000 / 60;
const SNAP_PX = 5;
const COLLIDE_EPS = 0.0005;
const SPEED_MIN = 0.1;
const SPEED_MAX = 10;

const FONT_FAMILY = Platform.OS === 'ios' ? 'Helvetica' : 'sans-serif';

const thumbCache = new Map();

function clamp(value, min, max) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function livePixelsPerSecond(pps, pinch) {
  'worklet';
  return clamp(pps * pinch, PPS_MIN, PPS_MAX);
}

function toFrameIndex(time) {
  'worklet';
  return Math.round(Math.max(0, time) * FPS);
}

function snapToFrame(time) {
  'worklet';
  return toFrameIndex(time) / FPS;
}

function asClipList(value) {
  return Array.isArray(value) ? value : [];
}

function clipAtCompositionTime(clips, time) {
  const list = asClipList(clips);
  if (!list.length) return null;
  const t = Math.max(0, Number(time) || 0);
  let cursor = 0;
  for (let i = 0; i < list.length; i += 1) {
    const clip = list[i];
    const duration = Number(clip.duration) || 0;
    const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : cursor;
    const end = start + duration;
    if (t >= start && t < end) return { ...clip, start, duration, end };
    cursor = end;
  }
  return null;
}

function clipSpeed(clip) {
  const speed = Number(clip?.speed);
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

function sourceSpanOf(clip) {
  const stored = Number(clip?.sourceSpan);
  if (Number.isFinite(stored) && stored > 0) return Math.max(FRAME, stored);
  const offset = Math.max(0, Number(clip?.offset) || 0);
  const file = Number(clip?.sourceDuration);
  if (Number.isFinite(file) && file > offset) return Math.max(FRAME, file - offset);
  return Math.max(FRAME, (Number(clip?.duration) || 0) * clipSpeed(clip));
}

function timelineDurationForSpeed(sourceSpan, speed) {
  const span = Math.max(FRAME, Number(sourceSpan) || FRAME);
  const rate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(speed) || 1));
  return Math.max(FRAME, span / rate);
}

function sourceTimeForClip(clip, compositionTime) {
  if (!clip) return 0;
  const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : 0;
  const offset = Math.max(0, Number(clip.offset) || 0);
  const duration = Math.max(0, Number(clip.duration) || 0);
  const span = sourceSpanOf(clip);
  const local = Math.max(0, (Number(compositionTime) || 0) - start);
  const source = offset + Math.min(local, duration) * clipSpeed(clip);
  return Math.min(offset + span, source);
}

function totalDuration(clips) {
  const list = asClipList(clips);
  let maxEnd = 0;
  for (let i = 0; i < list.length; i += 1) {
    const duration = Number(list[i]?.duration) || 0;
    const start = Number.isFinite(Number(list[i]?.start)) ? Number(list[i].start) : 0;
    const end = start + duration;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

function layoutId(value) {
  'worklet';
  return value == null ? '' : String(value);
}

function copyLayoutMap(prev) {
  'worklet';
  const next = {};
  const keys = Object.keys(prev || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    next[key] = prev[key];
  }
  return next;
}

function layoutMapsEqual(prev, next) {
  const a = prev || {};
  const b = next || {};
  const ids = Object.keys(b);
  if (Object.keys(a).length !== ids.length) return false;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (a[id] !== b[id]) return false;
  }
  return true;
}

function applySpeedPreview(id, start, dur, starts, durs, spans, previewId, previewSpeed) {
  'worklet';
  if (!previewId || layoutId(id) !== layoutId(previewId)) return { start, dur };
  const key = layoutId(previewId);
  const span = spans[key] > 0 ? spans[key] : dur;
  const rate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, previewSpeed || 1));
  return { start, dur: Math.max(FRAME, span / rate) };
}

function layoutContentEnd(layoutStartsSv, layoutDursSv, layoutSpansSv, speedPreviewIdSv, speedPreviewSpeedSv) {
  'worklet';
  const starts = layoutStartsSv.value || {};
  const durs = layoutDursSv.value || {};
  const ids = Object.keys(starts);
  let maxEnd = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const end = (starts[id] || 0) + (durs[id] || 0);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd > 0 ? maxEnd : FRAME;
}

function cachedThumb(clip) {
  const key = clip?.id;
  if (key == null) return clip;
  const hit = thumbCache.get(key);
  if (hit && hit.duration === clip.duration && hit.label === clip.label && hit.uri === clip.uri && hit.offset === (Number(clip.offset) || 0) && hit.sourceDuration === (Number(clip.sourceDuration) || 0) && hit.sourceSpan === sourceSpanOf(clip) && hit.speed === clipSpeed(clip)) return hit;
  const next = {
    id: clip.id,
    label: clip.label,
    duration: clip.duration,
    uri: clip.uri,
    offset: Number(clip.offset) || 0,
    sourceDuration: Number(clip.sourceDuration) || 0,
    sourceSpan: sourceSpanOf(clip),
    speed: clipSpeed(clip),
  };
  thumbCache.set(key, next);
  return next;
}

function layoutClips(clips) {
  let cursor = 0;
  return asClipList(clips).map((clip) => {
    const cached = cachedThumb(clip);
    const duration = Number(clip.duration) || cached.duration || 0;
    const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : cursor;
    cursor = start + duration;
    return {
      ...clip,
      start,
      duration,
      uri: clip.uri,
      originalUri: clip.originalUri || clip.uri,
      previewUri: clip.previewUri || null,
      offset: Number(clip.offset) || 0,
      sourceDuration: Number(clip.sourceDuration) || cached.sourceDuration || ((Number(clip.offset) || 0) + sourceSpanOf(clip)),
      sourceSpan: Number(clip.sourceSpan) > 0 ? Number(clip.sourceSpan) : sourceSpanOf(clip),
      speed: Number(clip.speed) > 0 ? clipSpeed(clip) : 1,
    };
  });
}

function stampClipTimes(clips) {
  let cursor = 0;
  return asClipList(clips).map((clip) => {
    const duration = Number(clip.duration) || 0;
    const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : cursor;
    cursor = start + duration;
    return { ...clip, start, end: start + duration };
  });
}

function clipsOverlap(start, duration, otherStart, otherEnd) {
  'worklet';
  return start + COLLIDE_EPS < otherEnd && start + duration > otherStart + COLLIDE_EPS;
}

function clampClipStart(clipId, proposed, starts, durs) {
  'worklet';
  const dur = durs[clipId] || 0;
  const origin = starts[clipId] || 0;
  const ids = Object.keys(starts);
  let start = proposed < 0 ? 0 : proposed;
  for (let pass = 0; pass < 10; pass += 1) {
    let hit = false;
    for (let i = 0; i < ids.length; i += 1) {
      const otherId = ids[i];
      if (otherId === clipId) continue;
      const otherStart = starts[otherId] || 0;
      const otherEnd = otherStart + (durs[otherId] || 0);
      if (!clipsOverlap(start, dur, otherStart, otherEnd)) continue;
      hit = true;
      const originMid = origin + dur * 0.5;
      const otherMid = otherStart + (otherEnd - otherStart) * 0.5;
      if (originMid <= otherMid) {
        start = otherStart - dur;
      } else {
        start = otherEnd;
      }
      if (start < 0) start = 0;
      break;
    }
    if (!hit) break;
  }
  return start < 0 ? 0 : start;
}

function snapWindow(livePps) {
  'worklet';
  return SNAP_PX / Math.max(1, livePps);
}

function snapClipStart(clipId, start, starts, durs, window) {
  'worklet';
  const dur = durs[clipId] || 0;
  const pad = window;
  if (!(pad > 0)) return start;
  let best = start;
  let bestDist = pad;
  if (start > 0 && start <= pad) {
    best = 0;
    bestDist = start;
  }
  const ids = Object.keys(starts);
  for (let i = 0; i < ids.length; i += 1) {
    const otherId = ids[i];
    if (otherId === clipId) continue;
    const otherStart = starts[otherId] || 0;
    const otherEnd = otherStart + (durs[otherId] || 0);
    const after = start > otherEnd ? start - otherEnd : otherEnd - start;
    if (after > 0 && after < bestDist) {
      bestDist = after;
      best = otherEnd;
    }
    const beforePos = otherStart - dur;
    if (beforePos >= 0) {
      const before = start > beforePos ? start - beforePos : beforePos - start;
      if (before > 0 && before < bestDist) {
        bestDist = before;
        best = beforePos;
      }
    }
  }
  return best < 0 ? 0 : best;
}

function resolveClipStart(clipId, proposed, starts, durs, withSnap, livePps) {
  'worklet';
  let start = clampClipStart(clipId, proposed, starts, durs);
  if (withSnap) {
    start = snapClipStart(clipId, start, starts, durs, snapWindow(livePps || PPS_DEFAULT));
    start = clampClipStart(clipId, start, starts, durs);
  }
  start = Math.max(0, snapToFrame(start));
  return clampClipStart(clipId, start, starts, durs);
}

function shiftClipInTime(clips, clipId, deltaTime) {
  const list = asClipList(clips);
  const laid = layoutClips(list);
  const id = layoutId(clipId);
  const starts = {};
  const durs = {};
  laid.forEach((clip) => {
    const key = layoutId(clip.id);
    starts[key] = clip.start;
    durs[key] = clip.duration;
  });
  if (starts[id] == null) return list;
  const origin = starts[id] || 0;
  const nextStart = resolveClipStart(
    id,
    origin + (Number(deltaTime) || 0),
    starts,
    durs,
    false,
    PPS_DEFAULT
  );
  return list.map((clip) => {
    const duration = Number(clip.duration) || 0;
    const key = layoutId(clip.id);
    const from = Number.isFinite(Number(clip.start)) ? Number(clip.start) : (starts[key] || 0);
    if (key !== id) {
      return { ...clip, start: from, end: from + duration };
    }
    return { ...clip, start: nextStart, end: nextStart + duration };
  });
}

function trimClipInTime(clips, clipId, start, duration, offset) {
  const list = asClipList(clips);
  const next = list.map((clip) => {
    if (layoutId(clip.id) !== layoutId(clipId)) return clip;
    const nextStart = Math.max(0, snapToFrame(start));
    const nextDuration = Math.max(FRAME, snapToFrame(duration));
    const nextOffset = Math.max(0, snapToFrame(offset));
    const speed = clipSpeed(clip);
    return {
      ...clip,
      start: nextStart,
      duration: nextDuration,
      offset: nextOffset,
      sourceSpan: Math.max(FRAME, nextDuration * speed),
      end: nextStart + nextDuration,
    };
  });
  return packClipsAfter(next, clipId);
}

function clipStartTime(clip, fallback = 0) {
  const start = Number(clip?.start);
  return Number.isFinite(start) ? start : fallback;
}

function packClipsAfter(clips, clipId) {
  const list = asClipList(clips);
  const id = layoutId(clipId);
  const ordered = list
    .map((clip, index) => ({ clip, index, start: clipStartTime(clip, index) }))
    .sort((a, b) => (a.start - b.start) || (a.index - b.index));
  const at = ordered.findIndex((item) => layoutId(item.clip.id) === id);
  if (at < 0) return list;
  const selected = ordered[at].clip;
  let cursor = clipStartTime(selected, 0) + Math.max(FRAME, Number(selected.duration) || 0);
  const nextStarts = new Map();
  for (let i = at + 1; i < ordered.length; i += 1) {
    const follower = ordered[i].clip;
    nextStarts.set(layoutId(follower.id), cursor);
    cursor += Math.max(FRAME, Number(follower.duration) || 0);
  }
  if (!nextStarts.size) return list;
  return list.map((clip) => {
    const key = layoutId(clip.id);
    if (!nextStarts.has(key)) return clip;
    const nextStart = nextStarts.get(key);
    const duration = Number(clip.duration) || 0;
    return { ...clip, start: nextStart, end: nextStart + duration };
  });
}

function setClipSpeedInTime(clips, clipId, speed) {
  const list = asClipList(clips);
  const id = layoutId(clipId);
  const target = list.find((clip) => layoutId(clip.id) === id);
  if (!target) return list;
  const nextSpeed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(speed) || 1));
  const span = sourceSpanOf(target);
  const selectedStart = clipStartTime(target, 0);
  const nextDur = Math.max(FRAME, Math.ceil(timelineDurationForSpeed(span, nextSpeed) * FPS - 1e-6) / FPS);
  const next = list.map((clip) => {
    if (layoutId(clip.id) !== id) return clip;
    return {
      ...clip,
      speed: nextSpeed,
      sourceSpan: span,
      duration: nextDur,
      start: selectedStart,
      end: selectedStart + nextDur,
    };
  });
  return packClipsAfter(next, id);
}

function neighborLeft(clipId, starts, durs) {
  'worklet';
  const start = starts[clipId] || 0;
  const ids = Object.keys(starts);
  let prevEnd = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const otherId = ids[i];
    if (otherId === clipId) continue;
    const otherEnd = (starts[otherId] || 0) + (durs[otherId] || 0);
    if (otherEnd <= start + COLLIDE_EPS && otherEnd > prevEnd) prevEnd = otherEnd;
  }
  return prevEnd;
}

function neighborRight(clipId, starts, durs) {
  'worklet';
  const end = (starts[clipId] || 0) + (durs[clipId] || 0);
  const ids = Object.keys(starts);
  let nextStart = 1e9;
  for (let i = 0; i < ids.length; i += 1) {
    const otherId = ids[i];
    if (otherId === clipId) continue;
    const otherStart = starts[otherId] || 0;
    if (otherStart + COLLIDE_EPS >= end && otherStart < nextStart) nextStart = otherStart;
  }
  return nextStart;
}

function bakeDragEnd(layoutStartsSv, clipId, nextStart, dragTxSv, dragFromSv, dragLiveSv) {
  'worklet';
  const next = copyLayoutMap(layoutStartsSv.value);
  next[clipId] = nextStart;
  layoutStartsSv.value = next;
  dragTxSv.value = 0;
  dragFromSv.value = '';
  dragLiveSv.value = 0;
}

function bakeTrimLayout(layoutStartsSv, layoutDursSv, layoutOffsetsSv, layoutSpansSv, durationSv, clipId, start, dur, offset, speed) {
  'worklet';
  const starts = copyLayoutMap(layoutStartsSv.value);
  const durs = copyLayoutMap(layoutDursSv.value);
  const offs = copyLayoutMap(layoutOffsetsSv.value);
  const spans = copyLayoutMap(layoutSpansSv.value);
  starts[clipId] = start;
  durs[clipId] = dur;
  offs[clipId] = offset;
  const rate = speed > 0.001 ? speed : 1;
  spans[clipId] = Math.max(FRAME, dur * rate);
  let maxEnd = FRAME;
  const ids = Object.keys(starts);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const end = (starts[id] || 0) + (durs[id] || 0);
    if (end > maxEnd) maxEnd = end;
  }
  layoutStartsSv.value = starts;
  layoutDursSv.value = durs;
  layoutOffsetsSv.value = offs;
  layoutSpansSv.value = spans;
  durationSv.value = maxEnd;
}

function restMaxEnd(clipId, starts, durs) {
  'worklet';
  const ids = Object.keys(starts);
  let maxEnd = FRAME;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    if (id === clipId) continue;
    const end = (starts[id] || 0) + (durs[id] || 0);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

function liveLeftTrim(dxTime, originStart, originDur, originOff, prevEnd, speed, trimStartSv, trimDurSv) {
  'worklet';
  const rate = speed > 0.001 ? speed : 1;
  const rightEdge = originStart + originDur;
  const minStart = Math.max(0, prevEnd, originStart - originOff / rate);
  const maxStart = rightEdge - FRAME;
  let nextStart = originStart + dxTime;
  if (nextStart < minStart) nextStart = minStart;
  if (nextStart > maxStart) nextStart = maxStart;
  trimStartSv.value = nextStart;
  trimDurSv.value = rightEdge - nextStart;
}

function liveRightTrim(dxTime, originStart, originDur, originOff, sourceDur, nextStart, restMax, speed, trimDurSv, durationSv) {
  'worklet';
  const rate = speed > 0.001 ? speed : 1;
  const maxFromSource = Math.max(FRAME, ((sourceDur || originOff + originDur * rate) - originOff) / rate);
  let maxDur = nextStart - originStart;
  if (maxFromSource < maxDur) maxDur = maxFromSource;
  if (maxDur < FRAME) maxDur = FRAME;
  let nextDur = originDur + dxTime;
  if (nextDur < FRAME) nextDur = FRAME;
  if (nextDur > maxDur) nextDur = maxDur;
  trimDurSv.value = nextDur;
  const end = originStart + nextDur;
  const nextSpan = restMax > end ? restMax : end;
  if (durationSv.value !== nextSpan) durationSv.value = nextSpan;
}

function snapTrimLeft(start, prevEnd, livePps) {
  'worklet';
  const window = snapWindow(livePps);
  if (start > prevEnd && start - prevEnd < window) return prevEnd;
  return start;
}

function snapTrimRight(start, dur, nextStart, livePps) {
  'worklet';
  const window = snapWindow(livePps);
  const end = start + dur;
  if (nextStart < 1e8 && nextStart > end && nextStart - end < window) {
    return Math.max(FRAME, nextStart - start);
  }
  return dur;
}

function beginEdgeTrim(
  clipId,
  mode,
  layoutStartsSv,
  layoutDursSv,
  layoutOffsetsSv,
  layoutSourcesSv,
  layoutSpeedsSv,
  trimMemoSv,
  trimStartSv,
  trimDurSv,
  dragFromSv,
  dragTxSv,
  dragLiveSv,
  playingSv,
  timeSv
) {
  'worklet';
  const starts = layoutStartsSv.value;
  const durs = layoutDursSv.value;
  const offs = layoutOffsetsSv.value;
  const srcs = layoutSourcesSv.value;
  const speeds = layoutSpeedsSv.value;
  const originStart = starts[clipId] ?? 0;
  const originDur = durs[clipId] ?? FRAME;
  const originOff = offs[clipId] ?? 0;
  const rate = speeds[clipId] > 0.001 ? speeds[clipId] : 1;
  const sourceDur = srcs[clipId] || (originOff + originDur * rate);
  trimMemoSv.value = [
    originStart,
    originDur,
    originOff,
    neighborLeft(clipId, starts, durs),
    neighborRight(clipId, starts, durs),
    sourceDur,
    restMaxEnd(clipId, starts, durs),
    rate,
  ];
  trimStartSv.value = originStart;
  trimDurSv.value = originDur;
  dragFromSv.value = clipId;
  dragTxSv.value = 0;
  dragLiveSv.value = mode;
  if (playingSv.value) {
    playingSv.value = false;
    cancelAnimation(timeSv);
  }
}

function finishEdgeTrim(
  translationX,
  clipId,
  layoutStartsSv,
  layoutDursSv,
  layoutOffsetsSv,
  layoutSpansSv,
  trimMemoSv,
  trimStartSv,
  trimDurSv,
  dragFromSv,
  dragTxSv,
  dragLiveSv,
  durationSv,
  ppsSv,
  pinchSv,
  onTrimEnd,
  notifyPause
) {
  'worklet';
  const mode = dragLiveSv.value;
  if (mode !== 2 && mode !== 3) return;
  const memo = trimMemoSv.value;
  const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
  const dx = translationX / livePps;
  let start;
  let dur;
  let offset;
  const rate = memo[7] > 0.001 ? memo[7] : 1;
  if (mode === 2) {
    liveLeftTrim(dx, memo[0], memo[1], memo[2], memo[3], rate, trimStartSv, trimDurSv);
    start = snapToFrame(snapTrimLeft(trimStartSv.value, memo[3], livePps));
    dur = snapToFrame((memo[0] + memo[1]) - start);
    offset = snapToFrame(memo[2] + (start - memo[0]) * rate);
    if (dur < FRAME) dur = FRAME;
  } else {
    liveRightTrim(dx, memo[0], memo[1], memo[2], memo[5], memo[4], memo[6], rate, trimDurSv, durationSv);
    start = snapToFrame(memo[0]);
    dur = snapToFrame(snapTrimRight(start, trimDurSv.value, memo[4], livePps));
    if (dur < FRAME) dur = FRAME;
    offset = snapToFrame(memo[2]);
  }
  trimStartSv.value = start;
  trimDurSv.value = dur;
  bakeTrimLayout(
    layoutStartsSv,
    layoutDursSv,
    layoutOffsetsSv,
    layoutSpansSv,
    durationSv,
    clipId,
    start,
    dur,
    offset,
    rate
  );
  dragFromSv.value = '';
  dragLiveSv.value = 0;
  dragTxSv.value = 0;
  runOnJS(onTrimEnd)(clipId, start, dur, offset);
  runOnJS(notifyPause)();
}

function frameZoom(pps) {
  'worklet';
  if (pps < 4 * FPS) return { tick: 0, number: 0, major: 0 };
  return { tick: 10, number: 10, major: 10 };
}

function rulerStep(pps) {
  'worklet';
  if (pps >= 100) return { minor: 1, label: 1 };
  if (pps >= 48) return { minor: 1, label: 1 };
  if (pps >= 28) return { minor: 1, label: 5 };
  if (pps >= 16) return { minor: 5, label: 5 };
  if (pps >= 10) return { minor: 5, label: 10 };
  if (pps >= 6) return { minor: 10, label: 15 };
  return { minor: 15, label: 30 };
}

function pad2(n) {
  'worklet';
  return n < 10 ? `0${n}` : `${n}`;
}

function formatSecondLabel(t) {
  'worklet';
  const sec = Math.max(0, Math.round(t));
  return pad2(sec % 60);
}

function formatFrameLabel(frame) {
  'worklet';
  const n = ((frame % FPS) + FPS) % FPS;
  return `${pad2(n)}f`;
}

function viewPad(livePps, width) {
  'worklet';
  return width * 0.5 / Math.max(livePps, 1) + 8 * FRAME;
}

function recordRulerPicture(time, pps, pinch, width, fontSecond, fontFrame) {
  'worklet';
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, RULER_H));
  const stroke = Skia.Paint();
  stroke.setAntiAlias(true);
  stroke.setStyle(1);
  stroke.setStrokeWidth(1);
  const fill = Skia.Paint();
  fill.setAntiAlias(true);

  const livePps = livePixelsPerSecond(pps, pinch);
  const pad = viewPad(livePps, width);
  const zoom = frameZoom(livePps);
  const origin = width / 2;
  const colMajor = Skia.Color('#C8C8C8');
  const colMid = Skia.Color('#9A9A9A');
  const colMin = Skia.Color('#6E6E6E');
  const colLabel = Skia.Color('#E8E8E8');
  const labelHalf = 11;
  const xMin = -28;
  const xMax = width + 28;

  const drawTick = (x, y0, y1, color) => {
    if (x < -2 || x > width + 2) return;
    stroke.setColor(color);
    canvas.drawLine(x, y0, x, y1, stroke);
  };

  const drawLabel = (x, text, font, y, color) => {
    if (!font || x < xMin || x > xMax) return;
    fill.setColor(color);
    canvas.drawText(text, x - labelHalf, y, fill, font);
  };

  if (zoom.tick === 10) {
    const startFrame = Math.max(0, Math.floor((time - pad) * FPS));
    const endFrame = Math.max(0, Math.ceil((time + pad) * FPS));
    const first = Math.ceil(startFrame / 10) * 10;
    for (let i = first; i <= endFrame; i += 10) {
      const f = ((i % FPS) + FPS) % FPS;
      const x = origin + (i * FRAME - time) * livePps;
      if (x < -4 || x > width + 4) continue;
      if (f === 0) {
        drawTick(x, 16, 38, colMajor);
        drawLabel(x, pad2(Math.floor(i / FPS) % 60), fontSecond, 14, colLabel);
      } else {
        drawTick(x, 22, 38, colMid);
        drawLabel(x, formatFrameLabel(f), fontFrame || fontSecond, 32, colLabel);
      }
    }
    return recorder.finishRecordingAsPicture();
  }

  const step = rulerStep(livePps);
  const startT = Math.max(0, Math.floor((time - pad) / step.minor) * step.minor);
  const endT = time + pad;
  for (let t = startT; t <= endT + 0.0001; t += step.minor) {
    const x = origin + (t - time) * livePps;
    const isLabel = Math.abs(t / step.label - Math.round(t / step.label)) < 0.001;
    if (isLabel) {
      drawTick(x, 17, 31, colMajor);
      drawLabel(x, formatSecondLabel(t), fontSecond, 14, colLabel);
    } else {
      drawTick(x, 22, 32, colMin);
    }
  }
  return recorder.finishRecordingAsPicture();
}

function visibleLaidOut(laidOut, time, pps, pinch, width) {
  if (laidOut.length <= 24) return laidOut;
  const livePps = livePixelsPerSecond(pps, pinch);
  const pad = (width * 0.5 + VISIBLE_MARGIN_PX) / livePps;
  const from = time - pad;
  const to = time + pad;
  return laidOut.filter((clip) => {
    const end = clip.start + clip.duration;
    return end >= from && clip.start <= to;
  });
}

function TimelineStrip({ clips = [], selectedId = null, onSelectClip, onTimeChange, onPlayingChange, persistMoveRef, persistTrimRef, controlRef, speedPreviewIdSv, speedPreviewSpeedSv, playingSv, timeSv }) {
  const { width } = useWindowDimensions();
  const list = asClipList(clips);
  const laidOut = useMemo(() => layoutClips(list), [list]);
  const duration = Math.max(FRAME, totalDuration(list));
  const ppsSv = useSharedValue(PPS_DEFAULT);
  const pinchSv = useSharedValue(1);
  const durationSv = useSharedValue(duration);
  const panOrigin = useSharedValue(0);
  const pinchStartPps = useSharedValue(PPS_DEFAULT);
  const dragFromSv = useSharedValue('');
  const dragToSv = useSharedValue('');
  const dragTxSv = useSharedValue(0);
  const dragLiveSv = useSharedValue(0);
  const layoutStartsSv = useSharedValue({});
  const layoutDursSv = useSharedValue({});
  const layoutOffsetsSv = useSharedValue({});
  const layoutSourcesSv = useSharedValue({});
  const layoutSpeedsSv = useSharedValue({});
  const layoutSpansSv = useSharedValue({});
  const trimMemoSv = useSharedValue([0, 0, 0, 0, 1e9, 0, FRAME]);
  const trimStartSv = useSharedValue(0);
  const trimDurSv = useSharedValue(FRAME);
  const onTimeChangeRef = useRef(onTimeChange);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useLayoutEffect(() => {
    if (dragLiveSv.value !== 0) return;
    const starts = {};
    const durs = {};
    const offsets = {};
    const sources = {};
    const speeds = {};
    const spans = {};
    laidOut.forEach((clip) => {
      const id = layoutId(clip.id);
      starts[id] = clip.start;
      durs[id] = clip.duration;
      offsets[id] = clip.offset;
      sources[id] = clip.sourceDuration || ((clip.offset || 0) + sourceSpanOf(clip));
      speeds[id] = clipSpeed(clip);
      spans[id] = Number(clip.sourceSpan) > 0 ? Number(clip.sourceSpan) : sourceSpanOf(clip);
    });
    if (!layoutMapsEqual(layoutStartsSv.value, starts)) layoutStartsSv.value = starts;
    if (!layoutMapsEqual(layoutDursSv.value, durs)) layoutDursSv.value = durs;
    if (!layoutMapsEqual(layoutOffsetsSv.value, offsets)) layoutOffsetsSv.value = offsets;
    if (!layoutMapsEqual(layoutSourcesSv.value, sources)) layoutSourcesSv.value = sources;
    if (!layoutMapsEqual(layoutSpeedsSv.value, speeds)) layoutSpeedsSv.value = speeds;
    if (!layoutMapsEqual(layoutSpansSv.value, spans)) layoutSpansSv.value = spans;
    if (durationSv.value !== duration) durationSv.value = duration;
  }, [laidOut, duration, dragLiveSv, layoutStartsSv, layoutDursSv, layoutOffsetsSv, layoutSourcesSv, layoutSpeedsSv, layoutSpansSv, durationSv]);
  onTimeChangeRef.current = onTimeChange;
  onPlayingChangeRef.current = onPlayingChange;

  const laidOutRef = useRef(laidOut);
  if (laidOutRef.current !== laidOut) {
    laidOutRef.current = laidOut;
  }

  const emitClock = (value) => {
    onTimeChangeRef.current?.(value);
  };

  const notifyPause = useCallback(() => {
    onPlayingChangeRef.current?.(false);
  }, []);

  const persistMove = useCallback((from, deltaTime) => {
    persistMoveRef?.current?.(from, deltaTime);
  }, [persistMoveRef]);

  const persistTrim = useCallback((clipId, start, duration, offset) => {
    persistTrimRef?.current?.(clipId, start, duration, offset);
  }, [persistTrimRef]);

  useFrameCallback((info) => {
    'worklet';
    if (!playingSv.value) return;
    const end = durationSv.value > 0 ? durationSv.value : FRAME;
    const dt = (info.timeSincePreviousFrame ?? FRAME_MS) / 1000;
    const next = timeSv.value + dt;
    if (next >= end) {
      timeSv.value = end;
      playingSv.value = false;
      runOnJS(notifyPause)();
      runOnJS(emitClock)(end);
      return;
    }
    timeSv.value = next;
  });

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-12, 12])
      .onBegin(() => {
        if (playingSv.value) {
          playingSv.value = false;
          cancelAnimation(timeSv);
        }
        panOrigin.value = timeSv.value;
      })
      .onUpdate((event) => {
        if (dragFromSv.value !== '') return;
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        timeSv.value = clamp(panOrigin.value - event.translationX / livePps, 0, layoutContentEnd(layoutStartsSv, layoutDursSv, layoutSpansSv, speedPreviewIdSv, speedPreviewSpeedSv));
      })
      .onEnd(() => {
        runOnJS(emitClock)(timeSv.value);
        runOnJS(notifyPause)();
      });

    const pinch = Gesture.Pinch()
      .onBegin(() => {
        if (playingSv.value) {
          playingSv.value = false;
          cancelAnimation(timeSv);
        }
        pinchStartPps.value = livePixelsPerSecond(ppsSv.value, pinchSv.value);
      })
      .onUpdate((event) => {
        if (dragFromSv.value !== '') return;
        const nextLive = clamp(pinchStartPps.value * event.scale, PPS_MIN, PPS_MAX);
        pinchSv.value = nextLive / Math.max(1, ppsSv.value);
      })
      .onEnd(() => {
        ppsSv.value = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        pinchSv.value = 1;
        runOnJS(emitClock)(timeSv.value);
        runOnJS(notifyPause)();
      });

    return { composed: Gesture.Simultaneous(pinch, pan), pan };
  }, []);

  const startNow = () => {
    const end = durationSv.value;
    if (timeSv.value >= end - FRAME * 0.25) {
      timeSv.value = end;
      return;
    }
    if (playingSv.value) return;
    playingSv.value = true;
  };

  const pauseNow = () => {
    playingSv.value = false;
    cancelAnimation(timeSv);
    emitClock(timeSv.value);
  };

  if (controlRef) {
    controlRef.current = {
      getTime: () => timeSv.value,
      pausePlayback: () => {
        playingSv.value = false;
        cancelAnimation(timeSv);
      },
      seekTo: (nextTime) => {
        cancelAnimation(timeSv);
        playingSv.value = false;
        timeSv.value = clamp(snapToFrame(nextTime), 0, layoutContentEnd(layoutStartsSv, layoutDursSv, layoutSpansSv, speedPreviewIdSv, speedPreviewSpeedSv));
        emitClock(timeSv.value);
      },
      nudge: (delta) => {
        cancelAnimation(timeSv);
        playingSv.value = false;
        const frames = toFrameIndex(timeSv.value) + Math.round(Number(delta) * FPS);
        timeSv.value = clamp(frames / FPS, 0, layoutContentEnd(layoutStartsSv, layoutDursSv, layoutSpansSv, speedPreviewIdSv, speedPreviewSpeedSv));
        emitClock(timeSv.value);
      },
      startNow,
      pauseNow,
    };
  }

  const trackStyle = useAnimatedStyle(() => {
    const live = livePixelsPerSecond(ppsSv.value, pinchSv.value);
    return {
      transform: [{ translateX: -timeSv.value * live }],
    };
  });

  const stripWidthStyle = useAnimatedStyle(() => {
    const live = livePixelsPerSecond(ppsSv.value, pinchSv.value);
    const end = layoutContentEnd(layoutStartsSv, layoutDursSv, layoutSpansSv, speedPreviewIdSv, speedPreviewSpeedSv);
    return { width: Math.max(1, end * live) };
  });

  useEffect(() => {
    durationSv.value = duration;
    if (timeSv.value > duration) {
      timeSv.value = duration;
      if (playingSv.value) {
        playingSv.value = false;
        notifyPause();
        emitClock(duration);
      }
    }
  }, [duration, durationSv, timeSv, playingSv, notifyPause]);

  return (
    <GestureDetector gesture={gesture.composed}>
      <View style={styles.timelinePanel}>
        <View style={[styles.timelineOrigin, { transform: [{ translateX: width / 2 }] }]}>
          <Animated.View style={[styles.timelineTrack, trackStyle]}>
            <Animated.View style={stripWidthStyle}>
              <View style={styles.rulerSpacer} />
              <ClipAndAudioLanes
                laidOut={laidOut}
                timeSv={timeSv}
                ppsSv={ppsSv}
                pinchSv={pinchSv}
                width={width}
                playingSv={playingSv}
                notifyPause={notifyPause}
                scrubPan={gesture.pan}
                dragFromSv={dragFromSv}
                dragToSv={dragToSv}
                dragTxSv={dragTxSv}
                dragLiveSv={dragLiveSv}
                layoutStartsSv={layoutStartsSv}
                layoutDursSv={layoutDursSv}
                layoutOffsetsSv={layoutOffsetsSv}
                layoutSourcesSv={layoutSourcesSv}
                layoutSpeedsSv={layoutSpeedsSv}
                layoutSpansSv={layoutSpansSv}
                speedPreviewIdSv={speedPreviewIdSv}
                speedPreviewSpeedSv={speedPreviewSpeedSv}
                trimMemoSv={trimMemoSv}
                trimStartSv={trimStartSv}
                trimDurSv={trimDurSv}
                durationSv={durationSv}
                persistMove={persistMove}
                persistTrim={persistTrim}
                selectedId={selectedId}
                onSelectClip={onSelectClip}
              />
            </Animated.View>
          </Animated.View>
        </View>
        <View pointerEvents="none" style={styles.rulerOverlay}>
          <RulerCanvas
            width={width}
            timeSv={timeSv}
            ppsSv={ppsSv}
            pinchSv={pinchSv}
          />
        </View>
        <View pointerEvents="none" style={styles.playheadCap} />
        <View pointerEvents="none" style={styles.playhead} />
      </View>
    </GestureDetector>
  );
}

function RulerCanvas({ width, timeSv, ppsSv, pinchSv }) {
  const fontSecond = useMemo(() => (
    matchFont({ fontFamily: FONT_FAMILY, fontSize: 13, fontWeight: '700' })
  ), []);
  const fontFrame = useMemo(() => (
    matchFont({ fontFamily: FONT_FAMILY, fontSize: 11, fontWeight: '700' })
  ), []);

  const picture = useDerivedValue(() => (
    recordRulerPicture(
      timeSv.value,
      ppsSv.value,
      pinchSv.value,
      width,
      fontSecond,
      fontFrame
    )
  ), [width, fontSecond, fontFrame]);

  return (
    <Canvas style={{ width, height: RULER_H }} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
}

function useVisibleClips(laidOut, timeSv, ppsSv, pinchSv, width) {
  const [visible, setVisible] = useState(laidOut);
  const lastAt = useSharedValue(0);
  const laidOutRef = useRef(laidOut);
  laidOutRef.current = laidOut;
  const small = laidOut.length <= 24;

  const applyVisible = (time, pps, pinch) => {
    setVisible(visibleLaidOut(laidOutRef.current, time, pps, pinch, width));
  };

  useEffect(() => {
    if (small) return;
    applyVisible(timeSv.value, ppsSv.value, pinchSv.value);
  }, [laidOut, width, small]);

  useAnimatedReaction(
    () => {
      if (laidOut.length <= 24) return 0;
      return Math.floor(timeSv.value) + Math.floor(ppsSv.value / 8);
    },
    (current, previous) => {
      if (current === previous || laidOut.length <= 24) return;
      const now = Date.now();
      if (now - lastAt.value < 250) return;
      lastAt.value = now;
      runOnJS(applyVisible)(timeSv.value, ppsSv.value, pinchSv.value);
    },
    [width, laidOut.length]
  );

  return small ? laidOut : visible;
}

function ClipAndAudioLanes({
  laidOut,
  timeSv,
  ppsSv,
  pinchSv,
  width,
  playingSv,
  notifyPause,
  scrubPan,
  dragFromSv,
  dragToSv,
  dragTxSv,
  dragLiveSv,
  layoutStartsSv,
  layoutDursSv,
  layoutOffsetsSv,
  layoutSourcesSv,
  layoutSpeedsSv,
  layoutSpansSv,
  speedPreviewIdSv,
  speedPreviewSpeedSv,
  trimMemoSv,
  trimStartSv,
  trimDurSv,
  durationSv,
  persistMove,
  persistTrim,
  selectedId,
  onSelectClip,
}) {
  const visible = useVisibleClips(laidOut, timeSv, ppsSv, pinchSv, width);
  const persistMoveRef = useRef(persistMove);
  persistMoveRef.current = persistMove;
  const persistTrimInner = useRef(persistTrim);
  persistTrimInner.current = persistTrim;
  const onDragEnd = useCallback((clipId, deltaTime) => {
    persistMoveRef.current(clipId, deltaTime);
  }, []);
  const onTrimEnd = useCallback((clipId, start, duration, offset) => {
    persistTrimInner.current(clipId, start, duration, offset);
  }, []);
  return (
    <>
      <View style={styles.strip}>
        {visible.map((clip) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            ppsSv={ppsSv}
            pinchSv={pinchSv}
            timeSv={timeSv}
            playingSv={playingSv}
            notifyPause={notifyPause}
            scrubPan={scrubPan}
            dragFromSv={dragFromSv}
            dragToSv={dragToSv}
            dragTxSv={dragTxSv}
            dragLiveSv={dragLiveSv}
            layoutStartsSv={layoutStartsSv}
            layoutDursSv={layoutDursSv}
            layoutOffsetsSv={layoutOffsetsSv}
            layoutSourcesSv={layoutSourcesSv}
            layoutSpeedsSv={layoutSpeedsSv}
            layoutSpansSv={layoutSpansSv}
            speedPreviewIdSv={speedPreviewIdSv}
            speedPreviewSpeedSv={speedPreviewSpeedSv}
            trimMemoSv={trimMemoSv}
            trimStartSv={trimStartSv}
            trimDurSv={trimDurSv}
            durationSv={durationSv}
            width={width}
            onDragEnd={onDragEnd}
            onTrimEnd={onTrimEnd}
            selected={layoutId(selectedId) === layoutId(clip.id)}
            onSelectClip={onSelectClip}
          />
        ))}
      </View>
      <View style={styles.audioStrip}>
        {visible.map((clip) => (
          <AudioBlock
            key={`a-${clip.id}`}
            clip={clip}
            ppsSv={ppsSv}
            dragFromSv={dragFromSv}
            dragTxSv={dragTxSv}
            layoutStartsSv={layoutStartsSv}
            layoutDursSv={layoutDursSv}
            layoutSpansSv={layoutSpansSv}
            speedPreviewIdSv={speedPreviewIdSv}
            speedPreviewSpeedSv={speedPreviewSpeedSv}
            pinchSv={pinchSv}
            trimStartSv={trimStartSv}
            trimDurSv={trimDurSv}
            dragLiveSv={dragLiveSv}
          />
        ))}
      </View>
    </>
  );
}

function useLaneStyle(clip, ppsSv, pinchSv, dragFromSv, dragTxSv, layoutStartsSv, layoutDursSv, layoutSpansSv, dragLiveSv, trimStartSv, trimDurSv, selected, speedPreviewIdSv, speedPreviewSpeedSv) {
  const clipId = layoutId(clip.id);
  const startFallback = clip.start;
  const duration = clip.duration;
  return useAnimatedStyle(() => {
    const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
    const from = dragFromSv.value;
    const live = dragLiveSv.value;
    const trimming = from === clipId && live >= 2;
    const starts = layoutStartsSv.value || {};
    const durs = layoutDursSv.value || {};
    const spans = layoutSpansSv.value || {};
    const rawStart = trimming
      ? trimStartSv.value
      : (starts[clipId] == null ? startFallback : starts[clipId]);
    const rawDur = trimming
      ? trimDurSv.value
      : (durs[clipId] == null ? duration : durs[clipId]);
    const previewed = applySpeedPreview(
      clipId,
      rawStart,
      rawDur,
      starts,
      durs,
      spans,
      speedPreviewIdSv.value,
      speedPreviewSpeedSv.value
    );
    const start = trimming ? rawStart : previewed.start;
    const dur = trimming ? rawDur : previewed.dur;
    const moving = from === clipId && live === 1;
    const left = start * livePps + (moving ? dragTxSv.value : 0);
    const lifting = from === clipId && live > 0;
    const on = selected || lifting;
    return {
      left,
      width: Math.max(1, dur * livePps),
      zIndex: lifting ? 12 : 1,
      elevation: lifting ? 12 : 0,
      opacity: lifting ? 0.94 : 1,
      borderColor: on ? '#23dddb' : '#111111',
    };
  });
}

function clipViewEqual(prev, next) {
  const a = prev.clip;
  const b = next.clip;
  return a.id === b.id
    && a.start === b.start
    && a.duration === b.duration
    && a.offset === b.offset
    && a.sourceDuration === b.sourceDuration
    && a.sourceSpan === b.sourceSpan
    && a.speed === b.speed
    && a.uri === b.uri
    && a.label === b.label
    && prev.selected === next.selected;
}

const ClipBlock = memo(function ClipBlock({
  clip,
  ppsSv,
  pinchSv,
  timeSv,
  playingSv,
  notifyPause,
  scrubPan,
  dragFromSv,
  dragToSv,
  dragTxSv,
  dragLiveSv,
  layoutStartsSv,
  layoutDursSv,
  layoutOffsetsSv,
  layoutSourcesSv,
  layoutSpeedsSv,
  layoutSpansSv,
  speedPreviewIdSv,
  speedPreviewSpeedSv,
  trimMemoSv,
  trimStartSv,
  trimDurSv,
  durationSv,
  onDragEnd,
  onTrimEnd,
  width,
  selected,
  onSelectClip,
}) {
  const style = useLaneStyle(
    clip,
    ppsSv,
    pinchSv,
    dragFromSv,
    dragTxSv,
    layoutStartsSv,
    layoutDursSv,
    layoutSpansSv,
    dragLiveSv,
    trimStartSv,
    trimDurSv,
    selected,
    speedPreviewIdSv,
    speedPreviewSpeedSv
  );
  const clipId = layoutId(clip.id);
  const scrubPanRef = useRef(scrubPan);
  scrubPanRef.current = scrubPan;

  const gesture = useMemo(() => {
    const body = Gesture.Pan()
      .runOnJS(false)
      .activateAfterLongPress(260)
      .maxPointers(1)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        if (playingSv.value) {
          playingSv.value = false;
          cancelAnimation(timeSv);
        }
        dragFromSv.value = clipId;
        dragToSv.value = clipId;
        dragTxSv.value = 0;
        dragLiveSv.value = 1;
      })
      .onUpdate((event) => {
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        const origin = layoutStartsSv.value[clipId] ?? 0;
        const proposed = origin + event.translationX / livePps;
        const nextStart = resolveClipStart(
          clipId,
          proposed,
          layoutStartsSv.value,
          layoutDursSv.value,
          false,
          livePps
        );
        dragTxSv.value = (nextStart - origin) * livePps;
      })
      .onEnd((event) => {
        if (dragLiveSv.value !== 1) return;
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        const origin = layoutStartsSv.value[clipId] ?? 0;
        const proposed = origin + event.translationX / livePps;
        const nextStart = resolveClipStart(
          clipId,
          proposed,
          layoutStartsSv.value,
          layoutDursSv.value,
          true,
          livePps
        );
        const deltaTime = nextStart - origin;
        bakeDragEnd(layoutStartsSv, clipId, nextStart, dragTxSv, dragFromSv, dragLiveSv);
        runOnJS(onDragEnd)(clipId, deltaTime);
        runOnJS(notifyPause)();
      })
      .onFinalize(() => {
        if (dragLiveSv.value !== 1) return;
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        const origin = layoutStartsSv.value[clipId] ?? 0;
        const proposed = origin + dragTxSv.value / livePps;
        const nextStart = resolveClipStart(
          clipId,
          proposed,
          layoutStartsSv.value,
          layoutDursSv.value,
          true,
          livePps
        );
        const deltaTime = nextStart - origin;
        bakeDragEnd(layoutStartsSv, clipId, nextStart, dragTxSv, dragFromSv, dragLiveSv);
        runOnJS(onDragEnd)(clipId, deltaTime);
        runOnJS(notifyPause)();
      });

    const left = Gesture.Pan()
      .runOnJS(false)
      .maxPointers(1)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        beginEdgeTrim(
          clipId,
          2,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSourcesSv,
          layoutSpeedsSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          playingSv,
          timeSv
        );
      })
      .onUpdate((event) => {
        if (dragLiveSv.value !== 2) return;
        const memo = trimMemoSv.value;
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        liveLeftTrim(
          event.translationX / livePps,
          memo[0],
          memo[1],
          memo[2],
          memo[3],
          memo[7] > 0.001 ? memo[7] : 1,
          trimStartSv,
          trimDurSv
        );
      })
      .onEnd((event) => {
        finishEdgeTrim(
          event.translationX,
          clipId,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSpansSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          durationSv,
          ppsSv,
          pinchSv,
          onTrimEnd,
          notifyPause
        );
      })
      .onFinalize((event) => {
        finishEdgeTrim(
          event.translationX,
          clipId,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSpansSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          durationSv,
          ppsSv,
          pinchSv,
          onTrimEnd,
          notifyPause
        );
      });

    const right = Gesture.Pan()
      .runOnJS(false)
      .maxPointers(1)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        beginEdgeTrim(
          clipId,
          3,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSourcesSv,
          layoutSpeedsSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          playingSv,
          timeSv
        );
      })
      .onUpdate((event) => {
        if (dragLiveSv.value !== 3) return;
        const memo = trimMemoSv.value;
        const livePps = livePixelsPerSecond(ppsSv.value, pinchSv.value);
        liveRightTrim(
          event.translationX / livePps,
          memo[0],
          memo[1],
          memo[2],
          memo[5],
          memo[4],
          memo[6],
          memo[7] > 0.001 ? memo[7] : 1,
          trimDurSv,
          durationSv
        );
      })
      .onEnd((event) => {
        finishEdgeTrim(
          event.translationX,
          clipId,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSpansSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          durationSv,
          ppsSv,
          pinchSv,
          onTrimEnd,
          notifyPause
        );
      })
      .onFinalize((event) => {
        finishEdgeTrim(
          event.translationX,
          clipId,
          layoutStartsSv,
          layoutDursSv,
          layoutOffsetsSv,
          layoutSpansSv,
          trimMemoSv,
          trimStartSv,
          trimDurSv,
          dragFromSv,
          dragTxSv,
          dragLiveSv,
          durationSv,
          ppsSv,
          pinchSv,
          onTrimEnd,
          notifyPause
        );
      });

    body.blocksExternalGesture(scrubPanRef.current);
    left.blocksExternalGesture(scrubPanRef.current);
    right.blocksExternalGesture(scrubPanRef.current);
    const tap = Gesture.Tap()
      .onEnd(() => {
        if (onSelectClip) runOnJS(onSelectClip)(clipId);
      });
    return { body: Gesture.Exclusive(body, tap), left, right };
  }, [
    clipId,
    timeSv,
    playingSv,
    notifyPause,
    dragFromSv,
    dragToSv,
    dragTxSv,
    dragLiveSv,
    layoutStartsSv,
    layoutDursSv,
    layoutOffsetsSv,
    layoutSourcesSv,
    layoutSpeedsSv,
    layoutSpansSv,
    trimMemoSv,
    trimStartSv,
    trimDurSv,
    durationSv,
    onDragEnd,
    onTrimEnd,
    onSelectClip,
    pinchSv,
    ppsSv,
  ]);

  const speed = clipSpeed(clip);
  const speedLabel = speed === 1 ? null : (speed < 1 ? `${speed.toFixed(1)}x` : `${speed % 1 === 0 ? String(speed) : speed.toFixed(1)}x`);

  return (
    <Animated.View style={[styles.clip, style]}>
      <GestureDetector gesture={gesture.body}>
        <Animated.View style={styles.clipBody}>
          <ClipFilmstrip
            clip={clip}
            clipId={clipId}
            ppsSv={ppsSv}
            pinchSv={pinchSv}
            timeSv={timeSv}
            width={width}
            layoutStartsSv={layoutStartsSv}
            layoutDursSv={layoutDursSv}
            layoutOffsetsSv={layoutOffsetsSv}
            dragLiveSv={dragLiveSv}
          />
          <Text style={styles.clipLabel} pointerEvents="none" numberOfLines={1}>{clip.label}</Text>
          {speedLabel ? (
            <View pointerEvents="none" style={styles.speedBadge}>
              <Text style={styles.speedBadgeText}>{speedLabel}</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={gesture.left}>
        <Animated.View style={styles.trimHitLeft}>
          <View pointerEvents="none" style={styles.trimBar} />
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={gesture.right}>
        <Animated.View style={styles.trimHitRight}>
          <View pointerEvents="none" style={styles.trimBar} />
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}, clipViewEqual);

function filmCount(duration, live, aspect) {
  'worklet';
  const clipW = Math.max(1, duration * Math.max(1, live));
  const natural = CLIP_H * (aspect > 0.25 ? aspect : FILM_ASPECT);
  return Math.max(1, Math.min(16, Math.round(clipW / Math.max(12, natural))));
}

function filmSourceTime(offset, sourceSpan, fileDuration, index, count) {
  const span = Math.max(FRAME, Number(sourceSpan) || FRAME);
  const at = offset + ((index + 0.5) / Math.max(1, count)) * span;
  const file = Number(fileDuration);
  if (Number.isFinite(file) && file > 0) return Math.min(Math.max(0, file - FRAME), Math.max(0, at));
  return Math.max(0, at);
}

function ClipFilmstrip({
  clip,
  clipId,
  ppsSv,
  pinchSv,
  timeSv,
  width,
  layoutStartsSv,
  layoutDursSv,
  layoutOffsetsSv,
  dragLiveSv,
}) {
  const uri = typeof clip?.uri === 'string' ? clip.uri : null;
  const durationFallback = Math.max(FRAME, Number(clip?.duration) || 0);
  const offsetFallback = Number(clip?.offset) || 0;
  const startFallback = Number(clip?.start) || 0;
  const spanFallback = Math.max(FRAME, Number(clip?.sourceSpan) > 0 ? Number(clip.sourceSpan) : sourceSpanOf(clip));
  const fileFallback = Number(clip?.sourceDuration) || 0;
  const [count, setCount] = useState(() => filmCount(durationFallback, PPS_DEFAULT, FILM_ASPECT));
  const [frames, setFrames] = useState([]);
  const genRef = useRef(0);
  const loadTimerRef = useRef(0);
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const paintSlot = useCallback((slot, fileUri) => {
    if (!fileUri) return;
    setFrames((prev) => {
      const next = prev.length ? prev.slice() : [];
      while (next.length <= slot) next.push(null);
      if (next[slot] === fileUri) return prev;
      next[slot] = fileUri;
      return next;
    });
  }, []);

  const loadWindow = useCallback((time, pps, pinch, total, duration, offset, clipStart) => {
    if (!uri || total <= 0) return;
    const live = Math.min(PPS_MAX, Math.max(PPS_MIN, pps * pinch));
    const clipLeft = width * 0.5 + (clipStart - time) * live;
    const clipW = Math.max(1, duration * live);
    const tileW = clipW / total;
    let from = Math.floor((0 - clipLeft) / Math.max(1, tileW)) - 1;
    let to = Math.ceil((width - clipLeft) / Math.max(1, tileW)) + 1;
    from = Math.max(0, from);
    to = Math.min(total - 1, to);
    const gen = genRef.current;
    const times = [];
    for (let i = 0; i < total; i += 1) {
      times.push(filmSourceTime(offset, spanFallback, fileFallback, i, total));
    }
    const next = framesRef.current.slice();
    while (next.length < total) next.push(null);
    if (next.length > total) next.length = total;
    for (let i = 0; i < total; i += 1) {
      const hit = peekNearest(uri, times[i]) || peekThumb(uri, times[i]);
      if (hit?.uri) next[i] = hit.uri;
    }
    setFrames(next);
    for (let i = from; i <= to; i += 1) {
      if (peekThumb(uri, times[i])) continue;
      requestThumb(uri, times[i], 20).then((frame) => {
        if (genRef.current !== gen || !frame?.uri) return;
        paintSlot(i, frame.uri);
      });
    }
  }, [uri, width, paintSlot, spanFallback, fileFallback]);

  const scheduleLoad = useCallback((time, pps, pinch, total, duration, offset, clipStart) => {
    if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      loadTimerRef.current = 0;
      loadWindow(time, pps, pinch, total, duration, offset, clipStart);
    }, 90);
  }, [loadWindow]);

  useEffect(() => {
    genRef.current += 1;
    loadWindow(
      timeSv.value,
      ppsSv.value,
      pinchSv.value,
      count,
      durationFallback,
      offsetFallback,
      startFallback
    );
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [loadWindow, count, uri, offsetFallback, startFallback]);

  useAnimatedReaction(
    () => {
      if (dragLiveSv.value >= 2) return -1;
      const duration = layoutDursSv.value[clipId] ?? durationFallback;
      const live = livePixelsPerSecond(ppsSv.value, pinchSv.value);
      return filmCount(duration, live, FILM_ASPECT);
    },
    (next, prev) => {
      if (next < 0 || next === prev) return;
      runOnJS(setCount)(next);
    }
  );

  useAnimatedReaction(
    () => {
      if (dragLiveSv.value >= 2) return -1;
      const duration = layoutDursSv.value[clipId] ?? durationFallback;
      const offset = layoutOffsetsSv.value[clipId] ?? offsetFallback;
      const clipStart = layoutStartsSv.value[clipId] ?? startFallback;
      const live = livePixelsPerSecond(ppsSv.value, pinchSv.value);
      const total = filmCount(duration, live, FILM_ASPECT);
      const clipLeft = width * 0.5 + (clipStart - timeSv.value) * live;
      const tileW = Math.max(1, (duration * live) / Math.max(1, total));
      const from = Math.max(0, Math.floor((0 - clipLeft) / tileW));
      return total * 1e6 + from;
    },
    (current, previous) => {
      if (current < 0 || current === previous) return;
      const duration = layoutDursSv.value[clipId] ?? durationFallback;
      const offset = layoutOffsetsSv.value[clipId] ?? offsetFallback;
      const clipStart = layoutStartsSv.value[clipId] ?? startFallback;
      const live = livePixelsPerSecond(ppsSv.value, pinchSv.value);
      const total = filmCount(duration, live, FILM_ASPECT);
      runOnJS(scheduleLoad)(
        timeSv.value,
        ppsSv.value,
        pinchSv.value,
        total,
        duration,
        offset,
        clipStart
      );
    }
  );

  if (!uri) return null;
  const slots = Array.from({ length: count }, (_, i) => frames[i] || null);
  return (
    <View pointerEvents="none" collapsable={false} style={styles.filmRow}>
      {slots.map((frame, slot) => (
        <View key={slot} style={styles.filmSlot}>
          {frame ? (
            <Image source={{ uri: frame }} style={styles.filmFrame} resizeMode="cover" />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const AudioBlock = memo(function AudioBlock({
  clip,
  ppsSv,
  pinchSv,
  dragFromSv,
  dragTxSv,
  layoutStartsSv,
  layoutDursSv,
  layoutSpansSv,
  speedPreviewIdSv,
  speedPreviewSpeedSv,
  dragLiveSv,
  trimStartSv,
  trimDurSv,
}) {
  const style = useLaneStyle(
    clip,
    ppsSv,
    pinchSv,
    dragFromSv,
    dragTxSv,
    layoutStartsSv,
    layoutDursSv,
    layoutSpansSv,
    dragLiveSv,
    trimStartSv,
    trimDurSv,
    false,
    speedPreviewIdSv,
    speedPreviewSpeedSv
  );
  return <Animated.View pointerEvents="none" style={[styles.audioClip, style]} />;
}, clipViewEqual);

const TimelineStripMemo = memo(TimelineStrip, (prev, next) => (
  prev.clips === next.clips
  && prev.selectedId === next.selectedId
  && prev.speedPreviewIdSv === next.speedPreviewIdSv
  && prev.speedPreviewSpeedSv === next.speedPreviewSpeedSv
  && prev.playingSv === next.playingSv
  && prev.timeSv === next.timeSv
));

const styles = StyleSheet.create({
  timelinePanel: {
    height: 168,
    backgroundColor: '#141414',
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333333',
  },
  timelineOrigin: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 168,
    zIndex: 2,
  },
  timelineTrack: {
    height: 168,
  },
  rulerSpacer: {
    height: RULER_H,
    marginTop: 4,
  },
  rulerOverlay: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    height: RULER_H,
    backgroundColor: '#1c1c1c',
    overflow: 'hidden',
    zIndex: 8,
  },
  strip: {
    height: 52,
    backgroundColor: '#1a1a1a',
  },
  clip: {
    position: 'absolute',
    top: 4,
    height: 44,
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#2f5f7a',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  clipBody: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  trimHitLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 18,
    zIndex: 8,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  trimHitRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 18,
    zIndex: 8,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  trimBar: {
    width: 3,
    height: '72%',
    borderRadius: 2,
    backgroundColor: '#23dddb',
    marginHorizontal: 2,
  },
  filmRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  filmSlot: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#2f5f7a',
  },
  filmFrame: {
    width: '100%',
    height: '100%',
  },
  clipLabel: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    zIndex: 2,
  },
  speedBadge: {
    position: 'absolute',
    right: 8,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    zIndex: 3,
  },
  speedBadgeText: {
    color: '#23dddb',
    fontSize: 10,
    fontWeight: '700',
  },
  audioStrip: {
    height: 24,
    marginTop: 2,
    backgroundColor: '#161616',
  },
  audioClip: {
    position: 'absolute',
    top: 2,
    height: 20,
    borderRightWidth: 1,
    borderRightColor: '#111111',
    backgroundColor: '#2a5c45',
  },
  playhead: {
    position: 'absolute',
    top: 14,
    bottom: 0,
    left: '50%',
    width: 2,
    marginLeft: -1,
    backgroundColor: '#E64B3C',
    zIndex: 20,
    elevation: 20,
  },
  playheadCap: {
    position: 'absolute',
    top: 0,
    left: '50%',
    zIndex: 21,
    elevation: 21,
    width: 0,
    height: 0,
    marginLeft: -7,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 10,
    borderTopColor: '#E64B3C',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});

export { FRAME, SPEED_MIN, SPEED_MAX, snapToFrame, toFrameIndex, TimelineStripMemo, asClipList, shiftClipInTime, trimClipInTime, setClipSpeedInTime, stampClipTimes, clipAtCompositionTime, sourceTimeForClip, clipSpeed, thumbCache };
