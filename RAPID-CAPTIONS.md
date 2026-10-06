# Recordly con subtítulos rápidos

Este fork conserva Recordly 1.4.0 y añade subtítulos cortos con animación Pop.

## Uso

1. Abre Captions y selecciona el modelo de reconocimiento y Spanish.
2. Selecciona **Subtítulos rápidos · Pop** y el máximo de palabras (3 por defecto, de 1 a 6).
3. Pulsa **Generate Captions** o **Regenerate Captions**.

El modo y el máximo de palabras se recuerdan para nuevos videos y se guardan en los presets. El modelo reconoce el audio; el modo de subtítulos controla cómo se agrupa el texto.

Los bloques usan los tiempos por palabra de Whisper y se cortan también en pausas y finales de oración. La generación solicita segmentos por palabra. El parser ignora los tokens de control de Whisper, que antes podían descartar los tiempos válidos. Los subtítulos antiguos sin tiempos válidos requieren regeneración.

## Desarrollo

Sigue los requisitos de compilación del README original. Para compilar Windows con las herramientas nativas instaladas:

```sh
npm ci
npm run build:win
```

Pruebas de los cambios:

```sh
npx vitest run electron/ipc/captions/parser.test.ts electron/ipc/captions/segment.test.ts src/components/video-editor/rapidCaptions.test.ts src/components/video-editor/editorPreferences.test.ts
npx tsc --noEmit
```

Este repositorio contiene código fuente. Aún no se ha publicado un instalador de esta variante en Releases. Las grabaciones, proyectos, modelos descargados y preferencias personales no se incluyen.

La distribución local usada para las pruebas reutiliza los binarios nativos de la instalación oficial de Windows. Los scripts locales de empaquetado y verificación de una grabación particular no forman parte del fork.
