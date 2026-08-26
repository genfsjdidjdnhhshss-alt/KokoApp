import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { FRAME, SPEED_MIN, SPEED_MAX, snapToFrame, toFrameIndex, TimelineStripMemo, asClipList, shiftClipInTime, trimClipInTime, setClipSpeedInTime, stampClipTimes, clipAtCompositionTime, clipSpeed } from './TimelineEngine';
import { PreviewStage, previewNativeRate } from './PreviewStage';
import { loadImagePicker } from './mediaNative';

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
    uri: item.uri || null,
    originalUri: item.originalUri || item.uri || null,
    previewUri: item.previewUri || null,
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
    offset: 0,
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
      next.push({
        ...clip,
        duration: left,
        offset,
        sourceDuration,
        sourceSpan: leftSpan,
        speed,
        start,
        end: cut,
      });
      next.push({
        ...clip,
        id: `${clip.id}-s${cutFrame}`,
        duration: duration - left,
        offset: offset + leftSpan,
        sourceDuration,
        sourceSpan: Math.max(FRAME, parentSpan - leftSpan),
        speed,
        start: cut,
        end,
      });
      didSplit = true;
    } else {
      next.push(clip);
    }
  }
  return didSplit ? next : list;
}

function PlayButton({ playingSv }) {
  const pressed = useSharedValue(0);

  const tap = useMemo(() => Gesture.Tap()
    .maxDuration(10000)
    .onBegin(() => {
      pressed.value = 1;
    })
    .onEnd(() => {
      playingSv.value = !playingSv.value;
    })
    .onFinalize(() => {
      pressed.value = 0;
    }), [playingSv, pressed]);

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
        <Animated.Text style={[styles.play, playLabel]}>Play</Animated.Text>
        <Animated.Text style={[styles.play, pauseLabel]}>Pausa</Animated.Text>
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
  const [clips, setClips] = useState(() => stampClipTimes(asClipList(initialClips)));
  const [time, setTime] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [speedOpen, setSpeedOpen] = useState(false);
  const speedPreviewIdSv = useSharedValue('');
  const speedPreviewSpeedSv = useSharedValue(1);
  const playingSv = useSharedValue(false);
  const timeSv = useSharedValue(0);
  const controlRef = useRef(null);
  const previewSeekRef = useRef(null);
  const clockBucketRef = useRef(-1);
  const splitQueuedRef = useRef(false);
  const playingLiveRef = useRef(false);
  const clipsLiveRef = useRef(asClipList(clips));
  const clipList = useMemo(() => asClipList(clips), [clips]);
  clipsLiveRef.current = clipList;
  const selectedClip = useMemo(
    () => clipList.find((clip) => String(clip.id) === String(selectedId)) || null,
    [clipList, selectedId]
  );

  const onTimelineTime = useCallback((nextTime) => {
    if (playingSv.value) return;
    previewSeekRef.current?.applyTime?.(nextTime);
    const bucket = Math.round(Math.max(0, nextTime) * 10);
    if (bucket === clockBucketRef.current) return;
    clockBucketRef.current = bucket;
    setTime(nextTime);
  }, [playingSv]);

  const onPlayingChange = useCallback((next) => {
    playingLiveRef.current = !!next;
  }, []);

  const persistMoveRef = useRef((clipId, deltaTime) => {
    setClips((prev) => shiftClipInTime(prev, clipId, deltaTime));
  });
  const persistTrimRef = useRef((clipId, start, duration, offset) => {
    setClips((prev) => trimClipInTime(prev, clipId, start, duration, offset));
  });
  persistTrimRef.current = (clipId, start, duration, offset) => {
    setClips((prev) => trimClipInTime(prev, clipId, start, duration, offset));
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
          setSpeedOpen(true);
        }
      }
      clockBucketRef.current = Math.round(cut * 10);
      setTime(cut);
    };
    setTimeout(apply, 0);
  }, []);

  const onSelectClip = useCallback((clipId) => {
    setSelectedId(clipId);
    setSpeedOpen(true);
  }, []);

  const draftClipSpeed = useCallback((nextSpeed) => {
    if (!selectedId) return;
    const rounded = Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(nextSpeed * 100) / 100));
    speedPreviewIdSv.value = String(selectedId);
    speedPreviewSpeedSv.value = rounded;
  }, [selectedId, speedPreviewIdSv, speedPreviewSpeedSv]);

  const applyClipSpeed = useCallback((nextSpeed) => {
    if (!selectedId) return;
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
      setSpeedOpen(false);
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
    setSpeedOpen(false);
  }, [selectedClip, selectedId, speedPreviewIdSv, speedPreviewSpeedSv]);

  const runExport = useCallback(async () => {
    Alert.alert(
      'Exportar',
      'El preview queda a 1x. El export con velocidad (FFmpeg) pide un APK nuevo; no lo cargamos aquí para no romper este cliente.'
    );
  }, []);

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

  return (
    <View style={styles.editor}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={10}>
          <Text style={styles.topAction}>Cerrar</Text>
        </Pressable>
        <Text style={styles.clock}>{formatClock(time)}</Text>
        <Pressable onPress={runExport} hitSlop={10}>
          <Text style={styles.exportBtn}>Exportar</Text>
        </Pressable>
      </View>

      <View style={styles.previewHost}>
        <PreviewStage
          clips={clipList}
          clipsLiveRef={clipsLiveRef}
          playingSv={playingSv}
          timeSv={timeSv}
          clockLabel={formatClock(time)}
          speedLabel={
            selectedClip
              ? (Math.abs(clipSpeed(selectedClip) - previewNativeRate(clipSpeed(selectedClip))) > 0.04
                ? `${previewNativeRate(clipSpeed(selectedClip))}x · pista ${formatSpeedLabel(clipSpeed(selectedClip))}`
                : Math.abs(clipSpeed(selectedClip) - 1) > 0.02
                  ? formatSpeedLabel(clipSpeed(selectedClip))
                  : null)
              : null
          }
          seekRef={previewSeekRef}
        />
      </View>

      <View style={styles.transport}>
        <View style={styles.transportSide} />
        <View style={styles.transportCenter}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              controlRef.current?.pauseNow?.();
              controlRef.current?.nudge?.(-FRAME);
            }}
          >
            <Text style={styles.step}>‹</Text>
          </Pressable>
          <PlayButton playingSv={playingSv} />
          <Pressable
            hitSlop={8}
            onPress={() => {
              controlRef.current?.pauseNow?.();
              controlRef.current?.nudge?.(FRAME);
            }}
          >
            <Text style={styles.step}>›</Text>
          </Pressable>
        </View>
        <SplitButton onQueue={queueSplit} />
      </View>

      {selectedClip ? (
        <View style={styles.toolRow}>
          <Pressable
            style={[styles.toolChip, speedOpen && styles.toolChipOn]}
            onPress={() => {
              setSpeedOpen((open) => {
                if (open) speedPreviewIdSv.value = '';
                return !open;
              });
            }}
          >
            <Text style={[styles.toolChipText, speedOpen && styles.toolChipTextOn]}>Velocidad</Text>
          </Pressable>
        </View>
      ) : null}

      {selectedClip && speedOpen ? (
        <SpeedPanel
          clip={selectedClip}
          speedPreviewIdSv={speedPreviewIdSv}
          speedPreviewSpeedSv={speedPreviewSpeedSv}
          onDraft={draftClipSpeed}
          onApply={applyClipSpeed}
        />
      ) : null}

      <TimelineStripMemo
        clips={clipList}
        selectedId={selectedId}
        onSelectClip={onSelectClip}
        onTimeChange={onTimelineTime}
        onPlayingChange={onPlayingChange}
        persistMoveRef={persistMoveRef}
        persistTrimRef={persistTrimRef}
        controlRef={controlRef}
        speedPreviewIdSv={speedPreviewIdSv}
        speedPreviewSpeedSv={speedPreviewSpeedSv}
        playingSv={playingSv}
        timeSv={timeSv}
      />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppNavigation />
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
        mediaTypes: ['videos'],
        allowsMultipleSelection: true,
        quality: 1,
      };
      let result = null;
      try {
        result = await picker.launchImageLibraryAsync(options);
      } catch (_) {
        result = await picker.launchImageLibraryAsync({
          mediaTypes: picker.MediaTypeOptions?.Videos || ['videos'],
          quality: 1,
        });
      }
      if (!result || result.canceled || result.cancelled) return;
      const assets = Array.isArray(result.assets) ? result.assets : (result.uri ? [result] : []);
      const imported = assets.map(assetToGalleryItem).filter(Boolean);
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
  editor: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: 48,
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
    height: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topAction: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  clock: {
    color: '#FFFFFF',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  exportBtn: {
    color: '#000000',
    backgroundColor: CYAN,
    overflow: 'hidden',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
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
    minWidth: 88,
    minHeight: 44,
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
    alignItems: 'center',
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
    backgroundColor: '#000000',
  },
});
