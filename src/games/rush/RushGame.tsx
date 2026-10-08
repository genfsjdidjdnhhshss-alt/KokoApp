import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { GameShell } from '@/components/games/GameShell';
import { colors } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { submitKozmoScore } from '@/services/social';

const { width: W, height: H } = Dimensions.get('window');
const LANES = [W * 0.22, W * 0.5, W * 0.78];
const PLAYER_Y = H * 0.72;

type Obstacle = { id: number; lane: number; y: number };

export function RushGame() {
  const { profile } = useAuth();
  const [lane, setLane] = useState(1);
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const spawn = useRef<ReturnType<typeof setInterval> | null>(null);
  const idRef = useRef(0);
  const laneX = useSharedValue(LANES[1]);
  const speedRef = useRef(7);

  const playerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: laneX.value - 22 }],
  }));

  const clearTimers = () => {
    if (tick.current) clearInterval(tick.current);
    if (spawn.current) clearInterval(spawn.current);
    tick.current = null;
    spawn.current = null;
  };

  const stop = useCallback(
    async (finalScore: number) => {
      clearTimers();
      setRunning(false);
      setGameOver(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (profile?.id) {
        await submitKozmoScore(profile.id, 'rush', finalScore);
      }
    },
    [profile?.id],
  );

  const start = useCallback(() => {
    clearTimers();
    setScore(0);
    setObstacles([]);
    setLane(1);
    laneX.value = withTiming(LANES[1], { duration: 120 });
    speedRef.current = 7;
    setGameOver(false);
    setRunning(true);

    spawn.current = setInterval(() => {
      idRef.current += 1;
      const laneIdx = Math.floor(Math.random() * 3);
      setObstacles((prev) => [
        ...prev.slice(-8),
        { id: idRef.current, lane: laneIdx, y: -40 },
      ]);
    }, 700);

    tick.current = setInterval(() => {
      setScore((s) => {
        const next = s + 1;
        speedRef.current = 7 + Math.floor(next / 40);
        return next;
      });
      setObstacles((prev) => {
        const moved = prev
          .map((o) => ({ ...o, y: o.y + speedRef.current }))
          .filter((o) => o.y < H + 40);
        return moved;
      });
    }, 16);
  }, [laneX]);

  useEffect(() => {
    if (!running) return;
    const hit = obstacles.some(
      (o) => o.lane === lane && o.y > PLAYER_Y - 36 && o.y < PLAYER_Y + 36,
    );
    if (hit) stop(score);
  }, [obstacles, lane, running, score, stop]);

  useEffect(() => () => clearTimers(), []);

  const moveLane = (delta: -1 | 1) => {
    if (!running) return;
    setLane((l) => {
      const next = Math.max(0, Math.min(2, l + delta));
      laneX.value = withTiming(LANES[next], { duration: 100 });
      return next;
    });
  };

  const swipe = Gesture.Pan().onEnd((e) => {
    if (e.translationX < -30) {
      runOnJS(moveLane)(-1);
    } else if (e.translationX > 30) {
      runOnJS(moveLane)(1);
    }
  });

  return (
    <GameShell
      title="Kozmo Rush"
      accent={colors.accent}
      score={score}
      running={running}
      gameOver={gameOver}
      onRestart={start}
    >
      <GestureDetector gesture={swipe}>
        <View style={styles.track}>
          {LANES.map((x, i) => (
            <View key={i} style={[styles.laneLine, { left: x - 1 }]} />
          ))}
          {obstacles.map((o) => (
            <View
              key={o.id}
              style={[
                styles.obstacle,
                { left: LANES[o.lane] - 20, top: o.y },
              ]}
            />
          ))}
          <Animated.View style={[styles.player, { top: PLAYER_Y }, playerStyle]} />
        </View>
      </GestureDetector>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  track: {
    flex: 1,
    backgroundColor: '#0E1218',
    overflow: 'hidden',
  },
  laneLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: 'rgba(46,230,166,0.12)',
  },
  player: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
  },
  obstacle: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.danger,
  },
});
