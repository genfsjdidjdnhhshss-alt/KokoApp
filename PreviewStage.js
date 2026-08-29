import React, { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { FRAME, asClipList, clipAtCompositionTime, sourceTimeForClip, clipSpeed, clipVolume, clipMuted, clipTransitionOut, clipTransitionDurationMs, volumeAtClipTime } from './TimelineEngine';
import { keysFor, staticValue } from './clipKeys';
import { grabFrame, peekExactThumb, peekThumb, resolveScrubSource, setFilmstripPaused } from './scrubFilmstrip';
import { immediatePlayUri, isFullPreviewProxy, originalUriOf, setPreviewBakePaused } from './previewProxy';
import { requestThumb } from './thumbBank';
import { loadExpoVideo } from './mediaNative';
import { toImageUri } from './clipPoster';
import { canvasAspectOf, fitCanvas, mediaAspectOf } from './editorCanvas';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

export const NATIVE_COMPOSITOR_ENABLED = true;
/** Image/thumbBank preview avoids Android TextureView green screen. */
export const PREVIEW_FORCE_IMAGE = true;

function PreviewFallback({ clockLabel, message }) {
  return (
    <View style={styles.preview}>
      <Text style={styles.empty}>{message}</Text>
      <View pointerEvents="none" style={styles.clockWrap}>
        <Text style={styles.clock}>{clockLabel || '00:00:00'}</Text>
      </View>
    </View>
  );
}

class PreviewGuard extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.failed) {
      return this.props.fallback || (
        <PreviewFallback
          clockLabel={this.props.clockLabel}
          message="El preview de video no está listo. La timeline sigue activa."
        />
      );
    }
    return this.props.children;
  }
}

class NativePreviewGuard extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.failed) return this.props.fallback || null;
    return this.props.children;
  }
}

function previewDocKey(clips, audioClips) {
  const part = (list) => asClipList(list).map((clip) => [
    clip.id,
    clip.originalUri || clip.uri || '',
    (Array.isArray(clip.keys) ? clip.keys.reduce((sum, key) => {
      const easeN = key.ease === 'in' ? 1 : key.ease === 'out' ? 2 : key.ease === 'inout' ? 3 : key.ease === 'hold' ? 4 : key.ease === 'bezier' ? 5 : 0;
      const bzN = Array.isArray(key.bz)
        ? Math.round((Number(key.bz[0]) || 0) * 20) + Math.round((Number(key.bz[1]) || 0) * 20) + Math.round((Number(key.bz[2]) || 0) * 20) + Math.round((Number(key.bz[3]) || 0) * 20)
        : 0;
      return sum + Math.round((Number(key.at) || 0) * 30) + Math.round((Number(key.value) || 0) * 50) + easeN * 11 + bzN;
    }, clip.keys.length) : 0),
    Number(clip.start) || 0,
    Number(clip.duration) || 0,
    Number(clip.offset) || 0,
    clipSpeed(clip),
    clipVolume(clip),
    clipMuted(clip) ? 1 : 0,
    clipTransitionOut(clip),
    clipTransitionDurationMs(clip),
    Number(clip.mediaWidth) || Number(clip.width) || 0,
    Number(clip.mediaHeight) || Number(clip.height) || 0,
  ].join(':')).join('|');
  return `${part(clips)}#${part(audioClips)}`;
}

function firstPlayableUri(clips) {
  const list = asClipList(clips);
  for (let i = 0; i < list.length; i += 1) {
    const uri = playUriOf(list[i]);
    if (uri) return uri;
  }
  return null;
}

function posterOfClip(clip) {
  if (!clip) return null;
  if (typeof clip.posterUri === 'string' && clip.posterUri) return toImageUri(clip.posterUri);
  const film = Array.isArray(clip.filmUris) ? clip.filmUris.find(Boolean) : null;
  return film ? toImageUri(film) : null;
}

function isStillImage(clip) {
  const uri = String(clip?.originalUri || clip?.uri || '');
  if (!uri) return false;
  if (/\.(jpe?g|png|webp|heic|heif|gif|bmp)(\?|#|$)/i.test(uri)) return true;
  const mime = String(clip?.mimeType || clip?.type || '');
  return mime.startsWith('image/');
}

function stillUriOf(clip) {
  return posterOfClip(clip) || (isStillImage(clip) ? toImageUri(clip?.originalUri || clip?.uri) : null);
}

function readPlayerMediaSize(player) {
  try {
    const size = player?.videoTrack?.size;
    const width = Math.round(Number(size?.width) || 0);
    const height = Math.round(Number(size?.height) || 0);
    if (width < 8 || height < 8) return null;
    return { width, height };
  } catch (_) {
    return null;
  }
}

function bezierMix(unit, x1, y1, x2, y2) {
  'worklet';
  const u = Math.min(1, Math.max(0, unit));
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let s = u;
  for (let n = 0; n < 8; n += 1) {
    const o = 1 - s;
    const x = (3 * o * o * s * x1) + (3 * o * s * s * x2) + (s * s * s);
    const dx = (3 * o * o * x1) + (6 * o * s * (x2 - x1)) + (3 * s * s * (1 - x2));
    if (Math.abs(dx) < 0.00001) break;
    s = Math.min(1, Math.max(0, s - ((x - u) / dx)));
  }
  const o = 1 - s;
  return (3 * o * o * s * y1) + (3 * o * s * s * y2) + (s * s * s);
}

function easeMix(unit, id, x1, y1, x2, y2) {
  'worklet';
  const t = Math.min(1, Math.max(0, unit));
  if (id === 4) return 0;
  if (id === 5) return bezierMix(t, x1, y1, x2, y2);
  if (id === 1) return t * t;
  if (id === 2) return 1 - (1 - t) * (1 - t);
  if (id === 3) return t < 0.5 ? 2 * t * t : 1 - (((-2 * t) + 2) * ((-2 * t) + 2)) / 2;
  return t;
}

function sampleCh(ch, local) {
  'worklet';
  if (!ch || !ch.at || !ch.at.length) return 0;
  const count = ch.at.length;
  if (local <= ch.at[0]) return ch.val[0];
  for (let i = 1; i < count; i += 1) {
    if (local <= ch.at[i]) {
      const span = Math.max(1 / 30, ch.at[i] - ch.at[i - 1]);
      const idx = i - 1;
      const mix = easeMix(
        (local - ch.at[i - 1]) / span,
        ch.ease[idx] || 0,
        ch.bx1 ? ch.bx1[idx] : 0,
        ch.by1 ? ch.by1[idx] : 0,
        ch.bx2 ? ch.bx2[idx] : 1,
        ch.by2 ? ch.by2[idx] : 1
      );
      return ch.val[i - 1] + (ch.val[i] - ch.val[i - 1]) * mix;
    }
  }
  return ch.val[count - 1];
}

function packClip(clip) {
  const start = Number.isFinite(Number(clip?.start)) ? Number(clip.start) : 0;
  const duration = Math.max(FRAME, Number(clip?.duration) || FRAME);
  const channel = (name) => {
    const keys = keysFor(clip, name);
    if (!keys.length) {
      return { at: [0], val: [staticValue(clip, name)], ease: [0], bx1: [0], by1: [0], bx2: [1], by2: [1] };
    }
    return {
      at: keys.map((key) => key.at),
      val: keys.map((key) => key.value),
      ease: keys.map((key) => (
        key.ease === 'in' ? 1 : key.ease === 'out' ? 2 : key.ease === 'inout' ? 3 : key.ease === 'hold' ? 4 : key.ease === 'bezier' ? 5 : 0
      )),
      bx1: keys.map((key) => (Array.isArray(key.bz) ? Number(key.bz[0]) || 0 : 0)),
      by1: keys.map((key) => (Array.isArray(key.bz) ? Number(key.bz[1]) || 0 : 0)),
      bx2: keys.map((key) => (Array.isArray(key.bz) ? Number(key.bz[2]) || 1 : 1)),
      by2: keys.map((key) => (Array.isArray(key.bz) ? Number(key.bz[3]) || 1 : 1)),
    };
  };
  return {
    start,
    duration,
    x: channel('x'),
    y: channel('y'),
    scale: channel('scale'),
    rot: channel('rot'),
    opacity: channel('opacity'),
  };
}

function samplePackXf(packs, t) {
  'worklet';
  const list = packs || [];
  let hit = list[0];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (t >= item.start && t < item.start + item.duration) {
      hit = item;
      break;
    }
  }
  if (!hit) {
    return { x: 0, y: 0, scale: 1, rot: 0, opacity: 1 };
  }
  const local = t - hit.start;
  return {
    x: sampleCh(hit.x, local),
    y: sampleCh(hit.y, local),
    scale: Math.max(0.1, sampleCh(hit.scale, local)),
    rot: sampleCh(hit.rot, local),
    opacity: sampleCh(hit.opacity, local),
  };
}

function PreviewXform({
  clips,
  clipsLiveRef,
  timeSv,
  width,
  height,
  liveXfSv,
  playingSv,
  packKey,
  canvasEnabled,
  onCommit,
  onArm = null,
  rasterize = false,
  children,
}) {
  const packsSv = useSharedValue(asClipList(clipsLiveRef?.current || clips).map(packClip));
  const fallbackXfSv = useSharedValue({ x: 0, y: 0, scale: 1, rot: 0, opacity: 1, active: 0 });
  const xfSv = liveXfSv || fallbackXfSv;
  const originSv = useSharedValue({ x: 0, y: 0, scale: 1, rot: 0, opacity: 1 });
  const armedSv = useSharedValue(0);
  const pinchFocalSv = useSharedValue({ x: 0, y: 0 });
  const guideVSv = useSharedValue(0);
  const guideHSv = useSharedValue(0);
  const canvasW = Math.max(1, Number(width) || 1);
  const canvasH = Math.max(1, Number(height) || 1);
  const spanX = canvasW * 0.5;
  const spanY = canvasH * 0.5;

  useEffect(() => {
    packsSv.value = asClipList(clipsLiveRef?.current || clips).map(packClip);
    const live = xfSv.value;
    if (live && live.active) {
      xfSv.value = {
        x: live.x,
        y: live.y,
        scale: live.scale,
        rot: live.rot,
        opacity: live.opacity,
        active: 0,
      };
    }
  }, [clips, clipsLiveRef, packKey, packsSv, xfSv]);

  const finish = useCallback((payload) => {
    onCommit?.(payload);
  }, [onCommit]);

  const gesture = useMemo(() => {
    const applyCenterSnap = (xf) => {
      'worklet';
      const snapPx = 10;
      const showPx = 36;
      let x = xf.x;
      let y = xf.y;
      let rot = xf.rot;
      const distV = Math.abs(x * spanX);
      const distH = Math.abs(y * spanY);
      const onV = distV <= snapPx;
      const onH = distH <= snapPx;
      if (onV) x = 0;
      if (onH) y = 0;
      if (Math.abs(rot) <= 3.5) rot = 0;
      else if (Math.abs(rot - 90) <= 3.5) rot = 90;
      else if (Math.abs(rot + 90) <= 3.5) rot = -90;
      else if (Math.abs(Math.abs(rot) - 180) <= 3.5) rot = rot > 0 ? 180 : -180;
      guideVSv.value = !onV && distV <= showPx ? 1 : 0;
      guideHSv.value = !onH && distH <= showPx ? 1 : 0;
      return {
        x,
        y,
        scale: xf.scale,
        rot,
        opacity: xf.opacity,
        active: 1,
      };
    };
    const captureOrigin = () => {
      'worklet';
      const live = xfSv.value;
      originSv.value = {
        x: live.x,
        y: live.y,
        scale: live.scale,
        rot: live.rot,
        opacity: live.opacity,
      };
    };
    const armFromPacks = () => {
      'worklet';
      if (playingSv) playingSv.value = false;
      if (armedSv.value) return true;
      if (onArm) runOnJS(onArm)();
      const xf = samplePackXf(packsSv.value, timeSv?.value || 0);
      originSv.value = xf;
      xfSv.value = {
        x: xf.x,
        y: xf.y,
        scale: xf.scale,
        rot: xf.rot,
        opacity: xf.opacity,
        active: 1,
      };
      armedSv.value = 1;
      return true;
    };
    const commitLive = () => {
      'worklet';
      if (!armedSv.value) return;
      const live = xfSv.value;
      const origin = originSv.value;
      armedSv.value = 0;
      guideVSv.value = 0;
      guideHSv.value = 0;
      if (!live) return;
      runOnJS(finish)({
        x: live.x,
        y: live.y,
        scale: live.scale,
        rot: live.rot,
        opacity: live.opacity,
        ox: origin.x,
        oy: origin.y,
        oscale: origin.scale,
        orot: origin.rot,
        posChanged: Math.abs(live.x - origin.x) > 0.002 || Math.abs(live.y - origin.y) > 0.002,
        scaleChanged: Math.abs(live.scale - origin.scale) > 0.008,
        rotChanged: Math.abs(live.rot - origin.rot) > 0.35,
      });
    };
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(0)
      .onBegin(() => {
        armFromPacks();
        captureOrigin();
      })
      .onUpdate((event) => {
        if (!armedSv.value) armFromPacks();
        const origin = originSv.value;
        const current = xfSv.value;
        xfSv.value = applyCenterSnap({
          x: origin.x + event.translationX / spanX,
          y: origin.y + event.translationY / spanY,
          scale: current.scale,
          rot: current.rot,
          opacity: current.opacity,
        });
      })
      .onEnd((event) => {
        if ((event.numberOfPointers || 0) > 0) return;
        commitLive();
      });
    const pinch = Gesture.Pinch()
      .onBegin((event) => {
        armFromPacks();
        captureOrigin();
        pinchFocalSv.value = { x: event.focalX, y: event.focalY };
      })
      .onUpdate((event) => {
        if (!armedSv.value) armFromPacks();
        const origin = originSv.value;
        const current = xfSv.value;
        const nextScale = Math.min(5, Math.max(0.15, origin.scale * event.scale));
        const ratio = nextScale / Math.max(0.15, origin.scale);
        const start = pinchFocalSv.value;
        const fx0 = start.x - spanX;
        const fy0 = start.y - spanY;
        const ox = origin.x * spanX;
        const oy = origin.y * spanY;
        const mx = event.focalX - start.x;
        const my = event.focalY - start.y;
        xfSv.value = applyCenterSnap({
          x: (fx0 - ((fx0 - ox) * ratio) + mx) / spanX,
          y: (fy0 - ((fy0 - oy) * ratio) + my) / spanY,
          scale: nextScale,
          rot: current.rot,
          opacity: current.opacity,
        });
      })
      .onEnd((event) => {
        if ((event.numberOfPointers || 0) > 0) return;
        commitLive();
      });
    const rotation = Gesture.Rotation()
      .onBegin(() => {
        armFromPacks();
        captureOrigin();
      })
      .onUpdate((event) => {
        if (!armedSv.value) armFromPacks();
        const origin = originSv.value;
        const current = xfSv.value;
        xfSv.value = applyCenterSnap({
          x: current.x,
          y: current.y,
          scale: current.scale,
          rot: origin.rot + ((event.rotation * 180) / Math.PI),
          opacity: current.opacity,
        });
      })
      .onEnd((event) => {
        if ((event.numberOfPointers || 0) > 0) return;
        commitLive();
      });
    return Gesture.Simultaneous(pan, pinch, rotation);
  }, [armedSv, finish, guideHSv, guideVSv, onArm, originSv, packsSv, pinchFocalSv, playingSv, spanX, spanY, timeSv, xfSv]);

  const guideVStyle = useAnimatedStyle(() => ({
    opacity: guideVSv.value,
  }));
  const guideHStyle = useAnimatedStyle(() => ({
    opacity: guideHSv.value,
  }));
  const layerStyle = useAnimatedStyle(() => {
    const live = xfSv.value;
    const xf = live && live.active ? live : samplePackXf(packsSv.value, timeSv?.value || 0);
    return {
      opacity: xf.opacity,
      transform: [
        { translateX: xf.x * spanX },
        { translateY: xf.y * spanY },
        { scale: Math.max(0.1, xf.scale) },
        { rotate: `${xf.rot}deg` },
      ],
    };
  });

  const stillKids = React.Children.map(children, (child) => {
    if (!React.isValidElement(child) || child.type !== CanvasFrameImage) return child;
    return React.cloneElement(child, { freezeSv: armedSv });
  });

  const host = (
    <View
      collapsable={false}
      style={{
        width: canvasW,
        height: canvasH,
        backgroundColor: '#000000',
        overflow: rasterize ? 'hidden' : 'visible',
      }}
    >
      <Animated.View
        collapsable={false}
        renderToHardwareTextureAndroid={Platform.OS === 'android' ? false : !!rasterize}
        shouldRasterizeIOS={!!rasterize}
        style={[styles.layer, { width: canvasW, height: canvasH }, layerStyle]}
      >
        {stillKids}
        <View pointerEvents="none" style={[styles.tikTokCorner, styles.tikTokTL]} />
        <View pointerEvents="none" style={[styles.tikTokCorner, styles.tikTokTR]} />
        <View pointerEvents="none" style={[styles.tikTokCorner, styles.tikTokBL]} />
        <View pointerEvents="none" style={[styles.tikTokCorner, styles.tikTokBR]} />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.guideV, { left: Math.max(0, canvasW * 0.5 - 0.5) }, guideVStyle]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.guideH, { top: Math.max(0, canvasH * 0.5 - 0.5) }, guideHStyle]}
      />
    </View>
  );

  if (!canvasEnabled || canvasW < 8 || canvasH < 8) return host;
  return (
    <GestureDetector gesture={gesture}>
      {host}
    </GestureDetector>
  );
}

function CanvasFrameImage({ clips, clipsLiveRef, timeSv, width, height, freezeSv }) {
  const [uri, setUri] = useState(null);
  const genRef = useRef(0);
  const pick = useCallback((time) => {
    const list = clipsLiveRef?.current || clips;
    const clip = clipAtCompositionTime(list, time) || asClipList(list)[0];
    const fallback = stillUriOf(clip);
    const sourceSec = sourceTimeForClip(clip, time);
    const timelineUri = originalUriOf(clip);

    const showFrame = (frameUri) => {
      const ready = frameUri ? toImageUri(frameUri) : null;
      if (!ready) return false;
      setUri((prev) => (ready !== prev ? ready : prev));
      return true;
    };

    const queueFrame = (fileUri, atSec, gen) => {
      requestThumb(fileUri, atSec, 20).then((frame) => {
        if (genRef.current !== gen || !frame?.uri) return;
        showFrame(frame.uri);
      }).catch(() => {
        if (fallback) setUri((prev) => (prev ? prev : fallback));
      });
    };

    // D: same thumb path as the timeline filmstrip (original URI).
    if (timelineUri) {
      const cached = peekThumb(timelineUri, sourceSec);
      if (cached?.uri && showFrame(cached.uri)) return;
      if (fallback) setUri((prev) => (prev ? prev : fallback));
      const gen = genRef.current + 1;
      genRef.current = gen;
      queueFrame(timelineUri, sourceSec, gen);
      return;
    }

    const src = resolveScrubSource(list, time);
    if (!src?.uri) {
      if (fallback) setUri((prev) => (fallback !== prev ? fallback : prev));
      return;
    }
    const cached = peekExactThumb(src.uri, src.sourceSec);
    if (cached && showFrame(cached)) return;
    if (fallback) setUri((prev) => (prev ? prev : fallback));
    const gen = genRef.current + 1;
    genRef.current = gen;
    grabFrame(src.uri, src.sourceSec).then((path) => {
      if (genRef.current !== gen) return;
      showFrame(path);
    }).catch(() => {
      if (fallback) setUri((prev) => (prev ? prev : fallback));
    });
  }, [clips, clipsLiveRef]);

  useAnimatedReaction(
    () => {
      if (freezeSv?.value) return -1;
      return Math.round((timeSv?.value || 0) * 24);
    },
    (bucket, previous) => {
      if (bucket < 0 || bucket === previous) return;
      runOnJS(pick)(timeSv?.value || 0);
    }
  );

  useEffect(() => {
    pick(timeSv?.value || 0);
  }, [clips, pick, timeSv]);

  if (!uri || width < 2 || height < 2) return null;
  return (
    <Image
      source={{ uri }}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        zIndex: 2,
        backgroundColor: '#000000',
      }}
      resizeMode="cover"
      fadeDuration={0}
      pointerEvents="none"
    />
  );
}

function PosterStill({
  clips,
  clipsLiveRef,
  timeSv,
  playingSv,
  liveXfSv,
  packKey,
  canvasEnabled,
  onCommit,
  canvasWidth = 0,
  canvasHeight = 0,
  seekRef,
}) {
  const [box, setBox] = useState({
    width: Math.max(0, Number(canvasWidth) || 0),
    height: Math.max(0, Number(canvasHeight) || 0),
  });
  useEffect(() => {
    const width = Math.round(Number(canvasWidth) || 0);
    const height = Math.round(Number(canvasHeight) || 0);
    if (width < 2 || height < 2) return;
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    if (!seekRef) return undefined;
    seekRef.current = {
      applyTime: () => {},
      playNow: () => {},
      pauseNow: () => {},
      setRate: () => {},
      armRate: () => {},
      setVolume: () => {},
      warmupRate: () => {},
    };
    return () => {
      if (seekRef) seekRef.current = null;
    };
  }, [seekRef]);

  const ready = box.width >= 2 && box.height >= 2;

  return (
    <View
      style={styles.videoFill}
      onLayout={(event) => {
        const next = event?.nativeEvent?.layout;
        const width = Math.round(Number(next?.width) || 0);
        const height = Math.round(Number(next?.height) || 0);
        if (width < 2 || height < 2) return;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {ready ? (
        <PreviewXform
          clips={clips}
          clipsLiveRef={clipsLiveRef}
          timeSv={timeSv}
          width={box.width}
          height={box.height}
          liveXfSv={liveXfSv}
          playingSv={playingSv}
          packKey={packKey}
          canvasEnabled={canvasEnabled}
          onCommit={onCommit}
          rasterize={Platform.OS !== 'android'}
        >
          <CanvasFrameImage
            clips={clips}
            clipsLiveRef={clipsLiveRef}
            timeSv={timeSv}
            width={box.width}
            height={box.height}
          />
        </PreviewXform>
      ) : null}
    </View>
  );
}

export function previewNativeRate(speed) {
  const value = Number(speed) || 1;
  if (value >= 3.5) return 4;
  if (value >= 1.5) return 2;
  if (value <= 0.75) return 0.5;
  return 1;
}

function playerReady(player, mounted = true) {
  if (!mounted) return false;
  if (player == null) return false;
  const kind = typeof player;
  if (kind === 'number' || kind === 'boolean' || kind === 'string' || kind === 'bigint') return false;
  if (kind !== 'object' && kind !== 'function') return false;
  if (Array.isArray(player)) return false;
  try {
    if (player.released === true) return false;
    const sharedId = player.__expo_shared_object_id__;
    if (sharedId != null && typeof sharedId !== 'number') return false;
    if (typeof player.play !== 'function' || typeof player.pause !== 'function') return false;
    const rate = player.playbackRate;
    if (rate != null && !Number.isFinite(Number(rate))) return false;
  } catch (_) {
    return false;
  }
  return true;
}

function playUriOf(clip) {
  return immediatePlayUri(clip);
}

function ProxyHold({ clockLabel, message }) {
  return (
    <View style={styles.preview}>
      <Text style={styles.empty}>{message}</Text>
      <View pointerEvents="none" style={styles.clockWrap}>
        <Text style={styles.clock}>{clockLabel || '00:00:00'}</Text>
      </View>
    </View>
  );
}

function ScrubOverlay({ clipsLiveRef, timeSv, scrubbingSv }) {
  const [uri, setUri] = useState(null);
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  const pushFrame = useCallback((compositionTime, show) => {
    if (!show) {
      shownRef.current = false;
      setVisible(false);
      return;
    }
    shownRef.current = true;
    setVisible(true);
    const src = resolveScrubSource(clipsLiveRef?.current || [], compositionTime);
    if (!src) return;
    const hit = toImageUri(peekThumb(src.uri, src.sourceSec));
    if (hit) setUri(hit);
  }, [clipsLiveRef]);

  useAnimatedReaction(
    () => {
      if (!scrubbingSv?.value || !timeSv) return -1;
      return Math.round(timeSv.value * 5);
    },
    (bucket, previous) => {
      if (bucket < 0) {
        if (previous >= 0) runOnJS(pushFrame)(timeSv.value, false);
        return;
      }
      runOnJS(pushFrame)(timeSv.value, true);
    }
  );

  if (!visible || !uri) return null;
  return (
    <Image
      source={{ uri }}
      style={styles.scrub}
      resizeMode="cover"
      pointerEvents="none"
    />
  );
}

function StageMattes({ stage, canvas }) {
  const stageW = Math.round(Number(stage?.width) || 0);
  const stageH = Math.round(Number(stage?.height) || 0);
  const canvasW = Math.round(Number(canvas?.width) || 0);
  const canvasH = Math.round(Number(canvas?.height) || 0);
  if (stageW < 2 || stageH < 2 || canvasW < 2 || canvasH < 2) return null;
  const x = Math.max(0, Math.round((stageW - canvasW) / 2));
  const y = Math.max(0, Math.round((stageH - canvasH) / 2));
  const right = Math.max(0, stageW - x - canvasW);
  const bottom = Math.max(0, stageH - y - canvasH);
  const fill = { backgroundColor: '#141414' };
  const cyan = '#23dddb';
  return (
    <View pointerEvents="none" style={styles.matteWrap}>
      <View style={[fill, { position: 'absolute', left: 0, right: 0, top: 0, height: y, borderBottomWidth: 1.5, borderBottomColor: cyan }]} />
      <View style={[fill, { position: 'absolute', left: 0, right: 0, bottom: 0, height: bottom, borderTopWidth: 1.5, borderTopColor: cyan }]} />
      <View style={[fill, { position: 'absolute', left: 0, width: x, top: y, height: canvasH, borderRightWidth: 1.5, borderRightColor: cyan }]} />
      <View style={[fill, { position: 'absolute', right: 0, width: right, top: y, height: canvasH, borderLeftWidth: 1.5, borderLeftColor: cyan }]} />
    </View>
  );
}

export const PreviewStage = memo(function PreviewStage({
  clips,
  audioClips = [],
  clipsLiveRef,
  playingSv,
  scrubbingSv,
  timeSv,
  clockLabel,
  speedLabel,
  seekRef,
  onNativeActive,
  selectedId,
  onCommitXform,
  onMediaSize,
}) {
  const video = useMemo(() => loadExpoVideo(), []);
  const liveXfSv = useSharedValue({ x: 0, y: 0, scale: 1, rot: 0, opacity: 1, active: 0 });
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const list = clipsLiveRef?.current || clips;
  const hasClips = asClipList(list).length > 0;
  const useStill = isStillImage(asClipList(list)[0]);
  const proxyUri = useStill ? null : firstPlayableUri(list);
  const packKey = previewDocKey(clips, audioClips);
  const canvasEnabled = hasClips;
  const canvasAspect = canvasAspectOf(list);
  const canvas = stage.width >= 2 && stage.height >= 2
    ? fitCanvas(stage.width, stage.height, canvasAspect)
    : { width: 0, height: 0 };

  useEffect(() => {
    onNativeActive?.(false);
    return () => onNativeActive?.(false);
  }, [onNativeActive]);

  const posterStill = (
    <PosterStill
      clips={clips}
      clipsLiveRef={clipsLiveRef}
      timeSv={timeSv}
      playingSv={playingSv}
      liveXfSv={liveXfSv}
      packKey={packKey}
      canvasEnabled={canvasEnabled}
      onCommit={onCommitXform}
      canvasWidth={canvas.width}
      canvasHeight={canvas.height}
      seekRef={seekRef}
    />
  );

  const proxyPlayer = (
    !PREVIEW_FORCE_IMAGE
    && proxyUri
    && video?.useVideoPlayer
    && video?.VideoView
  )
    ? (
      <PreviewVideoMemo
        VideoView={video.VideoView}
        useVideoPlayer={video.useVideoPlayer}
        clips={clips}
        clipsLiveRef={clipsLiveRef}
        uri={proxyUri}
        playingSv={playingSv}
        scrubbingSv={scrubbingSv}
        timeSv={timeSv}
        seekRef={seekRef}
        liveXfSv={liveXfSv}
        packKey={packKey}
        canvasEnabled={canvasEnabled}
        onCommit={onCommitXform}
        onMediaSize={onMediaSize}
        canvasWidth={canvas.width}
        canvasHeight={canvas.height}
      />
    )
    : posterStill;

  if (!hasClips) {
    if (seekRef) seekRef.current = null;
    return (
      <PreviewFallback
        clockLabel={clockLabel}
        message="Importa un video desde Galería para previsualizar."
      />
    );
  }

  return (
    <PreviewGuard clockLabel={clockLabel} fallback={posterStill}>
      <View
        style={styles.preview}
        onLayout={(event) => {
          const next = event?.nativeEvent?.layout;
          const width = Math.round(Number(next?.width) || 0);
          const height = Math.round(Number(next?.height) || 0);
          if (width < 2 || height < 2) return;
          setStage((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
        }}
      >
        {canvas.width >= 2 ? (
          <View collapsable={false} style={{ width: canvas.width, height: canvas.height }}>
            {proxyPlayer}
          </View>
        ) : (
          <View collapsable={false} style={styles.canvasMountFill}>
            {proxyPlayer}
          </View>
        )}
        <StageMattes stage={stage} canvas={canvas} />
        <View pointerEvents="none" style={styles.clockWrap}>
          {clockLabel ? <Text style={styles.clock}>{clockLabel}</Text> : null}
          {speedLabel ? <Text style={styles.speedTag}>{speedLabel}</Text> : null}
        </View>
      </View>
    </PreviewGuard>
  );
}, (prev, next) => (
  prev.clockLabel === next.clockLabel
  && prev.speedLabel === next.speedLabel
  && prev.playingSv === next.playingSv
  && prev.scrubbingSv === next.scrubbingSv
  && prev.timeSv === next.timeSv
  && prev.seekRef === next.seekRef
  && prev.clipsLiveRef === next.clipsLiveRef
  && previewDocKey(prev.clips, prev.audioClips) === previewDocKey(next.clips, next.audioClips)
  && prev.onNativeActive === next.onNativeActive
  && prev.selectedId === next.selectedId
  && prev.onCommitXform === next.onCommitXform
  && prev.onMediaSize === next.onMediaSize
));

const NativeCompositionPreview = memo(function NativeCompositionPreview({
  MediaPreview,
  project,
  nativeTimeForComposition,
  playingSv,
  scrubbingSv,
  timeSv,
  seekRef,
}) {
  const [playing, setPlaying] = useState(false);
  const [liveProject, setLiveProject] = useState(project);
  const [seekMs, setSeekMs] = useState(0);
  const mapRef = useRef(nativeTimeForComposition);
  const projectRef = useRef(project);
  mapRef.current = nativeTimeForComposition;
  projectRef.current = project;

  const commitSeek = useCallback((compositionTime) => {
    if (playingSv?.value || scrubbingSv?.value) return;
    const ms = Math.max(0, Math.round(mapRef.current?.(compositionTime) || 0));
    setSeekMs((prev) => (prev === ms ? prev : ms));
  }, [playingSv, scrubbingSv]);

  const firePlay = useCallback(() => {
    setFilmstripPaused(true);
    setPlaying(true);
  }, []);
  const firePause = useCallback(() => {
    setPlaying(false);
    setFilmstripPaused(!!scrubbingSv?.value);
  }, [scrubbingSv]);

  useAnimatedReaction(
    () => (playingSv?.value ? 1 : 0),
    (current, previous) => {
      if (current === previous) return;
      if (current) runOnJS(firePlay)();
      else if (previous != null) runOnJS(firePause)();
    }
  );

  useEffect(() => {
    commitSeek(timeSv?.value || 0);
  }, []);

  if (seekRef) {
    seekRef.current = {
      applyTime: (compositionTime) => {
        if (playingSv?.value || scrubbingSv?.value) return;
        commitSeek(compositionTime);
      },
      playNow: () => {},
      pauseNow: () => {},
      setRate: () => {},
      armRate: () => {},
      setVolume: () => {},
      warmupRate: () => {},
    };
  }

  useEffect(() => {
    if (playingSv?.value || scrubbingSv?.value) return;
    const next = projectRef.current;
    if (!next || next === liveProject) return;
    const handle = setTimeout(() => {
      if (playingSv?.value) return;
      setLiveProject(next);
    }, 800);
    return () => clearTimeout(handle);
  }, [project]);

  useEffect(() => () => {
    if (seekRef) seekRef.current = null;
  }, [seekRef]);

  const handleError = useCallback(() => {}, []);

  if (!liveProject || !MediaPreview) return null;

  return (
    <MediaPreview
      project={liveProject}
      playing={playing}
      time={seekMs}
      renderScale={1}
      onError={handleError}
      style={styles.video}
    />
  );
}, (prev, next) => (
  prev.project === next.project
  && prev.MediaPreview === next.MediaPreview
  && prev.playingSv === next.playingSv
  && prev.scrubbingSv === next.scrubbingSv
  && prev.timeSv === next.timeSv
  && prev.seekRef === next.seekRef
));

function PreviewVideo({
  VideoView,
  useVideoPlayer,
  clips,
  clipsLiveRef,
  uri,
  playingSv,
  scrubbingSv,
  timeSv,
  seekRef,
  liveXfSv,
  packKey,
  canvasEnabled,
  onCommit,
  onMediaSize,
  canvasWidth = 0,
  canvasHeight = 0,
}) {
  const sourceUri = useRef(uri || null);
  if (uri) sourceUri.current = uri;
  const [box, setBox] = useState({
    width: Math.max(0, Number(canvasWidth) || 0),
    height: Math.max(0, Number(canvasHeight) || 0),
  });
  useEffect(() => {
    const width = Math.round(Number(canvasWidth) || 0);
    const height = Math.round(Number(canvasHeight) || 0);
    if (width < 2 || height < 2) return;
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, [canvasWidth, canvasHeight]);
  const [livePlay, setLivePlay] = useState(false);
  useAnimatedReaction(
    () => (playingSv?.value ? 1 : 0),
    (current, previous) => {
      if (current === previous) return;
      runOnJS(setLivePlay)(!!current);
    }
  );
  const setupPlayer = (instance) => {
    if (!playerReady(instance, true)) return;
    try {
      instance.loop = false;
      instance.muted = false;
      instance.preservesPitch = true;
      instance.playbackRate = 1;
      if (typeof instance.timeUpdateEventInterval === 'number') {
        instance.timeUpdateEventInterval = 0;
      }
      if (instance.bufferOptions) {
        instance.bufferOptions = {
          preferredForwardBufferDuration: 2.5,
          minBufferForPlayback: 0.35,
          prioritizeTimeOverSizeThreshold: true,
        };
      }
    } catch (_) {}
  };
  const player = useVideoPlayer(sourceUri.current || uri || null, setupPlayer);

  const clipsRef = useRef(clips);
  const lastUriRef = useRef(uri || null);
  const lastClipIdRef = useRef(null);
  const lastRateRef = useRef(1);
  const lastGainKeyRef = useRef('');
  const lastPlayKeyRef = useRef('');
  const volumeOverrideRef = useRef(null);
  const compositionRef = useRef(0);
  const mountedRef = useRef(true);
  const playerRef = useRef(null);
  const replaceGen = useRef(0);
  const latestRef = useRef({});
  clipsRef.current = clipsLiveRef?.current || clips;
  playerRef.current = playerReady(player, mountedRef.current) ? player : null;

  const liveClips = () => asClipList(clipsLiveRef?.current || clipsRef.current);
  const clockTime = () => (timeSv && typeof timeSv.value === 'number' ? timeSv.value : compositionRef.current);
  const livePlayer = () => {
    const current = playerRef.current;
    return playerReady(current, mountedRef.current) ? current : null;
  };

  const setNativeRate = (rate) => {
    const current = livePlayer();
    if (!current) return;
    const next = Number(previewNativeRate(rate));
    if (!Number.isFinite(next) || next <= 0) return;
    if (Math.abs(lastRateRef.current - next) < 0.02) return;
    try {
      if (!playerReady(current, mountedRef.current)) return;
      current.playbackRate = next;
      lastRateRef.current = next;
    } catch (_) {}
  };

  const armRate = (rate) => {
    setNativeRate(rate);
  };

  const applyNativeGain = (clip) => {
    const current = livePlayer();
    if (!current) return;
    const override = volumeOverrideRef.current;
    const same = override && clip && String(override.id) === String(clip.id);
    const muted = same ? !!override.muted : clipMuted(clip);
    const start = Number.isFinite(Number(clip?.start)) ? Number(clip.start) : 0;
    const gain = same
      ? (override.muted ? 0 : override.volume)
      : volumeAtClipTime(clip, clockTime() - start);
    const key = `${clip?.id || ''}:${muted ? 1 : 0}:${Math.round(gain * 100)}`;
    if (key === lastGainKeyRef.current) return;
    lastGainKeyRef.current = key;
    try {
      current.muted = muted || gain <= 0.01;
      current.volume = current.muted ? 0 : gain;
    } catch (_) {}
  };

  const seekSource = (source) => {
    const current = livePlayer();
    if (!current) return;
    const target = Math.max(0, Number(source) || 0);
    const now = Number(current.currentTime);
    if (Number.isFinite(now) && Math.abs(now - target) <= FRAME * 2) return;
    try {
      current.currentTime = target;
    } catch (_) {}
  };

  const applyTime = (compositionTime, playingOverride) => {
    const current = livePlayer();
    if (!current) return;
    const livePlaying = playingOverride === true || (playingOverride !== false && !!playingSv?.value);
    if (scrubbingSv?.value && livePlaying) return;
    const list = liveClips();
    if (!list.length) return;
    const time = Math.max(0, Number(compositionTime) || 0);
    compositionRef.current = time;
    const clip = clipAtCompositionTime(list, time);
    if (!clip) {
      try {
        if (current.playing) current.pause?.();
      } catch (_) {}
      return;
    }
    const mapped = resolveScrubSource(list, time);
    const fadeUri = typeof clip.transitionCacheUri === 'string' && clip.transitionCacheUri
      ? clip.transitionCacheUri
      : null;
    const proxy = playUriOf(clip);
    let nextUri = (mapped?.uri && fadeUri && mapped.uri === fadeUri) ? fadeUri : proxy;
    if (livePlaying && lastUriRef.current && String(lastClipIdRef.current) === String(clip.id)) {
      nextUri = lastUriRef.current;
    }
    if (!nextUri) {
      try {
        if (current.playing) current.pause?.();
      } catch (_) {}
      return;
    }
    const switched = lastClipIdRef.current !== clip.id || lastUriRef.current !== nextUri;
    lastClipIdRef.current = clip.id;
    const source = mapped?.sourceSec ?? sourceTimeForClip(clip, time);

    const finish = () => {
      const live = livePlayer();
      if (!live) return;
      try {
        live.loop = false;
      } catch (_) {}
      applyNativeGain(clip);
      setNativeRate(clipSpeed(clip));
      if (livePlaying) {
        if (switched) seekSource(source);
        try {
          live.play?.();
        } catch (_) {}
        return;
      }
      try {
        if (live.playing) live.pause?.();
      } catch (_) {}
      seekSource(source);
    };

    if (lastUriRef.current !== nextUri) {
      lastUriRef.current = nextUri;
      sourceUri.current = nextUri;
      if (typeof current.replaceAsync !== 'function') {
        finish();
        return;
      }
      const gen = replaceGen.current + 1;
      replaceGen.current = gen;
      Promise.resolve(current.replaceAsync({ uri: nextUri })).then(() => {
        if (!mountedRef.current || replaceGen.current !== gen) return;
        finish();
      }).catch(() => {});
      return;
    }
    finish();
  };

  const playNative = () => {
    applyTime(clockTime(), true);
  };

  const pauseNative = () => {
    const current = livePlayer();
    if (!current) return;
    try {
      current.pause?.();
    } catch (_) {}
  };

  latestRef.current.playNative = playNative;
  latestRef.current.pauseNative = pauseNative;
  latestRef.current.applyTime = applyTime;
  latestRef.current.livePlayer = livePlayer;
  latestRef.current.onPlayTick = (compositionTime) => {
    compositionRef.current = compositionTime;
    const clip = clipAtCompositionTime(liveClips(), compositionTime);
    if (!clip) return;
    applyNativeGain(clip);
    const key = `${clip.id}:${previewNativeRate(clipSpeed(clip))}`;
    if (key !== lastPlayKeyRef.current) {
      lastPlayKeyRef.current = key;
      setNativeRate(clipSpeed(clip));
    }
    if (String(lastClipIdRef.current) !== String(clip.id)) {
      applyTime(compositionTime, true);
    }
  };

  if (seekRef) {
    seekRef.current = {
      applyTime,
      playNow: playNative,
      pauseNow: pauseNative,
      setRate: armRate,
      armRate,
      setVolume: (volume, muted, clipId) => {
        const nextGain = Math.min(1, Math.max(0, Number(volume) || 0));
        const nextMuted = !!muted || nextGain <= 0.01;
        volumeOverrideRef.current = {
          id: clipId,
          volume: nextGain,
          muted: nextMuted,
        };
        const clip = clipAtCompositionTime(liveClips(), clockTime());
        applyNativeGain(clip || { id: clipId, volume: nextGain, muted: nextMuted });
      },
      warmupRate: () => {},
    };
  }

  const firePlay = useCallback(() => {
    setFilmstripPaused(true);
    setPreviewBakePaused(true);
    latestRef.current.playNative?.();
  }, []);
  const firePause = useCallback(() => {
    setFilmstripPaused(false);
    setPreviewBakePaused(false);
    latestRef.current.pauseNative?.();
    latestRef.current.applyTime?.(clockTime(), false);
  }, []);
  const fireTick = useCallback((compositionTime) => {
    latestRef.current.onPlayTick?.(compositionTime);
  }, []);
  const applyPausedClock = useCallback((compositionTime) => {
    latestRef.current.applyTime?.(compositionTime, false);
  }, []);

  useEffect(() => {
    if (!uri || !livePlayer()) return;
    latestRef.current.applyTime?.(clockTime(), !!playingSv?.value);
  }, [uri, player]);

  useAnimatedReaction(
    () => (playingSv?.value ? 1 : 0),
    (current, previous) => {
      if (current === previous) return;
      if (current) runOnJS(firePlay)();
      else if (previous != null) runOnJS(firePause)();
    }
  );

  useAnimatedReaction(
    () => {
      if (!playingSv?.value || !timeSv) return -1;
      return Math.floor(timeSv.value * 2);
    },
    (tick, previous) => {
      if (tick < 0 || tick === previous) return;
      runOnJS(fireTick)(timeSv.value);
    }
  );

  useAnimatedReaction(
    () => {
      if (playingSv?.value || !timeSv) return -1;
      return Math.round(timeSv.value * 24);
    },
    (bucket, previous) => {
      if (bucket < 0 || bucket === previous) return;
      runOnJS(applyPausedClock)(timeSv.value);
    }
  );

  useEffect(() => {
    clipsRef.current = clipsLiveRef?.current || clips;
  }, [clips]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playerRef.current = null;
      if (seekRef) seekRef.current = null;
      try {
        const current = playerReady(player, true) ? player : null;
        current?.pause?.();
      } catch (_) {}
    };
  }, [player, seekRef]);

  useEffect(() => {
    let sub = null;
    const current = livePlayer();
    if (!current || typeof current.addListener !== 'function') return undefined;
    try {
      sub = current.addListener('playToEnd', () => {
        try {
          const live = livePlayer();
          if (!live) return;
          live.loop = false;
          if (playingSv?.value) {
            applyTime(clockTime(), true);
            return;
          }
          live.pause?.();
        } catch (_) {}
      });
    } catch (_) {}
    return () => {
      try {
        sub?.remove?.();
      } catch (_) {}
    };
  }, [player]);

  useEffect(() => {
    const current = livePlayer();
    if (!current || typeof onMediaSize !== 'function') return undefined;
    const publish = () => {
      const playingUri = lastUriRef.current || sourceUri.current;
      if (isFullPreviewProxy(playingUri) || (typeof playingUri === 'string' && playingUri.includes('prev-head'))) return;
      const size = readPlayerMediaSize(livePlayer() || current);
      if (!size) return;
      const clip = clipAtCompositionTime(liveClips(), clockTime()) || liveClips()[0];
      if (!clip || mediaAspectOf(clip) > 0) return;
      onMediaSize({ id: clip.id, width: size.width, height: size.height });
    };
    let sub = null;
    try {
      publish();
    } catch (_) {}
    try {
      if (typeof current.addListener === 'function') {
        sub = current.addListener('videoTrackChange', publish);
      }
    } catch (_) {}
    return () => {
      try {
        sub?.remove?.();
      } catch (_) {}
    };
  }, [onMediaSize, player]);

  if (!uri || !VideoView) {
    return (
      <PreviewFallback
        clockLabel=""
        message="Preparando el preview de video."
      />
    );
  }

  const cw = Math.max(2, box.width);
  const ch = Math.max(2, box.height);
  const ready = box.width >= 2 && box.height >= 2;

  return (
    <View
      collapsable={false}
      style={ready ? { width: cw, height: ch, backgroundColor: '#000000' } : styles.videoFill}
      onLayout={(event) => {
        const next = event?.nativeEvent?.layout;
        const width = Math.round(Number(next?.width) || 0);
        const height = Math.round(Number(next?.height) || 0);
        if (width < 2 || height < 2) return;
        setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }}
    >
      {ready ? (
        <PreviewXform
          clips={clips}
          clipsLiveRef={clipsLiveRef}
          timeSv={timeSv}
          width={cw}
          height={ch}
          liveXfSv={liveXfSv}
          playingSv={playingSv}
          packKey={packKey}
          canvasEnabled={canvasEnabled}
          onCommit={onCommit}
          rasterize={Platform.OS !== 'android' && !livePlay}
          onArm={() => setLivePlay(false)}
        >
          <CanvasFrameImage
            clips={clips}
            clipsLiveRef={clipsLiveRef}
            timeSv={timeSv}
            width={cw}
            height={ch}
          />
          {livePlay ? (
            <VideoView
              player={player}
              style={{ position: 'absolute', left: 0, top: 0, width: cw, height: ch, zIndex: 1 }}
              nativeControls={false}
              contentFit="cover"
              surfaceType={Platform.OS === 'android' ? 'surfaceView' : 'textureView'}
              pointerEvents="none"
            />
          ) : null}
        </PreviewXform>
      ) : null}
    </View>
  );
}

const PreviewVideoMemo = memo(PreviewVideo, (prev, next) => (
  prev.uri === next.uri
  && prev.playingSv === next.playingSv
  && prev.scrubbingSv === next.scrubbingSv
  && prev.timeSv === next.timeSv
  && prev.VideoView === next.VideoView
  && prev.useVideoPlayer === next.useVideoPlayer
  && prev.liveXfSv === next.liveXfSv
  && prev.packKey === next.packKey
  && prev.canvasEnabled === next.canvasEnabled
  && prev.onCommit === next.onCommit
  && prev.onMediaSize === next.onMediaSize
  && prev.canvasWidth === next.canvasWidth
  && prev.canvasHeight === next.canvasHeight
));

const styles = StyleSheet.create({
  preview: {
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
    height: '100%',
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matteWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 8,
  },
  canvasMount: {
    backgroundColor: '#000000',
  },
  canvasMountFill: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: '#000000',
  },
  videoFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  xformHost: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  layer: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: 'transparent',
  },
  tikTokCorner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderColor: '#ffffff',
  },
  tikTokTL: { left: 0, top: 0, borderLeftWidth: 2.5, borderTopWidth: 2.5 },
  tikTokTR: { right: 0, top: 0, borderRightWidth: 2.5, borderTopWidth: 2.5 },
  tikTokBL: { left: 0, bottom: 0, borderLeftWidth: 2.5, borderBottomWidth: 2.5 },
  tikTokBR: { right: 0, bottom: 0, borderRightWidth: 2.5, borderBottomWidth: 2.5 },
  guideV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: '#FE2C55',
    zIndex: 40,
  },
  guideH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1.5,
    backgroundColor: '#FE2C55',
    zIndex: 40,
  },
  clipFrame: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 21,
    borderWidth: 1.5,
    borderColor: '#23dddb',
  },
  canvasHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  hiddenPlayer: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -8,
    top: -8,
    opacity: 0,
    overflow: 'hidden',
  },
  parkedVideo: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -24,
    top: -24,
    opacity: 0,
  },
  keyHit: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    backgroundColor: 'transparent',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  frameOverlay: {
    zIndex: 1,
  },
  prepWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 12,
    alignItems: 'center',
    zIndex: 2,
  },
  prepText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.45)',
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  scrub: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: '#000000',
  },
  empty: {
    color: '#999999',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  clockWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    zIndex: 12,
  },
  clock: {
    color: '#23dddb',
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  speedTag: {
    color: '#23dddb',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
});
