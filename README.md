# Koko + KOZMO

Aplicación móvil de streaming vertical y red social (**Koko**) con hub de minijuegos (**KOZMO**), construida con **Expo SDK 52**, **React Native**, **TypeScript**, **Expo Router** y **Supabase**.

Creada para **Paul Rojas Ugarte**.

## Requisitos

- Node.js 20+
- npm 10+
- Cuenta Supabase (opcional para modo demo)
- Expo Go o emulador iOS/Android

## Arranque rápido

```bash
cd /ruta/al/proyecto
cp .env.example .env
# Edita .env con EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start
```

Sin variables reales de Supabase, la app entra en **modo demo** (feed local, auth stub, scores locales).

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm start` | Metro / Expo Dev Tools |
| `npm run android` | Abrir en Android |
| `npm run ios` | Abrir en iOS |
| `npm run web` | Vista web |
| `npm run typecheck` | TypeScript sin emitir |

## Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ejecuta `supabase/schema.sql` en el SQL Editor.
3. Copia URL y anon key a `.env`.
4. (Opcional) Crea un bucket Storage `videos` para uploads reales.

## Estructura

```
app/                 Rutas Expo Router (auth, tabs, juegos)
src/components/      UI, feed, game shell
src/games/           Lógica de los 5 minijuegos KOZMO
src/lib/             Cliente Supabase + datos demo
src/services/        Feed, likes, comments, follows, scores
src/theme/           Tokens de diseño
supabase/schema.sql  Esquema SQL
```

## KOZMO — 5 juegos

1. **Kozmo Rush** — endless runner (swipe de carril)
2. **Kozmo Colosseum** — combate en arena (toca enemigos)
3. **Kozmo Magnet** — atracción física de orbes
4. **Kozmo Tower** — apilar bloques
5. **Kozmo Bomba** — desactivar cables o lanzar la bomba

## Documentación del proyecto

Si trabajas desde el Agent Store de Cursor:

- Arquitectura: `docs/koko-architecture.md`
- Índice de archivos: `docs/koko-file-index.md`

## Licencia

Uso privado / proyecto personal de Paul Rojas Ugarte.
