# Fork de Recordly (ICS Marketing Solutions)

Este repo es un fork de [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly)
con funciones propias. La rama de trabajo es **`ics-main`**: el `main` del upstream más
nuestros cambios encima. `rapid-captions` y `camera-fx` son las ramas históricas
(base v1.4.0) que ya quedaron fusionadas en `ics-main`.

## Qué añade el fork

- Subtítulos rápidos con tiempos por palabra (`RAPID-CAPTIONS.md`).
- Efectos de cámara con IA para la capa de webcam (`CAMERA-FX.md`).

## Cómo se construye (Windows)

El `postinstall` del upstream compila helpers nativos y exige CMake. Los binarios ya
vienen compilados en `electron/native/bin/win32-x64`, así que:

```bash
npm install --ignore-scripts
npm run prepare:camera-fx
npx tsc --noEmit && npx biome lint .
npx vite build --config vite.config.ts
npm run normalize:electron-main-cjs && npm run smoke:electron-main-cjs
```

Definición de terminado: `tsc` y `biome lint` en cero avisos y la app probada corriendo.

## Empaquetar sin instalador

`scripts/package-rapid.mjs <Carpeta>` (script local, no se commitea) copia la instalación
de `%LOCALAPPDATA%\Programs\Recordly`, reemplaza `dist/`, `dist-electron/`, los helpers
nativos de `electron/native/bin` y los wallpapers, y vuelve a armar `app.asar`. Se niega a
sobrescribir una carpeta existente. Las carpetas viven junto a `source/`
(`Recordly-Upstream`, `Recordly-Efectos`, …).

## Probar una exportación sin abrir la app a mano

La app tiene un modo *smoke* que abre el editor, exporta y cierra:

```bash
RECORDLY_SMOKE_EXPORT=1 \
RECORDLY_SMOKE_EXPORT_INPUT=<video.mp4> \
RECORDLY_SMOKE_EXPORT_OUTPUT=<salida.mp4> \
RECORDLY_SMOKE_EXPORT_QUALITY=source RECORDLY_SMOKE_EXPORT_FPS=60 \
./Recordly-Upstream/Recordly.exe --user-data-dir=<carpeta aparte>
```

Deja `<salida>.mp4.report.json` con métricas por fase (render, espera del encoder, etc.).
`--user-data-dir` evita el candado de instancia única y no toca los ajustes de la app
instalada, así se puede probar mientras otra Recordly está exportando.

Variables útiles: `_WEBCAM_INPUT`, `_BACKEND` (`auto|breeze|webcodecs`),
`_ENCODING_MODE` (`fast|balanced|quality`), `_PIPELINE`, `_RENDER_BACKEND`.

## Sincronizar con el upstream

```bash
git fetch origin main:refs/remotes/origin/main
git merge origin/main   # en ics-main
```

Conflictos típicos: `package.json`/`package-lock.json` (volver a `npm install
--ignore-scripts`), `projectPersistence.ts`, `SettingsPanel.tsx`, `editorPreferences.ts`.
