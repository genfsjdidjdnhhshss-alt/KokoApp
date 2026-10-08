---
cursor:
  subagentId: "bc-34d92227-e211-58a7-afa4-f0e41e316cef"
---

# Koko — Índice de archivos (core only)

El repo solo contiene la **base estrictamente necesaria**.  
Todo lo opcional (KOZMO, auth UI, upload, demo) fue **eliminado**.

Detalle: [`koko-core-base.md`](./koko-core-base.md).

## Core (requerido)

| Path | Rol | Clasificación |
|------|-----|---------------|
| `/workspace/package.json` | Deps Expo 52 + entry Expo Router | core |
| `/workspace/package-lock.json` | Lock de versiones exactas | core |
| `/workspace/app.json` | Config Expo; plugins `expo-router`, `expo-av` | core |
| `/workspace/babel.config.js` | `babel-preset-expo` + `reanimated/plugin` | core |
| `/workspace/metro.config.js` | Metro Expo default | core |
| `/workspace/tsconfig.json` | TypeScript strict + alias `@/*` | core |
| `/workspace/.env.example` | `EXPO_PUBLIC_SUPABASE_*` | core |
| `/workspace/.gitignore` | Ignora secretos / build | core |
| `/workspace/README.md` | Setup mínimo | core |
| `/workspace/app/_layout.tsx` | Root Stack + GestureHandler | core |
| `/workspace/app/index.tsx` | Pantalla única → VideoFeed | core |
| `/workspace/src/components/VideoFeed.tsx` | Feed vertical + expo-av + Supabase | core |
| `/workspace/src/lib/supabase.ts` | Cliente Supabase (AsyncStorage) | core |
| `/workspace/src/types/database.ts` | Tipos Profile / Video | core |
| `/workspace/supabase/schema.sql` | Tablas profiles + videos + RLS | core |
| `/workspace/assets/icon.png` | Icono app | core |
| `/workspace/assets/adaptive-icon.png` | Adaptive icon Android | core |
| `/workspace/assets/splash-icon.png` | Splash | core |
| `/workspace/assets/favicon.png` | Favicon web | core |
| `/workspace/docs/koko-core-base.md` | Doc base mínima | core (docs) |
| `/workspace/docs/koko-file-index.md` | Este índice | core (docs) |

## Optional

_Ninguno en el repo._ Removidos: `app/kozmo/**`, `app/(auth)/**`, `app/(tabs)/**`, `src/games/**`, demo data, UI social inventada.
