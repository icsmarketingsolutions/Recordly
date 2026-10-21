# Fork de Recordly (ICS Marketing Solutions)

Este repo es un fork de [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly)
con funciones propias. La rama de trabajo es **`ics-main`**: el `main` del upstream más
nuestros cambios encima. `rapid-captions` y `camera-fx` son las ramas históricas
(base v1.4.0) que ya quedaron fusionadas en `ics-main`.

## Qué añade el fork

- Subtítulos rápidos con tiempos por palabra (`RAPID-CAPTIONS.md`).
- Efectos de cámara con IA para la capa de webcam (`CAMERA-FX.md`).
- HUD: botón **Volver a grabar** (↺) junto a Cancelar (✕); los dos piden un segundo
  toque. Cancelar borra también los `.wav`, sus `.json` y los diagnósticos.
- **Varios editores a la vez**: relanzar Recordly (o clic en la bandeja) con un editor
  abierto muestra la HUD; cada grabación terminada abre su propio editor y los demás
  siguen abiertos. El estado por ventana vive en `EditorContext` (`electron/ipc/state.ts`).
- La barra de la HUD se puede arrastrar a **cualquier monitor** (la ventana transparente
  cubre la unión de todas las pantallas).
- Timeline con **alto ajustable** (barra de arrastre, doble clic restablece) y pistas a
  1×/1.5×/2× (botones −/+); se recuerda por máquina en `localStorage`.
- Exportación: WebGPU por defecto en Windows/macOS (82 vs 47 fps medidos) y aviso cuando
  la GPU quedó en modo software (`gpuHealth.ts`): en ese caso reiniciar Recordly.
- **Sin cuenta obligatoria**: grabar y guardar nunca piden iniciar sesión; el onboarding
  del upstream solo se abre a pedido y siempre se puede cerrar.

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

## Pruebas de extremo a extremo (CDP)

Lanzar el paquete con `--remote-debugging-port=9333 --user-data-dir=<carpeta aparte>` y
manejar la HUD por el protocolo de DevTools (la API del preload queda en `window.electronAPI`).
Los guiones usados el 21-oct-2026 (`e2e-retake.mjs`, `e2e-multiwindow.mjs`) seleccionan
la pantalla, graban, rehacen/cancelan y comprueban los archivos y las ventanas. Para
probar siempre hay que cerrar solo los procesos cuyo `CommandLine` contenga esa carpeta
de datos, nunca la Recordly del usuario.

## Sincronizar con el upstream

```bash
git fetch origin main:refs/remotes/origin/main
git merge origin/main   # en ics-main
```

Conflictos típicos: `package.json`/`package-lock.json` (volver a `npm install
--ignore-scripts`), `projectPersistence.ts`, `SettingsPanel.tsx`, `editorPreferences.ts`.
