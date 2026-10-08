import type { KozmoGameId } from '@/types/database';

export type KozmoGameMeta = {
  id: KozmoGameId;
  title: string;
  tagline: string;
  accent: string;
  route: `/kozmo/${KozmoGameId}`;
  mechanic: string;
};

export const KOZMO_GAMES: KozmoGameMeta[] = [
  {
    id: 'rush',
    title: 'Kozmo Rush',
    tagline: 'Corre sin parar. Esquiva. Sobrevive.',
    accent: '#2EE6A6',
    route: '/kozmo/rush',
    mechanic: 'Endless runner — desliza izquierda/derecha',
  },
  {
    id: 'colosseum',
    title: 'Kozmo Colosseum',
    tagline: 'Arena 1vN. Golpea antes de que te rodeen.',
    accent: '#FF5C6A',
    route: '/kozmo/colosseum',
    mechanic: 'Combate en arena — toca enemigos',
  },
  {
    id: 'magnet',
    title: 'Kozmo Magnet',
    tagline: 'Atrae orbes. Evita el óxido.',
    accent: '#4DB7FF',
    route: '/kozmo/magnet',
    mechanic: 'Física magnética — arrastra el imán',
  },
  {
    id: 'tower',
    title: 'Kozmo Tower',
    tagline: 'Apila bloques. Sube más alto.',
    accent: '#FFB020',
    route: '/kozmo/tower',
    mechanic: 'Stack / tower climb — toca para soltar',
  },
  {
    id: 'bomba',
    title: 'Kozmo Bomba',
    tagline: 'Desactiva o lanza antes del boom.',
    accent: '#FF8A3D',
    route: '/kozmo/bomba',
    mechanic: 'Timed bomb — secuencia o swipe para lanzar',
  },
];
