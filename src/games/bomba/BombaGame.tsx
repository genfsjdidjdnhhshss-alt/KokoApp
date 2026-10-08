import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { GameShell } from '@/components/games/GameShell';
import { colors, fonts, radii, spacing } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { submitKozmoScore } from '@/services/social';

const WIRES = ['#2EE6A6', '#4DB7FF', '#FF5C6A', '#FFB020'] as const;

type Mode = 'defuse' | 'throw';

export function BombaGame() {
  const { profile } = useAuth();
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [mode, setMode] = useState<Mode>('defuse');
  const [timer, setTimer] = useState(5);
  const [sequence, setSequence] = useState<number[]>([]);
  const [progress, setProgress] = useState(0);
  const [fuse, setFuse] = useState(1);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  };

  const end = useCallback(
    async (finalScore: number) => {
      clear();
      setRunning(false);
      setGameOver(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (profile?.id) await submitKozmoScore(profile.id, 'bomba', finalScore);
    },
    [profile?.id],
  );

  const nextRound = useCallback(
    (currentScore: number) => {
      const nextMode: Mode = Math.random() > 0.45 ? 'defuse' : 'throw';
      setMode(nextMode);
      setTimer(Math.max(2.4, 5 - currentScore / 40));
      setFuse(1);
      setProgress(0);
      const len = 3 + Math.floor(currentScore / 30);
      const seq = Array.from({ length: len }, () => Math.floor(Math.random() * WIRES.length));
      setSequence(seq);
    },
    [],
  );

  const start = useCallback(() => {
    clear();
    setScore(0);
    setGameOver(false);
    setRunning(true);
    nextRound(0);

    tick.current = setInterval(() => {
      setTimer((t) => {
        const nt = t - 0.05;
        setFuse(Math.max(0, nt / 5));
        if (nt <= 0) {
          setScore((s) => {
            end(s);
            return s;
          });
          return 0;
        }
        return nt;
      });
    }, 50);
  }, [end, nextRound]);

  useEffect(() => () => clear(), []);

  const cutWire = (idx: number) => {
    if (!running || mode !== 'defuse') return;
    const expected = sequence[progress];
    if (idx !== expected) {
      end(score);
      return;
    }
    Haptics.selectionAsync();
    const next = progress + 1;
    if (next >= sequence.length) {
      setScore((s) => {
        const ns = s + 15;
        nextRound(ns);
        return ns;
      });
    } else {
      setProgress(next);
    }
  };

  const resolveThrow = useCallback(
    (power: number) => {
      if (!running || mode !== 'throw') return;
      if (power > 900) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setScore((s) => {
          const ns = s + 20;
          nextRound(ns);
          return ns;
        });
      } else {
        end(score);
      }
    },
    [end, mode, nextRound, running, score],
  );

  const throwGesture = useMemo(
    () =>
      Gesture.Pan().onEnd((e) => {
        const power = Math.hypot(e.velocityX, e.velocityY);
        runOnJS(resolveThrow)(power);
      }),
    [resolveThrow],
  );

  return (
    <GameShell
      title="Kozmo Bomba"
      accent={colors.kozmo}
      score={score}
      running={running}
      gameOver={gameOver}
      onRestart={start}
    >
      <View style={styles.field}>
        <View style={styles.bomb}>
          <Text style={styles.timer}>{timer.toFixed(1)}s</Text>
          <View style={styles.fuseTrack}>
            <View style={[styles.fuseFill, { width: `${fuse * 100}%` }]} />
          </View>
          <Text style={styles.mode}>
            {mode === 'defuse' ? 'Corta los cables en orden' : 'Swipe fuerte para lanzar'}
          </Text>
        </View>

        {mode === 'defuse' ? (
          <View style={styles.seq}>
            <Text style={styles.hint}>
              Orden: {sequence.map((i) => '●').join(' ')} ({progress}/{sequence.length})
            </Text>
            <View style={styles.wires}>
              {WIRES.map((color, idx) => (
                <Pressable
                  key={color}
                  onPress={() => cutWire(idx)}
                  style={[styles.wire, { backgroundColor: color }]}
                />
              ))}
            </View>
            <View style={styles.preview}>
              {sequence.map((i, n) => (
                <View
                  key={`${i}-${n}`}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: WIRES[i],
                      opacity: n < progress ? 0.25 : 1,
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        ) : (
          <GestureDetector gesture={throwGesture}>
            <View style={styles.throwZone}>
              <View style={styles.throwOrb} />
              <Text style={styles.hint}>Desliza rápido hacia arriba / afuera</Text>
            </View>
          </GestureDetector>
        )}
      </View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  field: {
    flex: 1,
    backgroundColor: '#140E0A',
    padding: spacing.xl,
    gap: spacing.xl,
  },
  bomb: {
    alignItems: 'center',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  timer: {
    fontFamily: fonts.display,
    fontSize: 42,
    color: colors.kozmo,
  },
  fuseTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fuseFill: {
    height: '100%',
    backgroundColor: colors.danger,
  },
  mode: {
    fontFamily: fonts.bodyMedium,
    color: colors.textMuted,
    fontSize: 14,
  },
  seq: { gap: 16 },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  wires: { gap: 12 },
  wire: {
    height: 28,
    borderRadius: radii.pill,
  },
  preview: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  throwZone: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  throwOrb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.kozmo,
    borderWidth: 3,
    borderColor: colors.white,
  },
});
