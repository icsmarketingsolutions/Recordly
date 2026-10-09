# Recordly con efectos de cámara (IA)

Este fork añade un motor de efectos para la capa de webcam, en el editor:
**Webcam → Efectos de cámara (IA)**.

## Efectos

| Control | Qué hace |
| --- | --- |
| Fondo translúcido | Desenfoca el fondo detrás de la persona (segmentación de persona). |
| Opacidad del fondo | Velo oscuro o claro sobre el fondo, efecto vidrio esmerilado. |
| Oscurecer ambiente | Baja la luz del cuarto y añade una viñeta suave; la persona no se oscurece. |
| Corregir mirada | Levanta el iris hacia la cámara y recentra miradas laterales leves. Se apaga sola al parpadear, al girar la cabeza o al mirar lejos a un lado. Máximo 0.65 radios de iris. |
| Ojos sin rojez | Quita el rojo del blanco de los ojos (y pupilas rojas) sin tocar el iris ni la piel. |

**Sutil** carga un punto de partida natural; **Quitar** apaga todo.

## Flujo

1. La vista previa del panel muestra el cuadro actual con los efectos. Mantén
   presionado **Mantener: antes** para comparar.
2. **Aplicar a la grabación** procesa todo el video de la cámara (≈2× tiempo
   real) y lo guarda como `recording-<n>-webcam-fx.mp4` junto a las grabaciones.
   La capa de cámara pasa a usar esa copia, así que la vista previa, la
   exportación normal y la nativa salen con los efectos.
3. El original nunca se modifica. **Restaurar cámara original** vuelve a él;
   cambiar ajustes y aplicar de nuevo siempre parte del original.

Los ajustes se recuerdan (preferencias y presets); la copia procesada solo se
guarda en el proyecto, y el original queda protegido de la limpieza automática.

## Arquitectura

- `src/lib/cameraFx/vision.ts`: MediaPipe Face Landmarker (478 puntos con iris) y
  Selfie Multiclass, delegado GPU con respaldo CPU.
- `src/lib/cameraFx/gaze.ts`: geometría de ojos y desplazamiento de mirada (puro, con pruebas).
- `src/lib/cameraFx/renderer.ts`: WebGL2; desenfoque del fondo enmascarado a 1/4,
  warp del iris dentro del contorno del ojo (SDF del polígono), rojez y viñeta.
- `src/lib/cameraFx/engine.ts`: filtro One Euro sobre los puntos y suavizado
  temporal adaptativo de la máscara.
- `src/lib/cameraFx/bake.ts`: decodifica y re-codifica con mediabunny conservando
  cada timestamp (la sincronía con la pantalla no cambia).
- IPC `store-camera-fx-video`: guarda la copia sin los efectos secundarios de
  `store-recorded-video`.

La vertical de la mirada no se puede medir de forma fiable en 2D (los párpados
siguen al iris), por eso la corrección vertical es un levantamiento constante:
la cámara está arriba de la pantalla.

## Desarrollo

Los modelos y el runtime no van en git. `npm run prepare:camera-fx` copia el
runtime de `@mediapipe/tasks-vision` (versión fija 1.0.1) y descarga los dos
modelos verificando SHA-256 en `public/camera-fx/`. `dev` y los `build:*` lo
ejecutan solos.

```sh
npx vitest run src/lib/cameraFx src/components/video-editor/webcamOverlay.test.ts
npx tsc --noEmit
```
