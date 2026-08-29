import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FRAME, SPEED_MIN, SPEED_MAX, snapToFrame, toFrameIndex, TimelineStripMemo, asClipList, shiftClipInTime, shiftAudioClipInTime, trimClipInTime, trimAudioClipInTime, setClipSpeedInTime, setClipVolumeInTime, setClipTransitionInTime, stampClipTimes, clipAtCompositionTime, clipSpeed, clipVolume, clipMuted, clipTransitionOut, clipTransitionDurationMs, hasOutgoingJoin, totalDuration, toggleVolumeKeyframe, toggleClipKeyframes, moveClipKeyframes, mapClipById } from './TimelineEngine';
import { applyCanvasXform, applyChannelAtTime, applyMotionIn, applyMotionOut, clearVisualKeys, hasKeyAt, MOTION_PRESETS, nearestKeyTime, outgoingKey, pasteKeySnapshot, setBezierOnSegment, setEaseAtTime, snapshotClipKeys, stampChannel, transformAt, valueAt, keysFor, VISUAL_CHANNELS, EASE_MODES, channelRange, splitKeys, withKeys, toggleKeysAtTime } from './clipKeys';
import { BezierGraph } from './BezierGraph';
import { PreviewStage, previewNativeRate, NATIVE_COMPOSITOR_ENABLED } from './PreviewStage';
import { MusicBed } from './MusicBed';
import { fadeCacheKey } from './clipsToMediaProject';
import { syncFadeCaches } from './transitionCache';
import { syncPreviewProxies } from './previewProxy';
import { exportTimeline, isRebuildError } from './ExportEngine';
import { DEFAULT_EXPORT_SETTINGS, ExportSettingsPanel, resolveExportSettings } from './ExportSettingsPanel';
import { canvasAspectOf, canvasPixelsFromAspect } from './editorCanvas';
import { loadImagePicker, loadExpoAudio } from './mediaNative';
import { ensureLocalVideo, ensurePoster, ensureFilmstrip } from './clipPoster';
import { CapCutTabBar, KeyMark, SoonHint, VisorKeyIcon, VisorPlayIcon } from './EditorChrome';
import { AUDIO_TABS, GLOBAL_TABS, SOON_COPY, VIDEO_TABS } from './editorTheme';

const FPS = 30;
const CYAN = '#23dddb';

function formatClock(time) {
  const totalFrames = Math.max(0, Math.round(time * FPS));
  const frames = totalFrames % FPS;
  const totalSecs = Math.floor(totalFrames / FPS);
  const secs = totalSecs % 60;
  const mins = Math.floor(totalSecs / 60);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

function parseDurationLabel(label) {
  const parts = String(label).split(':');
  if (parts.length === 2) {
    return Math.max(0.4, Number(parts[0]) * 60 + Number(parts[1]));
  }
  return Math.max(0.4, Number(label) || 4);
}

function toTimelineClip(item) {
  const duration = item.durationSec != null ? Math.max(0.4, Number(item.durationSec)) : parseDurationLabel(item.duration);
  const offset = Number(item.offset) || 0;
  return {
    id: item.id,
    label: item.title || item.label || 'Video',
    duration,
    offset,
    sourceDuration: Number(item.sourceDuration) || Number(item.durationSec) || (offset + duration),
    sourceSpan: Number(item.sourceSpan) || duration,
    speed: clipSpeed(item) || 1,
    volume: Number.isFinite(Number(item.volume)) ? Math.min(1, Math.max(0, Number(item.volume))) : 1,
    muted: !!item.muted,
    transitionOut: clipTransitionOut(item),
    transitionDurationMs: clipTransitionDurationMs(item),
    uri: item.uri || null,
    originalUri: item.originalUri || item.uri || null,
    previewUri: item.previewUri || null,
    posterUri: item.posterUri || null,
    filmUris: Array.isArray(item.filmUris) ? item.filmUris : [],
    keys: Array.isArray(item.keys) ? item.keys : [],
    volumeKeys: Array.isArray(item.volumeKeys) ? item.volumeKeys : [],
    tx: Number.isFinite(Number(item.tx)) ? Number(item.tx) : 0,
    ty: Number.isFinite(Number(item.ty)) ? Number(item.ty) : 0,
    scale: Number.isFinite(Number(item.scale)) ? Number(item.scale) : 1,
    rot: Number.isFinite(Number(item.rot)) ? Number(item.rot) : 0,
    opacity: Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : 1,
    mediaWidth: Number(item.mediaWidth) || Number(item.width) || 0,
    mediaHeight: Number(item.mediaHeight) || Number(item.height) || 0,
  };
}

function durationFromAsset(asset) {
  const raw = Number(asset?.duration);
  if (!Number.isFinite(raw) || raw <= 0) return 8;
  return raw > 50 ? raw / 1000 : raw;
}

function assetToGalleryItem(asset, index) {
  const uri = asset?.uri || asset?.localUri || null;
  if (!uri) return null;
  const durationSec = durationFromAsset(asset);
  return {
    id: String(asset?.assetId || uri || `imp-${Date.now()}-${index}`),
    title: asset?.fileName || `Video ${index + 1}`,
    durationSec,
    sourceDuration: durationSec,
    sourceSpan: durationSec,
    duration: `${Math.max(1, Math.round(durationSec))}s`,
    uri,
    originalUri: uri,
    previewUri: null,
    offset: 0,
    mediaWidth: Number(asset?.width) || 0,
    mediaHeight: Number(asset?.height) || 0,
  };
}

function splitClipsAtTime(clips, time) {
  const cut = snapToFrame(time);
  const cutFrame = toFrameIndex(cut);
  const list = asClipList(clips);
  let cursor = 0;
  const next = [];
  let didSplit = false;
  for (let index = 0; index < list.length; index += 1) {
    const clip = list[index];
    const duration = Number(clip.duration) || 0;
    const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : cursor;
    const end = start + duration;
    cursor = end;
    if (!didSplit && cut - start >= FRAME && end - cut >= FRAME) {
      const left = cut - start;
      const offset = Number(clip.offset) || 0;
      const speed = clipSpeed(clip);
      const sourceDuration = Number(clip.sourceDuration) || offset + duration * speed;
      const parentSpan = Number(clip.sourceSpan) || duration * speed;
      const leftSpan = left * speed;
      const split = splitKeys(clip, left);
      next.push(withKeys({
        ...clip,
        duration: left,
        offset,
        sourceDuration,
        sourceSpan: leftSpan,
        speed,
        start,
        end: cut,
        transitionOut: 'cut',
        transitionDurationMs: 0,
      }, split.left));
      next.push(withKeys({
        ...clip,
        id: `${clip.id}-s${cutFrame}`,
        duration: duration - left,
        offset: offset + leftSpan,
        sourceDuration,
        sourceSpan: Math.max(FRAME, parentSpan - leftSpan),
        speed,
        start: cut,
        end,
      }, split.right));
      didSplit = true;
    } else {
      next.push(clip);
    }
  }
  return didSplit ? next : list;
}

function PlayButton({ playingSv, timeSv, durationSv }) {
  const pressed = useSharedValue(0);

  const tap = useMemo(() => Gesture.Tap()
    .maxDuration(10000)
    .onBegin(() => {
      pressed.value = 1;
    })
    .onEnd(() => {
      if (playingSv.value) {
        playingSv.value = false;
        return;
      }
      const end = durationSv.value > 0 ? durationSv.value : FRAME;
      if (timeSv.value >= end - FRAME * 0.25) {
        timeSv.value = 0;
      }
      playingSv.value = true;
    })
    .onFinalize(() => {
      pressed.value = 0;
    }), [playingSv, timeSv, durationSv, pressed]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: pressed.value ? 0.97 : 1 }],
    opacity: pressed.value ? 0.75 : 1,
  }));
  const playLabel = useAnimatedStyle(() => ({
    opacity: playingSv.value ? 0 : 1,
  }));
  const pauseLabel = useAnimatedStyle(() => ({
    opacity: playingSv.value ? 1 : 0,
    position: 'absolute',
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.playHit, style]}>
        <Animated.Text style={[styles.play, playLabel]}>▶</Animated.Text>
        <Animated.Text style={[styles.play, pauseLabel]}>❚❚</Animated.Text>
      </Animated.View>
    </GestureDetector>
  );
}

function formatSpeedLabel(speed) {
  const value = Number(speed) || 1;
  if (Math.abs(value - 1) < 0.015) return '1.0x';
  if (value < 1) return `${value.toFixed(2)}x`;
  if (value >= 9.95) return '10x';
  return `${value.toFixed(value < 3 ? 2 : 1)}x`;
}

function unitFromSpeed(speed) {
  'worklet';
  const s = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed || 1));
  if (s <= 1) return ((s - SPEED_MIN) / (1 - SPEED_MIN)) * 0.5;
  return 0.5 + ((s - 1) / (SPEED_MAX - 1)) * 0.5;
}

function speedFromUnit(unit) {
  'worklet';
  const t = Math.min(1, Math.max(0, unit || 0));
  if (t <= 0.5) return SPEED_MIN + (t / 0.5) * (1 - SPEED_MIN);
  return 1 + ((t - 0.5) / 0.5) * (SPEED_MAX - 1);
}

function SpeedSlider({ speed, clipId, speedPreviewIdSv, speedPreviewSpeedSv, onDraft }) {
  const trackW = useSharedValue(1);
  const unitSv = useSharedValue(unitFromSpeed(speed));
  const armedSv = useSharedValue(0);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  useEffect(() => {
    if (armedSv.value) return;
    unitSv.value = unitFromSpeed(speed);
  }, [speed, unitSv, armedSv]);

  const finishDrag = useCallback((next) => {
    const rounded = Math.round(next * 100) / 100;
    onDraftRef.current?.(rounded);
  }, []);

  const gesture = useMemo(() => Gesture.Pan()
    .runOnJS(false)
    .minDistance(0)
    .onBegin((event) => {
      armedSv.value = 1;
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      const nextSpeed = speedFromUnit(unitSv.value);
      speedPreviewIdSv.value = String(clipId || '');
      speedPreviewSpeedSv.value = Math.min(SPEED_MAX, Math.max(SPEED_MIN, nextSpeed));
    })
    .onUpdate((event) => {
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      const nextSpeed = speedFromUnit(unitSv.value);
      speedPreviewIdSv.value = String(clipId || '');
      speedPreviewSpeedSv.value = Math.min(SPEED_MAX, Math.max(SPEED_MIN, nextSpeed));
    })
    .onFinalize(() => {
      if (!armedSv.value) return;
      armedSv.value = 0;
      runOnJS(finishDrag)(speedFromUnit(unitSv.value));
    }), [clipId, finishDrag, speedPreviewIdSv, speedPreviewSpeedSv, trackW, unitSv, armedSv]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.speedTrack}
        onLayout={(event) => {
          trackW.value = event.nativeEvent.layout.width;
        }}
      >
        <Animated.View style={[styles.speedFill, fillStyle]} />
        <Animated.View style={[styles.speedThumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

const SPEED_PRESETS = [0.5, 1, 2, 4];

function EditorTools({
  panel,
  onClosePanel,
  selectedVideo,
  selectedAudio,
  selectedClip,
  selectedIsAudio,
  canTransition,
  speedPreviewIdSv,
  speedPreviewSpeedSv,
  onDraftSpeed,
  onApplySpeed,
  onLiveVolume,
  onCommitVolume,
  onMuteVolume,
  onApplyTransition,
  onLiveChannel,
  onCommitChannel,
  onToggleChannelKey,
  onSetEase,
  onJumpKey,
  onCopyKeys,
  onPasteKeys,
  onCopyAllKeys,
  onClearKeys,
  onMotionIn,
  onMotionOut,
  onSetBezier,
  playheadLocal,
}) {
  if (typeof panel === 'string' && panel.startsWith('soon:')) {
    return <SoonHint kind={panel.slice(5)} />;
  }
  if (panel === 'speed' && selectedVideo) {
    return (
      <SpeedPanel
        clip={selectedVideo}
        speedPreviewIdSv={speedPreviewIdSv}
        speedPreviewSpeedSv={speedPreviewSpeedSv}
        onDraft={onDraftSpeed}
        onApply={(value) => {
          onApplySpeed?.(value);
          onClosePanel?.();
        }}
      />
    );
  }
  if (panel === 'transition' && canTransition) {
    return <TransitionPanel clip={selectedVideo} onApply={onApplyTransition} />;
  }
  if (panel === 'anim' && selectedVideo) {
    return (
      <TransformPanel
        clip={selectedVideo}
        playheadLocal={playheadLocal}
        onLiveChannel={onLiveChannel}
        onCommitChannel={onCommitChannel}
        onToggleChannelKey={onToggleChannelKey}
        onSetEase={onSetEase}
        onJumpKey={onJumpKey}
        onCopyKeys={onCopyKeys}
        onPasteKeys={onPasteKeys}
        onCopyAllKeys={onCopyAllKeys}
        onClearKeys={onClearKeys}
        onMotionIn={onMotionIn}
        onMotionOut={onMotionOut}
        onSetBezier={onSetBezier}
      />
    );
  }
  if (panel === 'volume' && selectedClip) {
    return (
      <VolumePanel
        clip={selectedClip}
        title={selectedIsAudio ? 'Música de fondo' : 'Audio original'}
        hint={
          selectedIsAudio
            ? 'Volumen de la pista verde. El audio del vídeo se ajusta por separado.'
            : 'Solo el sonido del clip de vídeo. La música de fondo tiene su propio control.'
        }
        onLive={onLiveVolume}
        onCommit={onCommitVolume}
        onMute={onMuteVolume}
      />
    );
  }
  return null;
}

const EditorToolsMemo = memo(EditorTools, (prev, next) => (
  prev.panel === next.panel
  && prev.selectedVideo === next.selectedVideo
  && prev.selectedAudio === next.selectedAudio
  && prev.selectedClip === next.selectedClip
  && prev.canTransition === next.canTransition
  && prev.playheadLocal === next.playheadLocal
  && prev.onClosePanel === next.onClosePanel
  && prev.onCommitChannel === next.onCommitChannel
  && prev.onToggleChannelKey === next.onToggleChannelKey
));

const TRANSITION_CHOICES = [
  { type: 'cut', durationMs: 0, label: 'Corte' },
  { type: 'crossfade', durationMs: 500, label: 'Fundido 0,5 s' },
  { type: 'crossfade', durationMs: 300, label: 'Fundido 0,3 s' },
];

const TransitionPanel = memo(function TransitionPanel({ clip, onApply }) {
  const type = clipTransitionOut(clip);
  const ms = clipTransitionDurationMs(clip);
  return (
    <View style={styles.speedPanel}>
      <View style={styles.speedHead}>
        <Text style={styles.speedTitle}>Al siguiente clip</Text>
        <Text style={styles.speedValue}>
          {type === 'crossfade' ? `Fundido ${(ms / 1000).toString().replace('.', ',')} s` : 'Corte'}
        </Text>
      </View>
      <Text style={styles.speedHint}>
        {type === 'crossfade'
          ? 'Al elegir fundido se renderiza el cruce en segundo plano. Play usa ese clip único, sin mezclar dos vídeos en vivo.'
          : 'Corte seco. Elige un fundido para solapar el siguiente clip, como en TikTok.'}
      </Text>
      <View style={styles.speedPresets}>
        {TRANSITION_CHOICES.map((choice) => {
          const active = type === choice.type && (choice.type === 'cut' || ms === choice.durationMs);
          return (
            <Pressable
              key={`${choice.type}-${choice.durationMs}`}
              style={[styles.speedPreset, active && styles.speedPresetOn]}
              onPress={() => onApply?.(choice.type, choice.durationMs)}
            >
              <Text style={[styles.speedPresetText, active && styles.speedPresetTextOn]}>{choice.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

function SpeedPanel({ clip, speedPreviewIdSv, speedPreviewSpeedSv, onDraft, onApply }) {
  const committed = clipSpeed(clip);
  const [shown, setShown] = useState(committed);
  useEffect(() => {
    setShown(committed);
  }, [clip?.id, committed]);
  useAnimatedReaction(
    () => speedPreviewSpeedSv.value,
    (current, previous) => {
      if (!speedPreviewIdSv.value) return;
      if (current === previous) return;
      runOnJS(setShown)(Math.round(current * 100) / 100);
    }
  );
  const span = Math.max(FRAME, Number(clip?.sourceSpan) > 0 ? Number(clip.sourceSpan) : (Number(clip?.duration) || FRAME) * committed);
  const trackSec = Math.max(FRAME, span / Math.max(SPEED_MIN, shown || 1));
  const draft = (value) => {
    const rounded = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(value * 100) / 100));
    setShown(rounded);
    onDraft?.(rounded);
  };
  return (
    <View style={styles.speedPanel}>
      <View style={styles.speedHead}>
        <Text style={styles.speedTitle}>Velocidad</Text>
        <Text style={styles.speedValue}>{formatSpeedLabel(shown)}</Text>
      </View>
      <Text style={styles.speedHint}>
        {shown >= 3.5
          ? 'El bloque se acorta. Pulsa Listo y luego Play.'
          : shown >= 1.5
            ? 'El bloque se acorta. Pulsa Listo para aplicar.'
            : shown <= 0.75
              ? 'El bloque se alarga. Pulsa Listo para aplicar.'
              : '1x: pulsa Listo para dejar recuadro y pista al mismo ritmo.'}
        {`  ${trackSec.toFixed(1)}s en pista`}
      </Text>
      <View style={styles.speedPresets}>
        {SPEED_PRESETS.map((preset) => {
          const on = Math.abs(shown - preset) < 0.04;
          return (
            <Pressable
              key={preset}
              onPress={() => draft(preset)}
              style={[styles.speedPreset, on && styles.speedPresetOn]}
            >
              <Text style={[styles.speedPresetText, on && styles.speedPresetTextOn]}>{preset}x</Text>
            </Pressable>
          );
        })}
      </View>
      <SpeedSlider
        speed={shown}
        clipId={clip?.id}
        speedPreviewIdSv={speedPreviewIdSv}
        speedPreviewSpeedSv={speedPreviewSpeedSv}
        onDraft={draft}
      />
      <View style={styles.speedMarks}>
        <Text style={styles.speedMark}>0.1x</Text>
        <Text style={styles.speedMark}>1x</Text>
        <Text style={styles.speedMark}>10x</Text>
      </View>
      <Pressable onPress={() => onApply?.(shown)} style={styles.speedDone}>
        <Text style={styles.speedDoneText}>Listo</Text>
      </Pressable>
    </View>
  );
}

function VolumeSlider({ value, unitSv, onLive, onCommit }) {
  const trackW = useSharedValue(1);
  const armedSv = useSharedValue(0);
  const liveBucketSv = useSharedValue(-1);
  const onLiveRef = useRef(onLive);
  const onCommitRef = useRef(onCommit);
  onLiveRef.current = onLive;
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (armedSv.value) return;
    unitSv.value = Math.min(1, Math.max(0, value || 0));
    liveBucketSv.value = -1;
  }, [value, unitSv, armedSv, liveBucketSv]);

  const emitLive = useCallback((next) => {
    onLiveRef.current?.(next);
  }, []);
  const emitCommit = useCallback((next) => {
    onCommitRef.current?.(next);
  }, []);

  const gesture = useMemo(() => Gesture.Pan()
    .runOnJS(false)
    .minDistance(0)
    .onBegin((event) => {
      armedSv.value = 1;
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      liveBucketSv.value = Math.round(unitSv.value * 12);
      runOnJS(emitLive)(unitSv.value);
    })
    .onUpdate((event) => {
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      const bucket = Math.round(unitSv.value * 12);
      if (bucket === liveBucketSv.value) return;
      liveBucketSv.value = bucket;
      runOnJS(emitLive)(unitSv.value);
    })
    .onFinalize(() => {
      if (!armedSv.value) return;
      armedSv.value = 0;
      liveBucketSv.value = -1;
      runOnJS(emitCommit)(unitSv.value);
    }), [emitLive, emitCommit, trackW, unitSv, armedSv, liveBucketSv]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.speedTrack}
        onLayout={(event) => {
          trackW.value = event.nativeEvent.layout.width;
        }}
      >
        <Animated.View style={[styles.speedFill, fillStyle]} />
        <Animated.View style={[styles.speedThumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

function VolumeValueLabel({ unitSv, muted }) {
  const [label, setLabel] = useState(muted ? 'Mute' : '100%');
  useAnimatedReaction(
    () => (muted ? -1 : Math.round(Math.min(1, Math.max(0, unitSv.value)) * 20)),
    (current, previous) => {
      if (current === previous) return;
      if (current < 0) {
        runOnJS(setLabel)('Mute');
        return;
      }
      runOnJS(setLabel)(`${current * 5}%`);
    }
  );
  return <Text style={styles.speedValue}>{label}</Text>;
}

const VolumePanel = memo(function VolumePanel({ clip, title = 'Audio original', hint, onLive, onCommit, onMute }) {
  const muted = clipMuted(clip);
  const stored = Number.isFinite(Number(clip?.volume)) ? Math.min(1, Math.max(0, Number(clip.volume))) : 1;
  const committed = muted ? 0 : stored;
  const unitSv = useSharedValue(committed);
  useEffect(() => {
    unitSv.value = committed;
  }, [clip?.id, committed, unitSv]);
  return (
    <View style={styles.speedPanel}>
      <View style={styles.speedHead}>
        <Text style={styles.speedTitle}>{title}</Text>
        <VolumeValueLabel unitSv={unitSv} muted={muted} />
      </View>
      <Text style={styles.speedHint}>
        {hint || 'Solo el sonido del vídeo. La música de fondo llega en el siguiente paso.'}
      </Text>
      <Pressable
        onPress={() => onMute?.(!muted)}
        style={[styles.speedPreset, muted && styles.speedPresetOn, styles.volumeMute]}
      >
        <Text style={[styles.speedPresetText, muted && styles.speedPresetTextOn]}>
          {muted ? 'Quitar mute' : 'Mute'}
        </Text>
      </Pressable>
      <VolumeSlider
        value={committed}
        unitSv={unitSv}
        onLive={onLive}
        onCommit={onCommit}
      />
      <View style={styles.speedMarks}>
        <Text style={styles.speedMark}>0</Text>
        <Text style={styles.speedMark}>50%</Text>
        <Text style={styles.speedMark}>100%</Text>
      </View>
    </View>
  );
}, (prev, next) => (
  prev.clip?.id === next.clip?.id
  && prev.clip?.volume === next.clip?.volume
  && prev.clip?.muted === next.clip?.muted
  && prev.clip?.keys === next.clip?.keys
  && prev.onLive === next.onLive
  && prev.onCommit === next.onCommit
  && prev.onMute === next.onMute
  && prev.title === next.title
  && prev.hint === next.hint
));

const TRANSFORM_ROWS = [
  { channel: 'x', label: 'Posición X' },
  { channel: 'y', label: 'Posición Y' },
  { channel: 'scale', label: 'Escala' },
  { channel: 'rot', label: 'Giro' },
  { channel: 'opacity', label: 'Opacidad' },
];

const EASE_LABELS = {
  linear: 'Lineal',
  in: 'Entrada',
  out: 'Salida',
  inout: 'Suave',
  hold: 'Mantener',
  bezier: 'Curva',
};

function unitFromChannel(channel, value) {
  const range = channelRange(channel);
  const span = range.max - range.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (Number(value) - range.min) / span));
}

function valueFromUnit(channel, unit) {
  const range = channelRange(channel);
  return range.min + Math.min(1, Math.max(0, Number(unit) || 0)) * (range.max - range.min);
}

function formatChannelValue(channel, value) {
  const num = Number(value) || 0;
  if (channel === 'rot') return `${Math.round(num)}°`;
  if (channel === 'opacity') return `${Math.round(num * 100)}%`;
  if (channel === 'scale') return `${num.toFixed(2)}x`;
  return num.toFixed(2);
}

const TransformPanel = memo(function TransformPanel({
  clip,
  playheadLocal,
  onLiveChannel,
  onCommitChannel,
  onToggleChannelKey,
  onSetEase,
  onJumpKey,
  onCopyKeys,
  onPasteKeys,
  onCopyAllKeys,
  onClearKeys,
  onMotionIn,
  onMotionOut,
  onSetBezier,
}) {
  const xf = transformAt(clip, playheadLocal);
  const motionIn = clip?.motionIn || 'none';
  const motionOut = clip?.motionOut || 'none';
  const fallbackChannel = TRANSFORM_ROWS.find((row) => keysFor(clip, row.channel).length >= 2)?.channel
    || TRANSFORM_ROWS.find((row) => keysFor(clip, row.channel).length > 0)?.channel
    || 'scale';
  const [pickedChannel, setPickedChannel] = useState(null);
  const graphChannel = pickedChannel || fallbackChannel;
  const currentEase = outgoingKey(clip, graphChannel, playheadLocal)?.ease
    || keysFor(clip, graphChannel)[0]?.ease
    || 'linear';
  return (
    <ScrollView style={styles.speedPanel} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={styles.speedHead}>
        <Text style={styles.speedTitle}>Animación</Text>
        <Text style={styles.speedValue}>{formatChannelValue('scale', xf.scale)}</Text>
      </View>
      <BezierGraph
        clip={clip}
        channel={graphChannel}
        playheadLocal={playheadLocal}
        onChange={(bz) => onSetBezier?.(graphChannel, bz)}
      />
      <View style={styles.speedPresets}>
        {TRANSFORM_ROWS.map((row) => (
          <Pressable
            key={`g-${row.channel}`}
            style={[styles.speedPreset, graphChannel === row.channel && styles.speedPresetOn]}
            onPress={() => setPickedChannel(row.channel)}
          >
            <Text style={[styles.speedPresetText, graphChannel === row.channel && styles.speedPresetTextOn]}>
              {row.label.replace('Posición ', '')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.speedHint}>
        Rombo cyan = key en el playhead. Arrastra el visor, pellizca o gira con dos dedos. Toca un rombo de la pista para ir a él.
      </Text>
      <Text style={styles.channelLabel}>Entrada</Text>
      <View style={styles.speedPresets}>
        {MOTION_PRESETS.map((item) => (
          <Pressable
            key={`in-${item.id}`}
            style={[styles.speedPreset, motionIn === item.id && styles.speedPresetOn]}
            onPress={() => onMotionIn?.(item.id)}
          >
            <Text style={[styles.speedPresetText, motionIn === item.id && styles.speedPresetTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.channelLabel, { marginTop: 6 }]}>Salida</Text>
      <View style={styles.speedPresets}>
        {MOTION_PRESETS.map((item) => (
          <Pressable
            key={`out-${item.id}`}
            style={[styles.speedPreset, motionOut === item.id && styles.speedPresetOn]}
            onPress={() => onMotionOut?.(item.id)}
          >
            <Text style={[styles.speedPresetText, motionOut === item.id && styles.speedPresetTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.keyNavRow}>
        <Pressable style={styles.speedPreset} onPress={() => onJumpKey?.(-1)}>
          <Text style={styles.speedPresetText}>‹ Key</Text>
        </Pressable>
        <Pressable style={styles.speedPreset} onPress={() => onJumpKey?.(1)}>
          <Text style={styles.speedPresetText}>Key ›</Text>
        </Pressable>
        <Pressable style={styles.speedPreset} onPress={onCopyKeys}>
          <Text style={styles.speedPresetText}>Copiar</Text>
        </Pressable>
        <Pressable style={styles.speedPreset} onPress={onPasteKeys}>
          <Text style={styles.speedPresetText}>Pegar</Text>
        </Pressable>
      </View>
      <View style={styles.keyNavRow}>
        <Pressable style={styles.speedPreset} onPress={onCopyAllKeys}>
          <Text style={styles.speedPresetText}>Copiar todo</Text>
        </Pressable>
        <Pressable style={styles.speedPreset} onPress={onClearKeys}>
          <Text style={styles.speedPresetText}>Limpiar</Text>
        </Pressable>
      </View>
      {TRANSFORM_ROWS.map((row) => {
        const value = valueAt(clip, row.channel, playheadLocal);
        const keyed = hasKeyAt(clip, playheadLocal, [row.channel]);
        const armed = keysFor(clip, row.channel).length > 0;
        return (
          <View key={row.channel} style={styles.channelRow}>
            <View style={styles.channelHead}>
              <Text style={styles.channelLabel}>{row.label}</Text>
              <Text style={styles.channelValue}>{formatChannelValue(row.channel, value)}</Text>
              <Pressable
                onPress={() => onToggleChannelKey?.(row.channel)}
                style={[styles.keyStampHit, (keyed || armed) && styles.keyStampHitOn]}
              >
                <KeyMark size={12} on={keyed} color={armed ? '#23dddb' : '#555555'} />
              </Pressable>
            </View>
            <ChannelSlider
              channel={row.channel}
              value={value}
              onLive={(next) => onLiveChannel?.(row.channel, next)}
              onCommit={(next) => onCommitChannel?.(row.channel, next)}
            />
          </View>
        );
      })}
      <View style={[styles.speedPresets, { paddingBottom: 8 }]}>
        {EASE_MODES.map((mode) => (
          <Pressable
            key={mode}
            style={[styles.speedPreset, currentEase === mode && styles.speedPresetOn]}
            onPress={() => onSetEase?.(mode)}
          >
            <Text style={[styles.speedPresetText, currentEase === mode && styles.speedPresetTextOn]}>
              {EASE_LABELS[mode]}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
});

function ChannelSlider({ channel, value, onLive, onCommit }) {
  const unitSv = useSharedValue(unitFromChannel(channel, value));
  const trackW = useSharedValue(1);
  const armedSv = useSharedValue(0);
  const liveBucketSv = useSharedValue(-1);
  const onLiveRef = useRef(onLive);
  const onCommitRef = useRef(onCommit);
  onLiveRef.current = onLive;
  onCommitRef.current = onCommit;

  useEffect(() => {
    if (armedSv.value) return;
    unitSv.value = unitFromChannel(channel, value);
  }, [channel, value, unitSv, armedSv]);

  const emitLive = useCallback((unit) => {
    onLiveRef.current?.(valueFromUnit(channel, unit));
  }, [channel]);
  const emitCommit = useCallback((unit) => {
    onCommitRef.current?.(valueFromUnit(channel, unit));
  }, [channel]);

  const gesture = useMemo(() => Gesture.Pan()
    .runOnJS(false)
    .minDistance(0)
    .onBegin((event) => {
      armedSv.value = 1;
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      liveBucketSv.value = Math.round(unitSv.value * 16);
      runOnJS(emitLive)(unitSv.value);
    })
    .onUpdate((event) => {
      const width = Math.max(1, trackW.value);
      unitSv.value = Math.min(1, Math.max(0, event.x / width));
      const bucket = Math.round(unitSv.value * 16);
      if (bucket === liveBucketSv.value) return;
      liveBucketSv.value = bucket;
      runOnJS(emitLive)(unitSv.value);
    })
    .onFinalize(() => {
      if (!armedSv.value) return;
      armedSv.value = 0;
      liveBucketSv.value = -1;
      runOnJS(emitCommit)(unitSv.value);
    }), [emitLive, emitCommit, trackW, unitSv, armedSv, liveBucketSv]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: `${Math.max(0, Math.min(1, unitSv.value)) * 100}%`,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.speedTrack}
        onLayout={(event) => {
          trackW.value = event.nativeEvent.layout.width;
        }}
      >
        <Animated.View style={[styles.speedFill, fillStyle]} />
        <Animated.View style={[styles.speedThumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
}

function SplitButton({ onQueue }) {
  const pressed = useSharedValue(0);
  const queueRef = useRef(onQueue);
  queueRef.current = onQueue;

  const fireQueue = useCallback(() => {
    queueRef.current?.();
  }, []);

  const tap = useMemo(() => Gesture.Tap()
    .maxDuration(10000)
    .onBegin(() => {
      pressed.value = 1;
    })
    .onEnd(() => {
      runOnJS(fireQueue)();
    })
    .onFinalize(() => {
      pressed.value = 0;
    }), [pressed, fireQueue]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: pressed.value ? 0.96 : 1 }],
    opacity: pressed.value ? 0.7 : 1,
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.splitHit, style]}>
        <Text style={styles.split}>Dividir</Text>
      </Animated.View>
    </GestureDetector>
  );
}

function HomeScreen({ onOpenGallery, onOpenNative }) {
  return (
    <View style={styles.home}>
      <Text style={styles.brand}>KOKO</Text>
      <Text style={styles.sub}>Studio</Text>
      <Text style={styles.note}>
        Galería importa videos reales del teléfono. Editor abre la timeline de KOKO Studio.
      </Text>
      <Pressable style={styles.btn} onPress={onOpenGallery}>
        <Text style={styles.btnText}>Galería</Text>
      </Pressable>
      <Pressable style={styles.btn} onPress={onOpenNative}>
        <Text style={[styles.btnText, { color: CYAN }]}>Editor nativo</Text>
      </Pressable>
    </View>
  );
}

function GalleryScreen({ onBack, selectedClips = [], libraryItems = [], onToggleClip, onImport, onAdd }) {
  const [tab, setTab] = useState('videos');
  const clips = asClipList(selectedClips);
  const selectedIds = clips.map((clip) => clip.id);
  const items = asClipList(libraryItems);

  return (
    <SafeAreaView style={styles.gallery}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.topAction}>Cerrar</Text>
        </Pressable>
        <Text style={styles.galleryTitle}>Recientes</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.tabs}>
        {['videos', 'fotos'].map((key) => (
          <Pressable
            key={key}
            style={styles.tabBtn}
            onPress={() => {
              setTab(key);
            }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>
              {key === 'videos' ? 'Videos' : 'Fotos'}
            </Text>
            <View style={[styles.tabLine, tab === key && styles.tabLineOn]} />
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.importBtn} onPress={onImport}>
        <Text style={styles.importText}>Importar video de la galería</Text>
      </Pressable>

      <View style={styles.grid}>
        {items.length ? items.map((item) => {
          const on = selectedIds.includes(item.id);
          return (
            <Pressable key={item.id} style={styles.tile} onPress={() => onToggleClip(item)}>
              <View style={[styles.tileInner, on && styles.tileOn]}>
                <Text style={styles.tileTitle}>{item.title}</Text>
                <Text style={styles.tileDuration}>{item.duration}</Text>
              </View>
            </Pressable>
          );
        }) : (
          <Pressable style={styles.emptyHit} onPress={onImport}>
            <Text style={styles.emptyLibrary}>
              Pulsa aquí o Importar para elegir un video de la galería del teléfono.
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.galleryFooter}>
        <Text style={styles.galleryStatus}>
          {clips.length ? `${clips.length} seleccionados` : 'Selecciona clips'}
        </Text>
        <Pressable
          style={[styles.btn, !clips.length && styles.btnDisabled]}
          onPress={onAdd}
        >
          <Text style={styles.btnText}>
            Agregar{clips.length ? ` (${clips.length})` : ''}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function NativeEditorScreen({ onBack, initialClips = [] }) {
  const insets = useSafeAreaInsets();
  const [clips, setClips] = useState(() => stampClipTimes(asClipList(initialClips)));
  const [time, setTime] = useState(0);
  const [selectedId, setSelectedId] = useState(() => asClipList(initialClips)[0]?.id ?? null);
  const [audioClips, setAudioClips] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState(DEFAULT_EXPORT_SETTINGS);
  const [nativePreviewActive, setNativePreviewActive] = useState(false);
  const [chromeTool, setChromeTool] = useState(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const speedPreviewIdSv = useSharedValue('');
  const speedPreviewSpeedSv = useSharedValue(1);
  const playingSv = useSharedValue(false);
  const scrubbingSv = useSharedValue(0);
  const timeSv = useSharedValue(0);
  const durationSv = useSharedValue(1);
  const controlRef = useRef(null);
  const previewSeekRef = useRef(null);
  const musicSeekRef = useRef(null);
  const audioLiveRef = useRef(null);
  const clockBucketRef = useRef(-1);
  const splitQueuedRef = useRef(false);
  const playingLiveRef = useRef(false);
  const clipsLiveRef = useRef(asClipList(clips));
  const pendingClipPatchesRef = useRef([]);
  const mediaTriedRef = useRef(new Set());
  const clipList = useMemo(() => asClipList(clips), [clips]);
  const audioList = useMemo(() => asClipList(audioClips), [audioClips]);
  clipsLiveRef.current = clipList;

  useEffect(() => {
    durationSv.value = Math.max(FRAME, totalDuration(clipList));
  }, [clipList, durationSv]);

  const flushClipPatches = useCallback(() => {
    if (playingSv.value || scrubbingSv.value) return;
    const queue = pendingClipPatchesRef.current;
    if (!queue.length) return;
    pendingClipPatchesRef.current = [];
    queue.forEach((apply) => apply());
  }, [playingSv, scrubbingSv]);

  const applyClipPatchWhenIdle = useCallback((apply) => {
    if (playingSv.value || scrubbingSv.value) {
      pendingClipPatchesRef.current.push(apply);
      return;
    }
    apply();
  }, [playingSv, scrubbingSv]);

  useAnimatedReaction(
    () => ((playingSv.value || scrubbingSv.value) ? 0 : 1),
    (idle, previous) => {
      if (!idle || idle === previous) return;
      runOnJS(flushClipPatches)();
    }
  );

  useEffect(() => {
    if (NATIVE_COMPOSITOR_ENABLED) return undefined;
    let cancelled = false;
    syncFadeCaches(clipList, (clipId, key, uri) => {
      if (cancelled) return;
      applyClipPatchWhenIdle(() => {
        if (cancelled) return;
        setClips((prev) => {
          const list = asClipList(prev);
          const ordered = list
            .map((clip, index) => ({ clip, index, start: Number.isFinite(Number(clip.start)) ? Number(clip.start) : index }))
            .sort((a, b) => (a.start - b.start) || (a.index - b.index));
          const at = ordered.findIndex((item) => String(item.clip.id) === String(clipId));
          if (at < 0 || at >= ordered.length - 1) return prev;
          if (fadeCacheKey(ordered[at].clip, ordered[at + 1].clip) !== key) return prev;
          if (ordered[at].clip.transitionCacheUri === uri && ordered[at].clip.transitionCacheKey === key) return prev;
          return list.map((clip) => (
            String(clip.id) === String(clipId)
              ? { ...clip, transitionCacheUri: uri, transitionCacheKey: key }
              : clip
          ));
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [clipList, applyClipPatchWhenIdle]);

  useEffect(() => {
    const handle = setTimeout(() => {
      syncPreviewProxies(clipsLiveRef.current, (originalUri, previewUri) => {
        setClips((prev) => {
          const list = asClipList(prev);
          let changed = false;
          const next = list.map((clip) => {
            const orig = clip.originalUri || clip.uri;
            if (orig !== originalUri) return clip;
            if (clip.previewUri === previewUri) return clip;
            changed = true;
            return { ...clip, originalUri: orig, previewUri };
          });
          return changed ? next : prev;
        });
      });
    }, 80);
    return () => clearTimeout(handle);
  }, [clipList]);

  useEffect(() => {
    let cancelled = false;
    asClipList(clipList).forEach((clip) => {
      const source = clip.originalUri || clip.uri;
      if (!source || source.startsWith('file://') || source.startsWith('http')) return;
      const key = `local:${source}`;
      if (mediaTriedRef.current.has(key)) return;
      mediaTriedRef.current.add(key);
      ensureLocalVideo(source).then((local) => {
        if (cancelled || !local || local === source) return;
        setClips((prev) => {
          const list = asClipList(prev);
          let changed = false;
          const next = list.map((item) => {
            const orig = item.originalUri || item.uri;
            if (orig !== source && item.uri !== source) return item;
            if (item.uri === local && item.originalUri === orig) return item;
            changed = true;
            return { ...item, uri: local, originalUri: orig };
          });
          return changed ? next : prev;
        });
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [clipList]);

  useEffect(() => {
    if (playingSv.value) return undefined;
    asClipList(clipList).forEach((clip) => {
      const fileUri = (clip.uri && clip.uri.startsWith('file://')) ? clip.uri : null;
      const orig = clip.originalUri || clip.uri;
      if (!clip.posterUri) {
        const posterSource = fileUri || orig;
        const posterKey = `poster:${orig || posterSource}`;
        if (posterSource && !mediaTriedRef.current.has(posterKey)) {
          mediaTriedRef.current.add(posterKey);
          ensurePoster(posterSource, Number(clip.offset) || 0).then((posterUri) => {
            if (!posterUri) return;
            setClips((prev) => {
              const list = asClipList(prev);
              let changed = false;
              const next = list.map((item) => {
                const itemOrig = item.originalUri || item.uri;
                if (itemOrig !== orig && item.uri !== fileUri) return item;
                if (item.posterUri) return item;
                changed = true;
                return { ...item, posterUri };
              });
              return changed ? next : prev;
            });
          }).catch(() => {});
        }
      }
      if (Array.isArray(clip.filmUris) && clip.filmUris.length >= 8) return;
      const filmSource = fileUri || orig;
      if (!filmSource) return;
      const filmKey = `film:${orig || filmSource}`;
      if (mediaTriedRef.current.has(filmKey)) return;
      mediaTriedRef.current.add(filmKey);
      ensureFilmstrip(filmSource, Number(clip.sourceDuration) || Number(clip.duration) || 4, Number(clip.offset) || 0).then((filmUris) => {
        if (!filmUris?.length) {
          mediaTriedRef.current.delete(filmKey);
          return;
        }
        setClips((prev) => {
          const list = asClipList(prev);
          let changed = false;
          const next = list.map((item) => {
            const itemOrig = item.originalUri || item.uri;
            if (itemOrig !== orig && item.uri !== orig && item.uri !== fileUri && item.uri !== filmSource) return item;
            if (Array.isArray(item.filmUris) && item.filmUris.length >= filmUris.length) return item;
            changed = true;
            return { ...item, filmUris, posterUri: item.posterUri || filmUris[0] };
          });
          return changed ? next : prev;
        });
      }).catch(() => {
        mediaTriedRef.current.delete(filmKey);
      });
    });
    return undefined;
  }, [clipList]);

  const selectedVideo = useMemo(
    () => clipList.find((clip) => String(clip.id) === String(selectedId)) || null,
    [clipList, selectedId]
  );
  const selectedAudio = useMemo(
    () => audioList.find((clip) => String(clip.id) === String(selectedId)) || null,
    [audioList, selectedId]
  );
  const selectedClip = selectedVideo || selectedAudio;
  const selectedIsAudio = !!selectedAudio;
  const canTransition = !!(selectedVideo && hasOutgoingJoin(clipList, selectedVideo.id));
  const playheadLocal = useMemo(() => {
    if (!selectedClip) return 0;
    const start = Number.isFinite(Number(selectedClip.start)) ? Number(selectedClip.start) : 0;
    const duration = Math.max(FRAME, Number(selectedClip.duration) || FRAME);
    return Math.min(duration - FRAME, Math.max(0, snapToFrame(time - start)));
  }, [selectedClip, time]);
  const keyframeOn = useMemo(() => {
    if (!selectedClip) return false;
    return hasKeyAt(selectedClip, playheadLocal, selectedIsAudio ? ['volume'] : [...VISUAL_CHANNELS, 'volume']);
  }, [selectedClip, playheadLocal, selectedIsAudio]);

  useEffect(() => {
    setChromeTool(null);
    speedPreviewIdSv.value = '';
  }, [selectedId, speedPreviewIdSv]);

  const audioListRef = useRef(audioList);
  audioListRef.current = audioList;
  audioLiveRef.current = audioList[0] || null;

  const toggleKeyframeAtPlayhead = useCallback(() => {
    const t = timeSv.value;
    const hit = selectedId
      || clipAtCompositionTime(clipsLiveRef.current, t)?.id
      || asClipList(clipsLiveRef.current)[0]?.id
      || audioListRef.current[0]?.id;
    if (!hit) return;
    if (String(selectedId) !== String(hit)) setSelectedId(hit);
    if (audioListRef.current.some((clip) => String(clip.id) === String(hit))) {
      setAudioClips((prev) => toggleVolumeKeyframe(prev, hit, t));
      return;
    }
    setClips((prev) => {
      const next = toggleClipKeyframes(prev, hit, t, [...VISUAL_CHANNELS, 'volume']);
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, [selectedId, timeSv]);

  const onTimelineTime = useCallback((nextTime) => {
    if (playingSv.value) return;
    if (scrubbingSv.value) return;
    previewSeekRef.current?.applyTime?.(nextTime);
    musicSeekRef.current?.applyTime?.(nextTime);
    const bucket = Math.round(Math.max(0, nextTime) * 10);
    if (bucket === clockBucketRef.current) return;
    clockBucketRef.current = bucket;
    setTime(nextTime);
  }, [playingSv, scrubbingSv]);

  const onPlayingChange = useCallback((next) => {
    playingLiveRef.current = !!next;
  }, []);

  const persistMoveRef = useRef((clipId, deltaTime) => {
    setClips((prev) => shiftClipInTime(prev, clipId, deltaTime));
  });
  const persistTrimRef = useRef((clipId, start, duration, offset) => {
    setClips((prev) => trimClipInTime(prev, clipId, start, duration, offset));
  });
  const persistKeyMoveRef = useRef((clipId, fromLocal, toLocal) => {});
  const keyPasteRef = useRef(null);
  persistMoveRef.current = (clipId, deltaTime) => {
    const id = String(clipId);
    if (audioListRef.current.some((clip) => String(clip.id) === id)) {
      setAudioClips((prev) => {
        const next = shiftAudioClipInTime(prev, clipId, deltaTime);
        audioLiveRef.current = asClipList(next)[0] || null;
        return next;
      });
      if (!playingSv.value) {
        musicSeekRef.current?.applyTime?.(timeSv.value);
      }
      return;
    }
    setClips((prev) => shiftClipInTime(prev, clipId, deltaTime));
  };
  persistTrimRef.current = (clipId, start, duration, offset) => {
    const id = String(clipId);
    if (audioListRef.current.some((clip) => String(clip.id) === id)) {
      setAudioClips((prev) => {
        const next = trimAudioClipInTime(prev, clipId, start, duration, offset);
        audioLiveRef.current = asClipList(next)[0] || null;
        return next;
      });
      if (!playingSv.value) {
        musicSeekRef.current?.applyTime?.(timeSv.value);
      }
      return;
    }
    setClips((prev) => trimClipInTime(prev, clipId, start, duration, offset));
  };
  persistKeyMoveRef.current = (clipId, fromLocal, toLocal) => {
    const id = String(clipId);
    if (audioListRef.current.some((clip) => String(clip.id) === id)) {
      setAudioClips((prev) => moveClipKeyframes(prev, clipId, fromLocal, toLocal));
      return;
    }
    setClips((prev) => {
      const next = moveClipKeyframes(prev, clipId, fromLocal, toLocal);
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  };

  const queueSplit = useCallback(() => {
    if (splitQueuedRef.current) return;
    splitQueuedRef.current = true;
    const cut = snapToFrame(controlRef.current?.getTime?.() ?? 0);
    playingLiveRef.current = false;
    controlRef.current?.pausePlayback?.();
    const apply = () => {
      if (!splitQueuedRef.current) return;
      splitQueuedRef.current = false;
      playingSv.value = false;
      const prev = clipsLiveRef.current;
      const next = splitClipsAtTime(prev, cut);
      if (next !== prev) {
        clipsLiveRef.current = asClipList(next);
        setClips(next);
        const hit = clipAtCompositionTime(next, cut)
          || asClipList(next).find((clip) => Math.abs((Number(clip.start) || 0) - cut) < FRAME);
        if (hit?.id != null) {
          setSelectedId(hit.id);
        }
      }
      clockBucketRef.current = Math.round(cut * 10);
      setTime(cut);
    };
    setTimeout(apply, 0);
  }, []);

  const onSelectClip = useCallback((clipId) => {
    setSelectedId(clipId);
  }, []);

  const draftClipSpeed = useCallback((nextSpeed) => {
    if (!selectedId || selectedIsAudio) return;
    const rounded = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(nextSpeed * 100) / 100));
    speedPreviewIdSv.value = String(selectedId);
    speedPreviewSpeedSv.value = rounded;
  }, [selectedId, selectedIsAudio, speedPreviewIdSv, speedPreviewSpeedSv]);

  const applyClipSpeed = useCallback((nextSpeed) => {
    if (!selectedId || selectedIsAudio) return;
    const rounded = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(nextSpeed * 100) / 100));
    const id = selectedId;
    playingSv.value = false;
    playingLiveRef.current = false;
    controlRef.current?.pausePlayback?.();
    previewSeekRef.current?.pauseNow?.();
    speedPreviewIdSv.value = String(id);
    speedPreviewSpeedSv.value = rounded;
    previewSeekRef.current?.armRate?.(rounded);
    if (selectedClip && Math.abs(clipSpeed(selectedClip) - rounded) < 0.015) {
      speedPreviewIdSv.value = '';
      return;
    }
    setClips((prev) => {
      const next = setClipSpeedInTime(prev, id, rounded);
      clipsLiveRef.current = asClipList(next);
      return next;
    });
    requestAnimationFrame(() => {
      previewSeekRef.current?.applyTime?.(timeSv.value);
    });
  }, [selectedClip, selectedId, selectedIsAudio, speedPreviewIdSv, speedPreviewSpeedSv]);

  const applyClipVolume = useCallback((gain, muted) => {
    if (!selectedId) return;
    const nextGain = Math.min(1, Math.max(0, Number(gain)));
    const nextMuted = muted === true || nextGain <= 0.01;
    const musicHit = audioListRef.current.find((clip) => String(clip.id) === String(selectedId));
    const target = musicHit || selectedVideo;
    const currentGain = Number(target?.volume);
    const currentMuted = clipMuted(target);
    const stored = nextMuted ? Math.max(nextGain, Number(target?.volume) || 1) : nextGain;
    if (musicHit) {
      musicSeekRef.current?.setVolume?.(nextMuted ? 0 : nextGain, nextMuted, selectedId);
    } else {
      previewSeekRef.current?.setVolume?.(nextMuted ? 0 : nextGain, nextMuted, selectedId);
    }
    const keyedVolume = !musicHit && keysFor(target, 'volume').length > 0;
    if (
      !keyedVolume
      && currentMuted === nextMuted
      && Number.isFinite(currentGain)
      && Math.abs(currentGain - stored) < 0.02
    ) return;
    if (musicHit) {
      setAudioClips((prev) => {
        const next = setClipVolumeInTime(prev, selectedId, stored, nextMuted);
        audioLiveRef.current = asClipList(next)[0] || null;
        return next;
      });
      return;
    }
    setClips((prev) => {
      let next = setClipVolumeInTime(prev, selectedId, stored, nextMuted);
      next = mapClipById(next, selectedId, (clip) => {
        if (nextMuted || !keysFor(clip, 'volume').length) return clip;
        return applyChannelAtTime(clip, timeSv.value, 'volume', nextGain, true);
      });
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, [selectedId, selectedVideo, timeSv]);

  const liveClipVolume = useCallback((gain) => {
    if (!selectedId) return;
    const nextGain = Math.min(1, Math.max(0, Number(gain)));
    const musicHit = audioListRef.current.some((clip) => String(clip.id) === String(selectedId));
    const setter = musicHit ? musicSeekRef.current : previewSeekRef.current;
    setter?.setVolume?.(nextGain, nextGain <= 0.01, selectedId);
  }, [selectedId]);

  const commitClipVolume = useCallback((gain) => {
    applyClipVolume(gain, gain <= 0.01);
  }, [applyClipVolume]);

  const muteClipVolume = useCallback((nextMuted) => {
    const target = selectedAudio || selectedVideo;
    const stored = Number(target?.volume);
    const restore = Number.isFinite(stored) && stored > 0.05 ? stored : 1;
    applyClipVolume(restore, nextMuted);
  }, [applyClipVolume, selectedAudio, selectedVideo]);

  const applyClipTransition = useCallback((type, durationMs) => {
    if (!selectedId || selectedIsAudio) return;
    setClips((prev) => {
      const next = setClipTransitionInTime(prev, selectedId, type, durationMs);
      clipsLiveRef.current = asClipList(next);
      return next;
    });
    requestAnimationFrame(() => {
      previewSeekRef.current?.applyTime?.(timeSv.value);
    });
  }, [selectedId, selectedIsAudio, timeSv]);

  const patchSelectedVideo = useCallback((mapper) => {
    if (!selectedId || selectedIsAudio) return;
    setClips((prev) => {
      const next = mapClipById(prev, selectedId, mapper);
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, [selectedId, selectedIsAudio]);

  const commitChannel = useCallback((channel, value) => {
    const t = timeSv.value;
    patchSelectedVideo((clip) => applyChannelAtTime(clip, t, channel, value, keysFor(clip, channel).length > 0));
  }, [patchSelectedVideo, timeSv]);

  const liveChannel = useCallback((channel, value) => {
    commitChannel(channel, value);
  }, [commitChannel]);

  const commitPreviewXform = useCallback((xf) => {
    if (!xf) return;
    const t = timeSv.value;
    const list = clipsLiveRef.current || [];
    const selectedHit = list.find((clip) => String(clip.id) === String(selectedId));
    const hit = (selectedHit && !selectedIsAudio ? selectedHit : null)
      || clipAtCompositionTime(list, t)
      || list[0];
    if (!hit) return;
    if (String(selectedId) !== String(hit.id)) setSelectedId(hit.id);
    setClips((prev) => {
      const next = mapClipById(prev, hit.id, (clip) => applyCanvasXform(clip, t, xf));
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, [selectedId, selectedIsAudio, timeSv]);

  const commitMediaSize = useCallback((info) => {
    const width = Math.round(Number(info?.width) || 0);
    const height = Math.round(Number(info?.height) || 0);
    if (width < 8 || height < 8) return;
    setClips((prev) => {
      const list = asClipList(prev);
      const hit = list.find((clip) => String(clip.id) === String(info?.id)) || list[0];
      if (!hit) return prev;
      if (Number(hit.mediaWidth) === width && Number(hit.mediaHeight) === height) return prev;
      const next = mapClipById(prev, hit.id, (clip) => ({
        ...clip,
        mediaWidth: width,
        mediaHeight: height,
      }));
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, []);

  const toggleChannelKey = useCallback((channel) => {
    const t = timeSv.value;
    patchSelectedVideo((clip) => toggleKeysAtTime(clip, t, [channel]));
  }, [patchSelectedVideo, timeSv]);

  const setEaseAtPlayhead = useCallback((ease) => {
    const t = timeSv.value;
    patchSelectedVideo((clip) => setEaseAtTime(clip, t, ease, VISUAL_CHANNELS));
  }, [patchSelectedVideo, timeSv]);

  const setBezierAtPlayhead = useCallback((channel, bz) => {
    if (!bz) return;
    const t = timeSv.value;
    patchSelectedVideo((clip) => setBezierOnSegment(clip, t, bz, [channel]));
  }, [patchSelectedVideo, timeSv]);

  const jumpKey = useCallback((direction) => {
    if (!selectedVideo) return;
    const start = Number.isFinite(Number(selectedVideo.start)) ? Number(selectedVideo.start) : 0;
    const local = playheadLocal;
    const nextLocal = nearestKeyTime(selectedVideo, local, direction, VISUAL_CHANNELS);
    if (nextLocal == null) return;
    controlRef.current?.seekTo?.(start + nextLocal);
  }, [playheadLocal, selectedVideo]);

  const copyKeys = useCallback(() => {
    if (!selectedVideo) return;
    keyPasteRef.current = { kind: 'pose', xf: transformAt(selectedVideo, playheadLocal) };
  }, [playheadLocal, selectedVideo]);

  const copyAllKeys = useCallback(() => {
    if (!selectedVideo) return;
    keyPasteRef.current = {
      ...snapshotClipKeys(selectedVideo),
      motionIn: selectedVideo.motionIn,
      motionOut: selectedVideo.motionOut,
    };
  }, [selectedVideo]);

  const pasteKeys = useCallback(() => {
    const packed = keyPasteRef.current;
    if (!packed || !selectedId || selectedIsAudio) return;
    const t = timeSv.value;
    if (packed.kind === 'clip') {
      patchSelectedVideo((clip) => pasteKeySnapshot(clip, packed));
      return;
    }
    const xf = packed.xf || packed;
    patchSelectedVideo((clip) => {
      let next = clip;
      VISUAL_CHANNELS.forEach((channel) => {
        next = stampChannel(next, channel, Math.max(0, t - (Number(clip.start) || 0)), xf[channel]);
      });
      return next;
    });
  }, [patchSelectedVideo, selectedId, selectedIsAudio, timeSv]);

  const clearKeys = useCallback(() => {
    patchSelectedVideo((clip) => clearVisualKeys(clip));
  }, [patchSelectedVideo]);

  const setMotionIn = useCallback((id) => {
    patchSelectedVideo((clip) => applyMotionIn(clip, id));
  }, [patchSelectedVideo]);

  const setMotionOut = useCallback((id) => {
    patchSelectedVideo((clip) => applyMotionOut(clip, id));
  }, [patchSelectedVideo]);

  const importMusic = useCallback(async () => {
    if (!loadExpoAudio()?.createAudioPlayer && !loadExpoAudio()?.useAudioPlayer) {
      Alert.alert(
        'Música',
        'expo-audio no está en este APK. Instala con npx expo install expo-audio y recompila: npx expo run:android'
      );
      return;
    }
    const picker = loadImagePicker();
    if (!picker?.launchImageLibraryAsync) {
      Alert.alert('Música', 'El selector nativo no está listo en este cliente.');
      return;
    }
    try {
      try {
        await picker.requestMediaLibraryPermissionsAsync?.(false);
      } catch (_) {}
      let result = null;
      try {
        result = await picker.launchImageLibraryAsync({
          mediaTypes: ['audio'],
          allowsMultipleSelection: false,
        });
      } catch (_) {
        result = await picker.launchImageLibraryAsync({
          mediaTypes: picker.MediaTypeOptions?.All || ['videos'],
          allowsMultipleSelection: false,
        });
      }
      if (!result || result.canceled || result.cancelled) return;
      const asset = Array.isArray(result.assets) ? result.assets[0] : result;
      const uri = asset?.uri || asset?.localUri;
      if (!uri) {
        Alert.alert('Música', 'No se pudo leer el archivo.');
        return;
      }
      const durationSec = durationFromAsset(asset);
      const start = snapToFrame(timeSv.value || 0);
      const next = {
        id: `aud-${Date.now()}`,
        kind: 'audio',
        label: asset?.fileName || 'Música',
        uri,
        start,
        duration: Math.max(FRAME, durationSec),
        offset: 0,
        sourceDuration: durationSec,
        sourceSpan: durationSec,
        volume: 0.8,
        muted: false,
        speed: 1,
      };
      setAudioClips([next]);
      audioLiveRef.current = next;
      setSelectedId(next.id);
    } catch (_) {
      Alert.alert('Música', 'No se pudo importar el audio. Tras recompilar con expo-audio, elige un MP3 o M4A.');
    }
  }, [timeSv]);

  const openExportPanel = useCallback(() => {
    if (exporting) return;
    if (!clipList.length) {
      Alert.alert('Exportar', 'Añade al menos un clip de video.');
      return;
    }
    playingSv.value = false;
    setExportOpen(true);
  }, [clipList, exporting, playingSv]);

  const runExport = useCallback(async () => {
    if (exporting) return;
    if (!clipList.length) {
      Alert.alert('Exportar', 'Añade al menos un clip de video.');
      return;
    }
    const chosen = resolveExportSettings(exportSettings);
    const pixels = canvasPixelsFromAspect(
      canvasAspectOf(clipList),
      Math.max(chosen.width, chosen.height)
    );
    playingSv.value = false;
    setExportOpen(false);
    setExporting(true);
    setExportProgress(0);
    try {
      const result = await exportTimeline(clipList, audioList, {
        width: pixels.width,
        height: pixels.height,
        fps: chosen.fps,
        bitrateMbps: chosen.bitrateMbps,
        quality: chosen.quality,
        onProgress: (value) => setExportProgress(Math.max(0, Math.min(1, Number(value) || 0))),
      });
      const saved = result?.saved;
      const saveReason = result?.saveReason;
      const qualityLabel = `${pixels.width}×${pixels.height}, ${chosen.fps} fps, ${chosen.bitrateMbps} Mbps`;
      Alert.alert(
        'Exportar',
        saved
          ? `MP4 guardado en la galería (${qualityLabel}).`
          : saveReason === 'permission'
            ? `MP4 listo (${qualityLabel}), pero hace falta permiso para guardarlo en la galería.`
            : saveReason === 'missing-module'
              ? `MP4 listo (${qualityLabel}). Reconstruye el cliente nativo (npx expo run:android) para guardarlo en la galería.`
              : `MP4 listo (${qualityLabel}). No se pudo copiar a la galería; el archivo quedó en la caché de la app.`
      );
    } catch (error) {
      if (isRebuildError(error)) {
        Alert.alert('Exportar', 'Reconstruye el cliente nativo (npx expo run:android) para habilitar exportProject.');
      } else {
        Alert.alert('Exportar', error?.message || 'No se pudo generar el MP4.');
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }, [audioList, clipList, exportSettings, exporting, playingSv]);

  useEffect(() => {
    const previewId = speedPreviewIdSv.value;
    if (!previewId) return;
    const hit = clipList.find((clip) => String(clip.id) === String(previewId));
    if (!hit) {
      speedPreviewIdSv.value = '';
      return;
    }
    if (Math.abs(clipSpeed(hit) - speedPreviewSpeedSv.value) < 0.015) {
      speedPreviewIdSv.value = '';
    }
  }, [clipList, speedPreviewIdSv, speedPreviewSpeedSv]);

  const chromeTabs = selectedAudio ? AUDIO_TABS : selectedVideo ? VIDEO_TABS : GLOBAL_TABS;
  const chromeActive = typeof chromeTool === 'string' && chromeTool.startsWith('soon:')
    ? chromeTool.slice(5)
    : chromeTool;
  const closeChromePanel = useCallback(() => {
    setChromeTool(null);
    speedPreviewIdSv.value = '';
  }, [speedPreviewIdSv]);
  const toggleChrome = useCallback((id) => {
    setChromeTool((prev) => (prev === id ? null : id));
  }, []);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    if (selectedIsAudio) {
      setAudioClips((prev) => prev.filter((clip) => String(clip.id) !== String(selectedId)));
      setSelectedId(null);
      return;
    }
    setClips((prev) => {
      const next = asClipList(prev).filter((clip) => String(clip.id) !== String(selectedId));
      clipsLiveRef.current = next;
      return next;
    });
    setSelectedId(null);
  }, [selectedId, selectedIsAudio]);
  const rotateSelected = useCallback(() => {
    if (!selectedVideo) return;
    const t = timeSv.value;
    setClips((prev) => {
      const next = mapClipById(prev, selectedVideo.id, (clip) => {
        const start = Number.isFinite(Number(clip.start)) ? Number(clip.start) : 0;
        const current = valueAt(clip, 'rot', t - start);
        const turned = ((current + 90 + 180) % 360) - 180;
        return applyChannelAtTime(clip, t, 'rot', turned, keysFor(clip, 'rot').length > 0);
      });
      clipsLiveRef.current = asClipList(next);
      return next;
    });
  }, [selectedVideo, timeSv]);
  const togglePlay = useCallback(() => {
    if (playingSv.value) {
      playingSv.value = false;
      return;
    }
    const end = durationSv.value > 0 ? durationSv.value : FRAME;
    if (timeSv.value >= end - FRAME * 0.25) {
      timeSv.value = 0;
    }
    playingSv.value = true;
  }, [durationSv, playingSv, timeSv]);
  const onChromeTab = useCallback((item) => {
    const id = item?.id;
    if (id === 'split') {
      queueSplit();
      return;
    }
    if (id === 'key') {
      toggleKeyframeAtPlayhead();
      return;
    }
    if (id === 'delete') {
      deleteSelected();
      return;
    }
    if (id === 'rotate') {
      rotateSelected();
      return;
    }
    if (id === 'audio') {
      if (selectedAudio || audioList.length) {
        toggleChrome('volume');
        return;
      }
      importMusic();
      return;
    }
    if (id === 'speed') {
      if (!selectedVideo) return;
      toggleChrome('speed');
      return;
    }
    if (id === 'anim' || id === 'adjust') {
      if (selectedVideo) {
        toggleChrome('anim');
        return;
      }
      setChromeTool('soon:adjust');
      return;
    }
    if (id === 'volume' || id === 'more') {
      if (id === 'more' && canTransition) {
        toggleChrome('transition');
        return;
      }
      if (selectedClip) {
        toggleChrome('volume');
        return;
      }
      return;
    }
    if (id === 'edit') {
      setSelectedId(null);
      setChromeTool('soon:edit');
      return;
    }
    if (SOON_COPY[id]) {
      setChromeTool(`soon:${id}`);
    }
  }, [
    audioList.length,
    canTransition,
    deleteSelected,
    importMusic,
    queueSplit,
    rotateSelected,
    selectedAudio,
    selectedClip,
    selectedVideo,
    toggleChrome,
    toggleKeyframeAtPlayhead,
  ]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.topBar}>
        <View style={styles.topLeftGroup}>
          <TouchableOpacity style={styles.iconBtn} onPress={onBack}>
            <Ionicons name="close" size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={styles.topRightGroup}>
          <TouchableOpacity style={[styles.iconBtn, styles.iconMuted]}>
            <Ionicons name="arrow-undo-outline" size={18} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, styles.iconMuted]}>
            <Ionicons name="arrow-redo-outline" size={18} color="#ffffff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportButton} onPress={openExportPanel} disabled={exporting}>
            <Text style={styles.exportText}>{exporting ? '…' : 'Exportar'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ExportSettingsPanel
        visible={exportOpen && !exporting}
        settings={exportSettings}
        onChange={setExportSettings}
        onCancel={() => setExportOpen(false)}
        onConfirm={runExport}
        busy={exporting}
      />

      <View style={styles.visorArea}>
        <View style={styles.videoBox}>
          <PreviewStage
            clips={clipList}
            audioClips={audioList}
            clipsLiveRef={clipsLiveRef}
            playingSv={playingSv}
            scrubbingSv={scrubbingSv}
            timeSv={timeSv}
            clockLabel=""
            speedLabel={null}
            seekRef={previewSeekRef}
            onNativeActive={setNativePreviewActive}
            selectedId={selectedId}
            onCommitXform={commitPreviewXform}
            onMediaSize={commitMediaSize}
          />
          <MusicBed
            playingSv={playingSv}
            timeSv={timeSv}
            musicUri={audioList[0]?.uri || null}
            musicLiveRef={audioLiveRef}
            seekRef={musicSeekRef}
            disabled={nativePreviewActive}
          />
        </View>
        <View style={styles.visorBottomControls} pointerEvents="box-none">
          <TouchableOpacity
            onPress={() => setPreviewExpanded((open) => !open)}
            hitSlop={8}
            style={styles.visorCtrlHit}
          >
            <Ionicons
              name={previewExpanded ? 'contract-outline' : 'expand-outline'}
              size={22}
              color="#ffffff"
            />
            <Text style={styles.visorCtrlHint}>{previewExpanded ? 'Cerrar' : 'Ampliar'}</Text>
          </TouchableOpacity>
          <View style={styles.visorCenter}>
            <VisorPlayIcon playingSv={playingSv} onToggle={togglePlay} />
          </View>
          <View style={styles.visorRightIcons}>
            <VisorKeyIcon
              timeSv={timeSv}
              clip={selectedClip}
              isAudio={selectedIsAudio}
              onToggle={toggleKeyframeAtPlayhead}
            />
          </View>
        </View>
      </View>

      {previewExpanded ? null : (
      <>
      <View style={styles.timelineArea}>
        <TimelineStripMemo
          clips={clipList}
          audioClips={audioList}
          selectedId={selectedId}
          onSelectClip={onSelectClip}
          onTimeChange={onTimelineTime}
          onPlayingChange={onPlayingChange}
          persistMoveRef={persistMoveRef}
          persistTrimRef={persistTrimRef}
          persistKeyMoveRef={persistKeyMoveRef}
          controlRef={controlRef}
          speedPreviewIdSv={speedPreviewIdSv}
          speedPreviewSpeedSv={speedPreviewSpeedSv}
          playingSv={playingSv}
          scrubbingSv={scrubbingSv}
          timeSv={timeSv}
        />
      </View>
      <View style={styles.timelineSpacer} />

      <View style={styles.toolbarArea}>
        <View style={styles.panelSlot}>
          <EditorToolsMemo
            panel={chromeTool}
            onClosePanel={closeChromePanel}
            selectedVideo={selectedVideo}
            selectedAudio={selectedAudio}
            selectedClip={selectedClip}
            selectedIsAudio={selectedIsAudio}
            canTransition={canTransition}
            speedPreviewIdSv={speedPreviewIdSv}
            speedPreviewSpeedSv={speedPreviewSpeedSv}
            onDraftSpeed={draftClipSpeed}
            onApplySpeed={applyClipSpeed}
            onLiveVolume={liveClipVolume}
            onCommitVolume={commitClipVolume}
            onMuteVolume={muteClipVolume}
            onApplyTransition={applyClipTransition}
            playheadLocal={playheadLocal}
            onLiveChannel={liveChannel}
            onCommitChannel={commitChannel}
            onToggleChannelKey={toggleChannelKey}
            onSetEase={setEaseAtPlayhead}
            onSetBezier={setBezierAtPlayhead}
            onJumpKey={jumpKey}
            onCopyKeys={copyKeys}
            onPasteKeys={pasteKeys}
            onCopyAllKeys={copyAllKeys}
            onClearKeys={clearKeys}
            onMotionIn={setMotionIn}
            onMotionOut={setMotionOut}
          />
        </View>
        <CapCutTabBar
          items={chromeTabs}
          activeId={chromeActive === 'anim' ? 'anim' : (keyframeOn ? 'key' : chromeActive)}
          onPress={onChromeTab}
        />
      </View>
      </>
      )}
      {exporting ? (
        <View pointerEvents="auto" style={styles.exportMask}>
          <ActivityIndicator color={CYAN} size="large" />
          <Text style={styles.exportMaskText}>
            Exportando {Math.round(exportProgress * 100)}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigation />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppNavigation() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedClips, setSelectedClips] = useState([]);
  const [libraryItems, setLibraryItems] = useState([]);
  const clipSelection = asClipList(selectedClips);

  const goTo = (nextScreen) => {
    setCurrentScreen(nextScreen);
  };

  const importFromDevice = async () => {
    const picker = loadImagePicker();
    if (!picker?.launchImageLibraryAsync) {
      Alert.alert(
        'Galería',
        'El selector nativo no está en este APK. Recompila con npx expo run:android para incluir expo-image-picker.'
      );
      return;
    }
    try {
      try {
        await picker.requestMediaLibraryPermissionsAsync?.(false);
      } catch (_) {}
      const options = {
        mediaTypes: ['videos', 'images'],
        allowsMultipleSelection: true,
        quality: 1,
        copyToCacheDirectory: false,
      };
      let result = null;
      try {
        result = await picker.launchImageLibraryAsync(options);
      } catch (_) {
        result = await picker.launchImageLibraryAsync({
          mediaTypes: picker.MediaTypeOptions?.All || ['videos', 'images'],
          quality: 1,
        });
      }
      if (!result || result.canceled || result.cancelled) return;
      const assets = Array.isArray(result.assets) ? result.assets : (result.uri ? [result] : []);
      const imported = [];
      for (let i = 0; i < assets.length; i += 1) {
        const item = assetToGalleryItem(assets[i], i);
        if (!item?.uri) continue;
        try {
          const poster = await ensurePoster(item.uri, 0);
          imported.push({
            ...item,
            posterUri: poster || null,
            filmUris: poster ? [poster] : [],
          });
        } catch (_) {
          imported.push(item);
        }
      }
      if (!imported.length) {
        Alert.alert('Galería', 'No se pudo leer el video seleccionado.');
        return;
      }
      setLibraryItems((prev) => {
        const next = asClipList(prev).slice();
        imported.forEach((item) => {
          if (!next.find((clip) => clip.id === item.id || clip.uri === item.uri)) next.push(item);
        });
        return next;
      });
      const nextSelected = asClipList(selectedClips).slice();
      imported.forEach((item) => {
        const clip = toTimelineClip(item);
        if (!nextSelected.find((current) => current.id === clip.id || current.uri === clip.uri)) {
          nextSelected.push(clip);
        }
      });
      setSelectedClips(nextSelected);
      setCurrentScreen('editor');
    } catch (error) {
      Alert.alert('Galería', error?.message || 'No se pudo abrir el selector de videos.');
    }
  };

  const toggleClip = (item) => {
    setSelectedClips((prev) => {
      const list = asClipList(prev);
      const exists = list.find((clip) => clip.id === item.id);
      if (exists) return list.filter((clip) => clip.id !== item.id);
      return [...list, toTimelineClip(item)];
    });
  };

  const addToEditor = () => {
    if (!clipSelection.length) {
      importFromDevice();
      return;
    }
    setCurrentScreen('editor');
  };

  if (currentScreen === 'gallery') {
    return (
      <GalleryScreen
        onBack={() => goTo('home')}
        selectedClips={clipSelection}
        libraryItems={libraryItems}
        onToggleClip={toggleClip}
        onImport={importFromDevice}
        onAdd={addToEditor}
      />
    );
  }

  if (currentScreen === 'editor') {
    return (
      <NativeEditorScreen
        key={clipSelection.map((clip) => clip.id).join('|') || 'empty'}
        onBack={() => goTo('home')}
        initialClips={clipSelection}
      />
    );
  }

  return (
    <HomeScreen
      onOpenGallery={() => goTo('gallery')}
      onOpenNative={() => goTo('editor')}
    />
  );
}

const styles = StyleSheet.create({
  home: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  brand: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 8,
  },
  sub: {
    color: CYAN,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 4,
    marginTop: 8,
    marginBottom: 28,
  },
  note: {
    color: '#999999',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 28,
  },
  btn: {
    minWidth: 200,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.38,
  },
  gallery: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: 48,
    paddingBottom: Platform.OS === 'android' ? 56 : 24,
  },
  galleryTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  tabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#121212',
  },
  tabBtn: {
    alignItems: 'center',
    paddingTop: 12,
    paddingHorizontal: 24,
    minWidth: 84,
  },
  tabText: {
    color: '#999999',
    fontSize: 15,
  },
  tabTextOn: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  tabLine: {
    marginTop: 10,
    height: 2,
    width: 44,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  tabLineOn: {
    backgroundColor: CYAN,
  },
  importBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    paddingVertical: 12,
    alignItems: 'center',
  },
  importText: {
    color: CYAN,
    fontSize: 14,
    fontWeight: '700',
  },
  emptyLibrary: {
    color: '#888888',
    fontSize: 13,
    padding: 16,
  },
  emptyHit: {
    width: '100%',
    paddingVertical: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    flex: 1,
  },
  tile: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 2,
  },
  tileInner: {
    flex: 1,
    borderRadius: 6,
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileOn: {
    borderWidth: 2,
    borderColor: CYAN,
  },
  tileTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  tileDuration: {
    color: '#999999',
    fontSize: 11,
    marginTop: 6,
  },
  galleryFooter: {
    alignItems: 'center',
    paddingBottom: 56,
    marginBottom: 8,
  },
  galleryStatus: {
    color: CYAN,
    fontSize: 13,
    marginBottom: 10,
  },
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  exportMask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  exportMaskText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  topBar: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  topLeftGroup: { flexDirection: 'row', alignItems: 'center' },
  topRightGroup: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { marginRight: 10, padding: 2 },
  iconMuted: { opacity: 0.35 },
  exportButton: { backgroundColor: '#23dddb', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  exportText: { color: '#000000', fontWeight: '700', fontSize: 12 },
  visorArea: { flex: 1, width: '100%', backgroundColor: '#141414' },
  videoBox: {
    flex: 1,
    width: '100%',
    backgroundColor: '#141414',
    overflow: 'hidden',
  },
  visorBottomControls: {
    height: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#000000',
    zIndex: 12,
    elevation: 12,
  },
  visorCenter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  visorRightIcons: { flexDirection: 'row', minWidth: 40, justifyContent: 'flex-end', alignItems: 'center' },
  visorCtrlHit: {
    minWidth: 40,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visorCtrlText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  visorCtrlHint: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 1,
  },
  timelineArea: { height: 152, backgroundColor: '#121212' },
  timelineSpacer: { height: 36, backgroundColor: '#121212' },
  toolbarArea: { backgroundColor: '#000000' },
  panelSlot: {
    minHeight: 0,
    maxHeight: 248,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  preview: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  previewMeta: {
    color: '#999999',
    fontSize: 13,
    marginTop: 8,
  },
  previewTime: {
    color: CYAN,
    fontSize: 18,
    marginTop: 16,
    fontVariant: ['tabular-nums'],
  },
  transport: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: '#000000',
  },
  transportCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transportSide: {
    width: 112,
  },
  step: {
    color: '#FFFFFF',
    fontSize: 28,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  play: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 12,
  },
  playHit: {
    minWidth: 44,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  playHitOn: {
    opacity: 0.55,
  },
  splitHit: {
    width: 112,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  split: {
    color: CYAN,
    fontSize: 14,
    fontWeight: '700',
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#000000',
  },
  toolChip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolChipOn: {
    backgroundColor: CYAN,
    borderColor: CYAN,
  },
  toolChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  toolChipTextOn: {
    color: '#000000',
  },
  speedPanel: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#000000',
    maxHeight: 248,
  },
  speedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  speedTitle: {
    color: '#8a8a8a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  speedValue: {
    color: CYAN,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  speedHint: {
    color: '#8a8a8a',
    fontSize: 12,
    marginBottom: 8,
  },
  keyNavRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  channelRow: {
    marginBottom: 8,
  },
  channelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  channelLabel: {
    color: '#8a8a8a',
    fontSize: 11,
    fontWeight: '700',
    flex: 1,
  },
  channelValue: {
    color: '#23dddb',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  keyStampHit: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#444444',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1c1c1c',
  },
  keyStampHitOn: {
    borderColor: '#23dddb',
  },
  speedPresets: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  speedPreset: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedPresetOn: {
    backgroundColor: CYAN,
    borderColor: CYAN,
  },
  speedPresetText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  speedPresetTextOn: {
    color: '#000000',
  },
  speedTrack: {
    height: 28,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#1c1c1c',
    overflow: 'visible',
  },
  speedFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: CYAN,
  },
  speedThumb: {
    position: 'absolute',
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: CYAN,
  },
  speedMarks: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  speedMark: {
    color: '#666666',
    fontSize: 10,
  },
  volumeMute: {
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  speedDone: {
    marginTop: 12,
    height: 42,
    borderRadius: 21,
    backgroundColor: CYAN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedDoneText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },
  previewHost: {
    flex: 1,
    alignSelf: 'stretch',
    width: '100%',
    minHeight: 0,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
});
