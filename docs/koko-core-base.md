---
cursor:
  subagentId: "bc-34d92227-e211-58a7-afa4-f0e41e316cef"
---

# Koko — Base mínima (core)

Arquitectura estrictamente necesaria: **Expo SDK 52 + Expo Router + feed vertical + Supabase**.  
Sin KOZMO, sin auth UI, sin demo fluff, sin features inventadas.

Repo: `/workspace` · branch: `cursor/koko-kozmo-rebuild-6cef` · `tsc --noEmit` OK.

> Nota: este archivo también vive en el repo (`docs/`) porque el Agent Store del proyecto estaba inaccesible para escritura en el momento del trim. Destino pedido: `/cursor/stores/self/docs/koko-core-base.md`.

---

## 1. Dependencias (`package.json`)

Entry obligatorio de Expo Router:

```json
"main": "expo-router/entry"
```

### dependencies (rangos en package.json → versión resuelta en lock)

| Paquete | package.json | Resuelto (`package-lock`) | Por qué |
|---------|--------------|---------------------------|---------|
| `expo` | `~52.0.23` | `52.0.49` | SDK |
| `expo-router` | `~4.0.15` | `4.0.22` | Navegación file-based |
| `expo-av` | `~15.0.2` | `15.0.2` | Reproducción de video |
| `expo-constants` | `~17.0.4` | `17.0.8` | Peer Expo Router |
| `expo-linking` | `~7.0.4` | `7.0.5` | Peer Expo Router / deep links |
| `expo-splash-screen` | `~0.29.20` | `0.29.24` | Peer Expo Router |
| `expo-status-bar` | `~2.0.1` | `2.0.1` | Status bar |
| `react` | `18.3.1` | `18.3.1` | RN 0.76 |
| `react-dom` | `18.3.1` | `18.3.1` | Web |
| `react-native` | `0.76.5` | `0.76.5` | Runtime |
| `react-native-web` | `~0.19.13` | `0.19.13` | Web |
| `react-native-gesture-handler` | `~2.20.2` | `2.20.2` | Requerido por Expo Router |
| `react-native-reanimated` | `~3.16.1` | `3.16.7` | Requerido por Expo Router |
| `react-native-safe-area-context` | `4.12.0` | `4.12.0` | Requerido por Expo Router |
| `react-native-screens` | `~4.4.0` | `4.4.0` | Requerido por Expo Router |
| `@supabase/supabase-js` | `^2.47.10` | `2.117.3` | Cliente Supabase |
| `react-native-url-polyfill` | `^2.0.0` | `2.0.0` | URL en RN para Supabase |
| `@react-native-async-storage/async-storage` | `1.23.1` | `1.23.1` | Persistencia de sesión auth |

### devDependencies

| Paquete | package.json | Resuelto |
|---------|--------------|----------|
| `@babel/core` | `^7.25.2` | `7.29.7` |
| `@types/react` | `~18.3.12` | `18.3.31` |
| `typescript` | `~5.3.3` | `5.3.3` |

---

## 2. Config que debe quedar tal cual

### `app.json` — plugins

```json
"plugins": [
  "expo-router",
  "expo-av"
]
```

- `expo-router`: registra el entry y el scheme.
- `expo-av`: módulo nativo de audio/video compatible con Expo Go (SDK 52).  
  **No** se usa `expo-video` en este core; el package de reproducción es **`expo-av`**.

También: `"scheme": "koko"`, `"userInterfaceStyle": "dark"`, assets icon/splash.

### `babel.config.js` — plugin Reanimated **al final**

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
```

### `metro.config.js`

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
module.exports = config;
```

### Entry Expo Router

```json
"main": "expo-router/entry"
```

### `tsconfig.json`

```json
"paths": { "@/*": ["src/*"] }
```

### `.env.example`

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

---

## 3. Video nativo — notas

| Decisión | Valor |
|----------|--------|
| Package | **`expo-av` ~15.0.2** |
| API | `Video`, `ResizeMode` from `expo-av` |
| Plugin `app.json` | `"expo-av"` |
| Controles | `useNativeControls={false}` |
| Loop / play activo | `isLooping` + `shouldPlay={isActive}` |

`expo-video` existe en SDK 52+ como sucesor; **este core usa `expo-av`**.

---

## 4. Navegación (mínima)

1. `app/_layout.tsx` — `GestureHandlerRootView` + `Stack` sin header  
2. `app/index.tsx` — monta `VideoFeed`

---

## 5. Supabase (conexión limpia)

`src/lib/supabase.ts`:

- `react-native-url-polyfill/auto` antes del client
- `createClient` + `AsyncStorage` + `persistSession` + `detectSessionInUrl: false`
- Sin UI de login

Schema: `supabase/schema.sql` → `profiles` + `videos` + RLS lectura.

---

## 6. Archivos principales (core)

| Path | Rol |
|------|-----|
| `/workspace/package.json` | Deps + `"main": "expo-router/entry"` |
| `/workspace/package-lock.json` | Versiones exactas resueltas |
| `/workspace/app.json` | Config Expo + plugins |
| `/workspace/babel.config.js` | Preset Expo + Reanimated |
| `/workspace/metro.config.js` | Metro default Expo |
| `/workspace/tsconfig.json` | Strict TS + alias `@/*` |
| `/workspace/.env.example` | Placeholders Supabase |
| `/workspace/.gitignore` | Ignora `.env`, `node_modules`, `.expo` |
| `/workspace/README.md` | Setup mínimo en español |
| `/workspace/app/_layout.tsx` | Root layout Expo Router |
| `/workspace/app/index.tsx` | Pantalla feed |
| `/workspace/src/components/VideoFeed.tsx` | FlatList vertical + expo-av + query |
| `/workspace/src/lib/supabase.ts` | Cliente Supabase RN |
| `/workspace/src/types/database.ts` | Tipos `Profile` / `Video` |
| `/workspace/supabase/schema.sql` | SQL `profiles` + `videos` |
| `/workspace/assets/icon.png` | Icono |
| `/workspace/assets/adaptive-icon.png` | Adaptive Android |
| `/workspace/assets/splash-icon.png` | Splash |
| `/workspace/assets/favicon.png` | Favicon web |
| `/workspace/docs/koko-core-base.md` | Este documento |
| `/workspace/docs/koko-file-index.md` | Índice core |

---

## 7. Cómo correr

```bash
cp .env.example .env
npm install
# Ejecutar supabase/schema.sql e insertar videos
npx expo start
npm run typecheck
```

---

## 8. Eliminado del scaffold anterior

KOZMO/juegos, tabs upload/perfil, pantallas auth, demo data, fuentes Google, haptics, theme inventado, likes/comments/follows UI.
