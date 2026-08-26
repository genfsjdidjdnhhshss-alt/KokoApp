import React, { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FRAME, asClipList, clipAtCompositionTime, sourceTimeForClip, clipSpeed } from './TimelineEngine';
import { loadExpoVideo } from './mediaNative';
import { runOnJS, useAnimatedReaction } from 'react-native-reanimated';

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
      return (
        <PreviewFallback
          clockLabel={this.props.clockLabel}
          message="El preview de video no está listo. La timeline sigue activa."
        />
      );
    }
    return this.props.children;
  }
}

function firstClipUri(clips) {
  const list = asClipList(clips);
  for (let i = 0; i < list.length; i += 1) {
    const uri = list[i]?.previewUri || list[i]?.uri;
    if (typeof uri === 'string' && uri.length) return uri;
  }
  return null;
}

export function previewNativeRate(speed) {
  const value = Number(speed) || 1;
  if (value >= 3.5) return 4;
  if (value >= 1.5) return 2;
  if (value <= 0.75) return 0.5;
  return 1;
}

function playerReady(player) {
  return !!(player && typeof player.play === 'function' && typeof player.pause === 'function');
}

export const PreviewStage = memo(function PreviewStage({ clips, clipsLiveRef, playingSv, timeSv, clockLabel, speedLabel, seekRef }) {
  const video = useMemo(() => loadExpoVideo(), []);
  const uri = firstClipUri(clipsLiveRef?.current || clips);
  if (!uri || !video?.useVideoPlayer || !video?.VideoView) {
    if (seekRef) seekRef.current = null;
    return (
      <PreviewFallback
        clockLabel={clockLabel}
        message={
          uri
            ? 'Video listo en la pista. Reconstruye el dev client para ver el reproductor nativo.'
            : 'Importa un video desde Galería para previsualizar.'
        }
      />
    );
  }
  return (
    <PreviewGuard clockLabel={clockLabel}>
      <View style={styles.preview}>
        <PreviewVideoMemo
          VideoView={video.VideoView}
          useVideoPlayer={video.useVideoPlayer}
          clips={clips}
          clipsLiveRef={clipsLiveRef}
          uri={uri}
          playingSv={playingSv}
          timeSv={timeSv}
          seekRef={seekRef}
        />
        <View pointerEvents="none" style={styles.clockWrap}>
          <Text style={styles.clock}>{clockLabel || '00:00:00'}</Text>
          {speedLabel ? <Text style={styles.speedTag}>{speedLabel}</Text> : null}
        </View>
      </View>
    </PreviewGuard>
  );
});

function clipOutPoint(clip) {
  const offset = Math.max(0, Number(clip?.offset) || 0);
  const span = Number(clip?.sourceSpan);
  if (Number.isFinite(span) && span > 0) return offset + span;
  const duration = Math.max(0, Number(clip.duration) || 0);
  return offset + duration * clipSpeed(clip);
}

function isAtClipEnd(clip, compositionTime, source) {
  if (!clip) return true;
  const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : 0;
  const duration = Math.max(0, Number(clip.duration) || 0);
  const end = start + duration;
  const outPoint = clipOutPoint(clip);
  return compositionTime >= end - FRAME * 0.5 || source >= outPoint - FRAME * 0.5;
}

function PreviewVideo({ VideoView, useVideoPlayer, clips, clipsLiveRef, uri, playingSv, timeSv, seekRef }) {
  const sourceUri = useRef(uri || null);
  if (uri && !sourceUri.current) sourceUri.current = uri;
  const player = useVideoPlayer(sourceUri.current || uri || null, (instance) => {
    if (!instance) return;
    try {
      instance.loop = false;
      instance.muted = false;
      instance.preservesPitch = true;
      instance.playbackRate = 1;
      if (typeof instance.timeUpdateEventInterval === 'number') {
        instance.timeUpdateEventInterval = 0;
      }
    } catch (_) {}
  });

  const clipsRef = useRef(clips);
  const lastUriRef = useRef(uri || null);
  const lastSeekRef = useRef(-1);
  const lastRateRef = useRef(1);
  const pendingRateRef = useRef(1);
  const compositionRef = useRef(0);
  const mountedRef = useRef(true);
  const replaceGen = useRef(0);
  const latestRef = useRef({});
  const rateTimerRef = useRef(0);
  const lastPlayKeyRef = useRef('');
  clipsRef.current = clipsLiveRef?.current || clips;

  const liveClips = () => asClipList(clipsLiveRef?.current || clipsRef.current);
  const clockTime = () => (timeSv && typeof timeSv.value === 'number' ? timeSv.value : compositionRef.current);

  const playUriOf = (clip) => (
    (typeof clip?.previewUri === 'string' && clip.previewUri)
    || (typeof clip?.uri === 'string' && clip.uri)
    || null
  );

  const setNativeRate = (rate) => {
    if (!playerReady(player) || typeof player.playbackRate !== 'number') return;
    const next = previewNativeRate(rate);
    pendingRateRef.current = next;
    if (Math.abs(lastRateRef.current - next) < 0.02) return;
    try {
      player.playbackRate = next;
      lastRateRef.current = next;
    } catch (_) {}
  };

  const armRate = (rate) => {
    pendingRateRef.current = previewNativeRate(rate);
  };

  const applyPlayRate = (compositionTime) => {
    if (!mountedRef.current || !playingSv?.value) return;
    const clip = clipAtCompositionTime(liveClips(), Math.max(0, Number(compositionTime) || 0));
    if (!clip) return;
    const native = previewNativeRate(clipSpeed(clip));
    pendingRateRef.current = native;
    const key = `${clip.id}:${native}`;
    if (key === lastPlayKeyRef.current) return;
    lastPlayKeyRef.current = key;
    setNativeRate(native);
  };

  const seekSource = (source) => {
    if (!playerReady(player)) return;
    const target = Math.max(0, Number(source) || 0);
    const current = Number(player.currentTime);
    const offBy = Number.isFinite(current) ? Math.abs(current - source) : 1;
    if (offBy <= FRAME) return;
    try {
      player.currentTime = target;
      lastSeekRef.current = target;
    } catch (_) {}
  };

  const playNative = () => {
    if (!mountedRef.current || !playerReady(player)) return;
    const time = clockTime();
    const clip = clipAtCompositionTime(liveClips(), time);
    if (clip) {
      pendingRateRef.current = previewNativeRate(clipSpeed(clip));
      setNativeRate(pendingRateRef.current);
    }
    try {
      player.muted = false;
      player.volume = 1;
      player.play?.();
    } catch (_) {}
  };

  const pauseNative = () => {
    if (rateTimerRef.current) {
      clearTimeout(rateTimerRef.current);
      rateTimerRef.current = 0;
    }
    try {
      player.pause?.();
    } catch (_) {}
  };

  const applyTime = (compositionTime, playingOverride) => {
    if (!mountedRef.current || !playerReady(player)) return;
    const list = liveClips();
    if (!list.length) return;
    const time = Math.max(0, Number(compositionTime) || 0);
    compositionRef.current = time;
    const clip = clipAtCompositionTime(list, time);
    if (!clip) {
      try {
        if (player.playing) player.pause?.();
      } catch (_) {}
      return;
    }
    const nextUri = playUriOf(clip);
    if (!nextUri) return;
    const source = sourceTimeForClip(clip, time);
    const livePlaying = playingOverride === true || (playingOverride !== false && !!playingSv?.value);

    const finish = () => {
      if (!mountedRef.current || !playerReady(player)) return;
      try {
        player.loop = false;
      } catch (_) {}
      if (livePlaying) {
        return;
      }
      try {
        if (player.playing) player.pause?.();
      } catch (_) {}
      armRate(clipSpeed(clip));
      seekSource(source);
    };

    if (lastUriRef.current !== nextUri) {
      lastUriRef.current = nextUri;
      sourceUri.current = nextUri;
      if (typeof player.replaceAsync !== 'function') {
        finish();
        return;
      }
      const gen = replaceGen.current + 1;
      replaceGen.current = gen;
      Promise.resolve(player.replaceAsync({ uri: nextUri })).then(() => {
        if (!mountedRef.current || replaceGen.current !== gen) return;
        lastSeekRef.current = -1;
        finish();
      }).catch(() => {});
      return;
    }
    finish();
  };

  latestRef.current.playNative = playNative;
  latestRef.current.pauseNative = pauseNative;
  latestRef.current.onPlayTick = (compositionTime) => {
    compositionRef.current = compositionTime;
    applyPlayRate(compositionTime);
  };

  if (seekRef) {
    seekRef.current = {
      applyTime,
      playNow: playNative,
      pauseNow: pauseNative,
      setRate: armRate,
      armRate,
      warmupRate: () => {},
    };
  }

  const firePlay = useCallback(() => {
    latestRef.current.playNative?.();
  }, []);
  const firePause = useCallback(() => {
    latestRef.current.pauseNative?.();
  }, []);
  const fireTick = useCallback((compositionTime) => {
    latestRef.current.onPlayTick?.(compositionTime);
  }, []);

  useAnimatedReaction(
    () => (playingSv?.value ? 1 : 0),
    (current, previous) => {
      if (current === previous) return;
      if (current) runOnJS(firePlay)();
      else runOnJS(firePause)();
    }
  );

  useAnimatedReaction(
    () => {
      if (!playingSv?.value || !timeSv) return -1;
      return Math.round(timeSv.value * 4);
    },
    (tick, previous) => {
      if (tick < 0 || tick === previous) return;
      runOnJS(fireTick)(timeSv.value);
    }
  );

  useLayoutEffect(() => {
    clipsRef.current = clipsLiveRef?.current || clips;
  }, [clips]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
      if (seekRef) seekRef.current = null;
      try {
        if (playerReady(player)) player.pause?.();
      } catch (_) {}
    };
  }, [player, seekRef]);

  useEffect(() => {
    let sub = null;
    if (!playerReady(player) || typeof player.addListener !== 'function') return undefined;
    try {
      sub = player.addListener('playToEnd', () => {
        try {
          if (!mountedRef.current) return;
          player.loop = false;
          if (playingSv?.value) {
            applyPlayRate(clockTime());
            return;
          }
          setNativeRate(1);
          player.pause?.();
        } catch (_) {}
      });
    } catch (_) {}
    return () => {
      try {
        sub?.remove?.();
      } catch (_) {}
    };
  }, [player]);

  if (!uri || !VideoView) {
    return (
      <PreviewFallback
        clockLabel=""
        message="Preparando el preview de video."
      />
    );
  }

  return (
    <VideoView
      player={player}
      style={styles.video}
      nativeControls={false}
      contentFit="contain"
    />
  );
}

const PreviewVideoMemo = memo(PreviewVideo, (prev, next) => (
  prev.uri === next.uri
  && prev.playingSv === next.playingSv
  && prev.timeSv === next.timeSv
  && prev.VideoView === next.VideoView
  && prev.useVideoPlayer === next.useVideoPlayer
));

const styles = StyleSheet.create({
  preview: {
    flex: 1,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  video: {
    flex: 1,
    width: '100%',
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
