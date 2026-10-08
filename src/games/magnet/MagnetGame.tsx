import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { GameShell } from '@/components/games/GameShell';
import { colors } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { submitKozmoScore } from '@/services/social';

const { width: W, height: H } = Dimensions.get('window');

type Orb = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bad: boolean;
};

export function MagnetGame() {
  const { profile } = useAuth();
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const mx = useSharedValue(W / 2);
  const my = useSharedValue(H * 0.55);
  const idRef = useRef(0);
  const loop = useRef<ReturnType<typeof setInterval> | null>(null);
  const magnetR = 28;

  const magnetStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: mx.value - magnetR }, { translateY: my.value - magnetR }],
  }));

  const clear = () => {
    if (loop.current) clearInterval(loop.current);
    loop.current = null;
  };

  const end = useCallback(
    async (finalScore: number) => {
      clear();
      setRunning(false);
      setGameOver(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (profile?.id) await submitKozmoScore(profile.id, 'magnet', finalScore);
    },
    [profile?.id],
  );

  const start = useCallback(() => {
    clear();
    setScore(0);
    setOrbs([]);
    setGameOver(false);
    setRunning(true);
    mx.value = W / 2;
    my.value = H * 0.55;

    loop.current = setInterval(() => {
      const magnet = { x: mx.value, y: my.value };
      setOrbs((prev) => {
        let next = prev.map((o) => {
          const dx = magnet.x - o.x;
          const dy = magnet.y - o.y;
          const dist = Math.max(24, Math.hypot(dx, dy));
          const pull = o.bad ? -0.35 : 1.1;
          const ax = (dx / dist) * pull;
          const ay = (dy / dist) * pull;
          return {
            ...o,
            vx: (o.vx + ax) * 0.96,
            vy: (o.vy + ay) * 0.96,
            x: o.x + o.vx,
            y: o.y + o.vy,
          };
        });

        const collected: Orb[] = [];
        next = next.filter((o) => {
          const d = Math.hypot(o.x - magnet.x, o.y - magnet.y);
          if (d < magnetR + 10) {
            collected.push(o);
            return false;
          }
          return o.x > -40 && o.x < W + 40 && o.y > -40 && o.y < H + 40;
        });

        if (collected.some((o) => o.bad)) {
          setScore((s) => {
            end(s);
            return s;
          });
        } else if (collected.length) {
          setScore((s) => s + collected.length * 5);
          Haptics.selectionAsync();
        }

        if (Math.random() < 0.12 && next.length < 14) {
          idRef.current += 1;
          const edge = Math.floor(Math.random() * 4);
          let x = 0;
          let y = 0;
          if (edge === 0) {
            x = Math.random() * W;
            y = -20;
          } else if (edge === 1) {
            x = W + 20;
            y = Math.random() * H;
          } else if (edge === 2) {
            x = Math.random() * W;
            y = H + 20;
          } else {
            x = -20;
            y = Math.random() * H;
          }
          next.push({
            id: idRef.current,
            x,
            y,
            vx: 0,
            vy: 0,
            bad: Math.random() < 0.28,
          });
        }
        return next;
      });
    }, 24);
  }, [end, mx, my]);

  useEffect(() => () => clear(), []);

  const drag = Gesture.Pan().onChange((e) => {
    mx.value = Math.min(W - 20, Math.max(20, mx.value + e.changeX));
    my.value = Math.min(H - 80, Math.max(80, my.value + e.changeY));
  });

  return (
    <GameShell
      title="Kozmo Magnet"
      accent={colors.info}
      score={score}
      running={running}
      gameOver={gameOver}
      onRestart={start}
    >
      <GestureDetector gesture={drag}>
        <View style={styles.field}>
          {orbs.map((o) => (
            <View
              key={o.id}
              style={[
                styles.orb,
                {
                  left: o.x - 10,
                  top: o.y - 10,
                  backgroundColor: o.bad ? colors.danger : colors.info,
                },
              ]}
            />
          ))}
          <Animated.View style={[styles.magnet, magnetStyle]} />
        </View>
      </GestureDetector>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, backgroundColor: '#0A121A' },
  magnet: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.info,
    borderWidth: 3,
    borderColor: colors.white,
    opacity: 0.95,
  },
  orb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
  },
});
