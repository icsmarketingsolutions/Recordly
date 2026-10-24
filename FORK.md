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
- La barra de la HUD se puede arrastrar a **cualquier monitor**: la ventana transparente
  cubre una sola pantalla y, al salir el puntero de ella durante el arrastre, el main la
  muda a la pantalla del cursor (`hud-overlay-follow-cursor`) y el arrastre se re-basa.
- Timeline con **alto ajustable** (barra de arrastre, doble clic restablece) y pistas a
  1×/1.5×/2× (botones −/+); se recuerda por máquina en `localStorage`.
- Exportación: WebGPU por defecto en Windows/macOS (82 vs 47 fps medidos) y aviso cuando
  la GPU quedó en modo software (`gpuHealth.ts`): en ese caso reiniciar Recordly.
- **Multi-clip**: el panel *Clips* (que el upstream trae para anexar grabaciones de la
  biblioteca) gana dos botones: **Record a take** (graba otra toma desde el editor y la
  anexa al final cuando la grabación termina, sin reemplazar el proyecto;
  `clipSources.ts` + evento `append-take-ready`) y **Add file** (cualquier mp4/mov/webm/
  mkv del disco, aprobado por diálogo). El anexado reusa el importador del upstream:
  reencoda (con NVENC/QSV/AMF/MF si están, libx264 si no; barra de progreso por fases)
  y concatena en `.recordly-media/<uuid>.mp4` (un solo archivo fuente, clips
  con `sourceMinMs/sourceMaxMs`); subtítulos del clip nuevo hay que regenerarlos.
  Desde el 22-oct **no reencoda** lo que ya es H.264 yuv420p a la resolución y fps de la
  secuencia (tolerancia de 1,5 fps porque las grabaciones son de tasa variable): base y
  clip se copian y solo se mezcla el audio. Verificado: decodificación bit a bit (SSIM
  0,99999) y export 1080p por WebGPU. No usar `dump_extra` en el concat: el SPS/PPS en
  banda duplicado hace que WebCodecs rechace la primera muestra.
- **Regrabar este clip** (panel del clip seleccionado): abre la HUD, la toma nueva entra
  en la posición del clip viejo y el viejo se descarta en el mismo ripple (deshacible).
- **Quitar pausas** (botón junto a Dividir clip): `silencedetect` sobre la pista mezclada
  de la grabación (`detect-recording-silences`), popover con pausa mínima, margen y
  umbral; `planSilenceRemoval` parte los clips en los cortes y empaqueta el resto, los
  efectos se re-proyectan pieza por pieza y todo es un solo paso de deshacer. Nunca vacía
  la timeline. E2E: 15 pausas en un video real (2 → 13 clips, deshacer vuelve a 2).
- **Subtítulos**: glosario por proyecto (`autoCaptionSettings.glossary`) que va a
  whisper-cli como `--prompt`; selector de modelo (small / medium / large-v3-turbo,
  descarga desde Hugging Face, elección recordada por máquina). El whisper-cli
  empaquetado es solo CPU: para acelerar hay que apuntar «Whisper executable» a una
  build CUDA/Vulkan de whisper.cpp.
- **Presets de exportación** en un clic (Publish → Local): Instagram Reel 9:16 (original,
  30 fps), YouTube 16:9 (original, 60 fps, calidad) y WhatsApp (archivo liviano).
- **Atajos globales mientras se graba** (aunque la HUD esté oculta o sin foco):
  Ctrl/Cmd+Shift+S detener, +P pausar/reanudar, +R volver a grabar, +X cancelar.
  Se registran solo durante la grabación. La HUD reabre en el monitor al que se la
  arrastró por última vez (`hudOverlayDisplayId` en `app-settings.json`).
- **La cámara ya no se pierde en el editor**: al terminar de grabar el editor abre sin
  cámara y la recibe después (aviso `recording-session-changed`). Si ese aviso llegaba
  mientras el editor aún cargaba el video, o con la ruta escrita distinto (mayúsculas o
  barras en Windows), se descartaba; y si se guardaba así, el proyecto quedaba sin cámara
  para siempre porque al reabrir ganaba la cámara vacía del proyecto. Ahora el último
  aviso se guarda y se aplica cuando el video coincide (`useInitialEditorSource`), y al
  abrir un proyecto sin cámara se recupera la que enlaza el manifiesto de la grabación
  (`manifestWebcamPath` de `set-current-video-path`; una cámara quitada a mano borra
  el manifiesto y no vuelve).
- **La cámara graba en 1080p30** (antes salía 640×360): Chromium abre una sola sesión por
  cámara y el primero que la abre fija el modo. La vista previa del HUD pedía 320×320 y
  abría antes que la grabación, así que la grabación recibía 640×360 aunque pidiera 720p.
  Ahora la vista previa y la grabación piden lo mismo (`src/lib/webcamCapture.ts`:
  1920×1080 a 30 fps, 12 Mbps) y la vista previa solo lo muestra chico. Probado con
  `scripts/e2e/e2e-webcam-quality.mjs` (graba 8 s y mide el archivo de la cámara).
- **Sin cuenta obligatoria**: grabar y guardar nunca piden iniciar sesión; el onboarding
  del upstream solo se abre a pedido y siempre se puede cerrar.
- **Edición con Claude** (`npm run claude-edit`, `CLAUDE-EDIT.md`): CLI que transcribe
  con Whisper + DTW, lista las frases con ids de palabra y aplica un plan de cortes
  (rangos de palabras con `expect`, pausas, muletillas) con la misma lógica de «Quitar
  pausas», escribiendo un proyecto aparte `<nombre> (Claude).recordly`; `listen`
  vuelve a transcribir la línea de tiempo editada para verificar los cortes. `timeline` y
  `export --no-captions` alimentan los motion graphics; `export --no-webcam` + `webcam`
  dejan la cámara aparte para que el motor arme tomas propias (esquina, completa, grande,
  dividida); el criterio está en `perfiles-video/` (perfiles «exagerado», «narrativa» y
  «gaming») y las instrucciones para Codex en `AGENTS.md`.

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
Los guiones en `scripts/e2e/` (`e2e-retake.mjs`, `e2e-multiwindow.mjs`, `e2e-append-take.mjs`,
`e2e-remove-silences*.mjs`, `e2e-new-controls.mjs`, `e2e-shortcut-start.mjs`, `cdp.mjs`) seleccionan
la pantalla, graban, rehacen/cancelan y comprueban los archivos y las ventanas. Para
probar siempre hay que cerrar solo los procesos cuyo `CommandLine` contenga esa carpeta
de datos, nunca la Recordly del usuario. Los controles de HeroUI necesitan eventos de
puntero reales (`pointerdown/up` + `click`), no un `click()` suelto; el atajo global se
prueba con `SendKeys` de PowerShell (ver `e2e-shortcut-start.mjs`).

## Sincronizar con el upstream

```bash
git fetch origin main:refs/remotes/origin/main
git merge origin/main   # en ics-main
```

Conflictos típicos: `package.json`/`package-lock.json` (volver a `npm install
--ignore-scripts`), `projectPersistence.ts`, `SettingsPanel.tsx`, `editorPreferences.ts`.
