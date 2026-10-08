# Koko (core)

Base mínima: **Expo SDK 52** + **Expo Router** + feed vertical (`expo-av`) + cliente **Supabase**.

## Setup

```bash
cp .env.example .env
# EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start
```

Ejecuta `supabase/schema.sql` en tu proyecto Supabase e inserta filas en `videos` para ver el feed.

## Core

- `app/` — Expo Router (`_layout` + `index` feed)
- `src/lib/supabase.ts` — conexión Supabase
- `src/components/VideoFeed.tsx` — lista vertical con reproducción
- `supabase/schema.sql` — `profiles` + `videos`

Documentación detallada: Agent Store → `docs/koko-core-base.md`.
