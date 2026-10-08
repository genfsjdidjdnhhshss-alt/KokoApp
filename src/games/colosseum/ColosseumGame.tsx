import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { GameShell } from '@/components/games/GameShell';
import { colors } from '@/theme/tokens';
import { useAuth } from '@/context/AuthContext';
import { submitKozmoScore } from '@/services/social';

const { width: W, height: H } = Dimensions.get('window');
const ARENA_R = Math.min(W, H) * 0.34;
const LOCAL_C = ARENA_R + 20;

type Enemy = {
  id: number;
  angle: number;
  dist: number;
  hp: number;
};

export function ColosseumGame() {
  const { profile } = useAuth();
  const [score, setScore] = useState(0);
  const [hp, setHp] = useState(3);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [enemies, setEnemies] = useState<Enemy[]>([]);
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (profile?.id) await submitKozmoScore(profile.id, 'colosseum', finalScore);
    },
    [profile?.id],
  );

  const start = useCallback(() => {
    clear();
    setScore(0);
    setHp(3);
    setEnemies([]);
    setGameOver(false);
    setRunning(true);

    loop.current = setInterval(() => {
      setEnemies((prev) => {
        let next = prev.map((e) => ({ ...e, dist: e.dist - 1.6 }));
        const hits = next.filter((e) => e.dist <= 28).length;
        if (hits > 0) {
          next = next.filter((e) => e.dist > 28);
          setHp((h) => {
            const nh = h - hits;
            if (nh <= 0) {
              setScore((s) => {
                end(s);
                return s;
              });
            }
            return Math.max(0, nh);
          });
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
        if (Math.random() < 0.08 && next.length < 10) {
          idRef.current += 1;
          next.push({
            id: idRef.current,
            angle: Math.random() * Math.PI * 2,
            dist: ARENA_R + 20,
            hp: 1,
          });
        }
        return next;
      });
    }, 32);
  }, [end]);

  useEffect(() => () => clear(), []);

  const strike = (id: number) => {
    if (!running) return;
    setEnemies((prev) => prev.filter((e) => e.id !== id));
    setScore((s) => s + 10);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <GameShell
      title="Kozmo Colosseum"
      accent={colors.danger}
      score={score}
      running={running}
      gameOver={gameOver}
      onRestart={start}
      hudExtra={
        running ? (
          <View style={styles.hearts}>
            {Array.from({ length: 3 }).map((_, i) => (
              <View
                key={i}
                style={[styles.heart, { opacity: i < hp ? 1 : 0.2 }]}
              />
            ))}
          </View>
        ) : null
      }
    >
      <View style={styles.arenaWrap}>
        <View style={styles.arena}>
          <View style={styles.player} />
          {enemies.map((e) => {
            const x = LOCAL_C + Math.cos(e.angle) * e.dist - 16;
            const y = LOCAL_C + Math.sin(e.angle) * e.dist - 16;
            return (
              <Pressable
                key={e.id}
                onPress={() => strike(e.id)}
                style={[styles.enemy, { left: x, top: y }]}
              />
            );
          })}
        </View>
      </View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  hearts: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 4,
  },
  heart: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.danger,
  },
  arenaWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  arena: {
    width: ARENA_R * 2 + 40,
    height: ARENA_R * 2 + 40,
    borderRadius: ARENA_R + 20,
    borderWidth: 2,
    borderColor: 'rgba(255,92,106,0.35)',
    backgroundColor: '#140E12',
  },
  player: {
    position: 'absolute',
    left: ARENA_R + 20 - 18,
    top: ARENA_R + 20 - 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.warn,
    borderWidth: 2,
    borderColor: colors.white,
  },
  enemy: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.danger,
  },
});
