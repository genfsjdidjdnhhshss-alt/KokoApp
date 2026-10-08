import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GameShell } from '@/components/games/GameShell';
import { colors } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { submitKozmoScore } from '@/services/social';

const { width: W, height: H } = Dimensions.get('window');
const BASE_Y = H * 0.78;
const BLOCK_H = 28;

type Block = { id: number; x: number; width: number; y: number };

export function TowerGame() {
  const { profile } = useAuth();
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [stack, setStack] = useState<Block[]>([]);
  const [moving, setMoving] = useState<Block | null>(null);
  const dir = useRef(1);
  const speed = useRef(3.2);
  const idRef = useRef(0);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = () => {
    if (loop.current) clearInterval(loop.current);
    loop.current = null;
  };

  const end = useCallback(
    async (finalScore: number) => {
      clear();
      setRunning(false);
      setGameOver(true);
      setMoving(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (profile?.id) await submitKozmoScore(profile.id, 'tower', finalScore);
    },
    [profile?.id],
  );

  const spawnMoving = useCallback((width: number, y: number) => {
    idRef.current += 1;
    setMoving({ id: idRef.current, x: 0, width, y });
    dir.current = 1;
  }, []);

  const start = useCallback(() => {
    clear();
    const base: Block = {
      id: 0,
      x: W * 0.25,
      width: W * 0.5,
      y: BASE_Y,
    };
    setStack([base]);
    setScore(0);
    setGameOver(false);
    setRunning(true);
    speed.current = 3.2;
    spawnMoving(base.width, BASE_Y - BLOCK_H - 4);

    loop.current = setInterval(() => {
      setMoving((m) => {
        if (!m) return m;
        let nx = m.x + dir.current * speed.current;
        if (nx <= 0) {
          nx = 0;
          dir.current = 1;
        } else if (nx + m.width >= W) {
          nx = W - m.width;
          dir.current = -1;
        }
        return { ...m, x: nx };
      });
    }, 16);
  }, [spawnMoving]);

  useEffect(() => () => clear(), []);

  const drop = () => {
    if (!running || !moving || !stack.length) return;
    const top = stack[stack.length - 1];
    const left = Math.max(moving.x, top.x);
    const right = Math.min(moving.x + moving.width, top.x + top.width);
    const overlap = right - left;
    if (overlap < 18) {
      end(score);
      return;
    }
    const placed: Block = {
      id: moving.id,
      x: left,
      width: overlap,
      y: moving.y,
    };
    const nextStack = [...stack, placed].slice(-12);
    // shift tower down visually if tall
    const shifted = nextStack.map((b, i, arr) => ({
      ...b,
      y: BASE_Y - (arr.length - 1 - i) * (BLOCK_H + 4),
    }));
    setStack(shifted);
    setScore((s) => s + Math.round(overlap / 4));
    speed.current = Math.min(7.5, speed.current + 0.18);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    spawnMoving(overlap, shifted[shifted.length - 1].y - BLOCK_H - 4);
  };

  return (
    <GameShell
      title="Kozmo Tower"
      accent={colors.warn}
      score={score}
      running={running}
      gameOver={gameOver}
      onRestart={start}
    >
      <Pressable style={styles.field} onPress={drop}>
        {stack.map((b, i) => (
          <View
            key={b.id}
            style={[
              styles.block,
              {
                left: b.x,
                top: b.y,
                width: b.width,
                backgroundColor: i % 2 ? colors.warn : '#E89A20',
              },
            ]}
          />
        ))}
        {moving && (
          <View
            style={[
              styles.block,
              styles.moving,
              { left: moving.x, top: moving.y, width: moving.width },
            ]}
          />
        )}
      </Pressable>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, backgroundColor: '#12100A' },
  block: {
    position: 'absolute',
    height: BLOCK_H,
    borderRadius: 6,
  },
  moving: {
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.white,
  },
});
