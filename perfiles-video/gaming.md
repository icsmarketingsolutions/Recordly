# Perfil «gaming» (caótico)

En el plan: `"perfil": "gaming"` (valores por defecto en `_videos-brag/_motor/perfiles/gaming.json`).
Los otros perfiles están en [README.md](README.md).

Edición con personalidad, irreverente y muy gamer, con **timing cómico preciso**: como si un
editor con sentido del humor estuviera mirando el material y metiéndose en la conversación.
Tiene que sentirse **original y hecha a mano**, no «edición de IA»: nada de un pip/pop en
cada subtítulo ni de efectos de relleno.

**Intensidad:** energía 8/10 · exageración 8/10 · memes 6/10 · elaboración visual 8/10 ·
humor absurdo 8/10 · **retención 10/10**.

**Criterio principal:** cada intervención potencia una reacción, cuenta algo, prepara un
chiste o lo remata. Si no hace ninguna de las cuatro, se quita.

## 0. La voz del canal: Nanoyackson

El canal de gaming de Isaac (YouTube «Nanoyackson», humor tico, gameplays con la cara en
cámara; en su época dorada, PUBG). Lo que lo hacía funcionar y hay que mantener:

- **Habla tica sin filtro**: «mi gente», «mae», «la vara», «pura vida», groserías incluidas;
  el humor sale de él mismo (se burla de lo malo que es), nunca de otros.
- **Firma de edición**: una canción de fondo por tramo (la de Mario era la clásica) y
  **zoom lento sobre cada toma que se reinicia en el corte**; cada toma trae otro movimiento
  (acercarse, alejarse, deslizarse), sutil y sin marear: el video se siente vivo.
- **Cortes secos** y muchos: fuera los silencios, las vueltas y lo que no aporta.
- **Reverberación** en frases dramáticas (`voz` `catedral`), con la música cortada.
- Primeros planos a la cara en las reacciones (`camara` `completa`, `cara`).

Si Isaac cuenta frases típicas o chistes recurrentes del canal, se agregan aquí.

## 0b. Retención (antes que los efectos)

1. **Arranque frío** (0–10 s): el peor caos del video primero, se congela («¿cómo llegamos
   a esto?») y corta al inicio. Nunca arrancar con un saludo largo.
2. **Un hilo con final**: convertir el video en una meta con resultado (un examen, un reto,
   una licencia) y mostrar el avance con un recurso que vuelve (tarjeta con sellos).
3. **Ciclo abierto**: adelantar en el primer minuto que «al final pasa algo raro» y pagarlo.
4. **Recorte sin piedad**: queda solo lo que se entiende sin contexto y suma; las
   explicaciones largas se dejan en una frase. Gameplay sin voz: timelapse (`ensamblar.mjs`,
   `speed` hasta 16×) con música.
5. **Contexto siempre**: la primera vez que aparece una app, un mod o un juego, un `rotulo`
   dice qué es en una línea. Un chiste que depende de algo cortado (p. ej. «100 dólares» =
   el precio del GTA VI) se queda sin la frase que lo explica: recuperarla en la EDL o
   ponerla en una nota. Revisión de Isaac del 27-oct-2026.
6. **Gameplay antes que cara** en la acción (subir, escapar, esquivar): ahí la toma
   `completa`/`grande` tapa lo que pasa; la cámara va en `esquina`. Y no abrir con un
   primer plano de la cara (en ese video se le veían los ojos rojos): el arranque es
   gameplay.
7. Un **HUD con concepto** en vez de genérico: que el propio tema del video dé el lenguaje
   visual (p. ej. dron FPV → OSD de gafas, batería = barra de progreso, pérdida de señal
   como transición).

### Shorts (verticales, 40–60 s)

Se sacan de videos ya armados (`_videos-brag/_motor/vertical.mjs`, ver `SOBREVIDEO.md`):

- **Un short = una sola idea con final**: un reto (una cueva, una carrera), una historia (el
  regreso al canal) o una opinión con prueba («ya no edito mis videos» → y el resultado).
- **Gancho en el primer segundo**: el momento más fuerte va primero (el choque, el grito) con
  un `gancho` arriba que dice de qué va en 5–7 palabras; si el pago es otro momento, se
  congela («¿cómo llegamos a esto?») y corta al inicio.
- **Toma por momento**: `juego` (juego arriba, cara abajo) cuando lo que pasa en pantalla es
  lo importante; `cara` cuando habla y el juego es relleno; `full` para la acción pura.
- El recurso que vuelve (la licencia FPV) cierra cada short: así cada short es una parte de
  la misma historia y lleva al video largo. Cierre: «Video completo en el canal».
- Historia del canal con **datos reales del canal** (títulos y vistas de sus videos viejos en
  `tarjeta`), nunca cifras inventadas.

## 1. Flujo

Igual que [exagerado.md](exagerado.md) §1, con la **cámara aparte** (este perfil vive de
las tomas de cámara). Si viene de OBS (perfil «Grabacion juego»: juego en `Videos\Juego`,
cámara en `Videos\Camara`), primero `import`. En la fase 1 van **siempre** las
repeticiones fuera y las pausas acortadas con
`"pauses": { "minMs": 2500, "padMs": 400, "keepMs": 1500 }` (se queda lo más movido del
gameplay; ver `CLAUDE-EDIT.md`).

```bash
npm run -s claude-edit -- import   "<obs>.mp4" --webcam "<cámara>.mp4" --name "<p>"
npm run -s claude-edit -- timeline "<p> (Claude).recordly" --out words.json
npm run -s claude-edit -- export   "<p> (Claude).recordly" --out pantalla.mp4 --no-captions --no-webcam
npm run -s claude-edit -- webcam   "<p> (Claude).recordly" --out cam.mp4
# plan: "camara": { "archivo": "cam.mp4", "cara": [x, y] }  (cara = centro de la cara en el cuadro de la cámara, 0–1)
```

Si la grabación no tiene cámara, el perfil funciona igual pero pierde los recursos de
cara (`cara`, `personaje`, retratos, tomas): avisar a Isaac.

**Varias grabaciones en un video** (un hub + un video por juego, arranque frío con tramos
repetidos, timelapse de más de 2×): en vez de Recordly, `_videos-brag/_motor/ensamblar.mjs`
con una EDL (lista de tramos por ids de palabra o segundos, con `expect`). Transcribir cada
proyecto con `claude-edit transcribe` y armar la EDL leyendo `transcript`; sale
`pantalla.mp4` + `cam.mp4` (encuadrada en la cara de cada fuente) + `juego.wav` +
`words.json` + `cortes.json` (los cortes alimentan `respira`). Ver `SOBREVIDEO.md`.

## 2. Encontrar el chiste (antes de escribir el plan)

Leer la transcripción completa y mirar la cámara buscando **material**, no huecos:

- expresiones, caras, gestos raros, movimientos de manos;
- silencios incómodos, titubeos, la misma palabra dicha dos veces seguidas;
- errores, contradicciones, cambios de opinión («pero también…» = plot twist);
- cifras que duelen (precios, comisiones, tiempos) → barras de vida;
- frases de doble sentido, gritos, exageraciones.

Anotar 8–15 momentos así con su frase. Cada uno es un chiste posible. Buscar **chistes
recurrentes**: un recurso que vuelve (la misma barra de vida que se sigue vaciando, el
mismo personaje del diálogo, la misma frase del editor) y rematarlo al final.

## 3. Densidad y ritmo

| Qué | Ideal |
|---|---|
| Zoom que respira (`respira` con los `cortes`) | en **todas** las tomas, 1,04–1,06 |
| Intervención (cualquier beat) | 1 cada **3–5 s** en las ráfagas |
| Ráfagas intensas | 15–30 s, separadas por **pausas** de 4–8 s con solo subtítulos y la toma |
| Cambios de toma (`camara`) | 3–6 por minuto |
| Grandes explosiones (`mlg`, `derrota`, `cara`, `congelar`) | 1–2 por minuto, **solo en los mejores momentos** |
| Comentarios del editor | 3–6 por minuto |

Contraste: alternar ráfagas con planos sostenidos, silencios y **regresos repentinos a la
normalidad**. La historia y la voz se tienen que seguir entendiendo siempre.

## 4. Tomas de cámara (`camara`)

| Toma | Para qué |
|---|---|
| `esquina` (por defecto) | hablar mientras se muestra la pantalla |
| `completa` | ganchos, reacciones, remates, «mirando a cámara» |
| `grande` | la persona es el centro y la pantalla es contexto (miniatura arriba) |
| `dividida` | comparar lo que dice con lo que se ve; demos donde importa la cara (`lado: "izquierda"` invierte) |
| `pantalla` | la cámara se esconde: cuando lo que importa es un detalle de la pantalla |

Cambiar de toma en el **inicio de una frase**, nunca a mitad de palabra (`at` + `offset`
negativo de 0,2–0,4 s). `transicion` (s) por defecto 0,45; cortes secos con 0,15.

## 5. Catálogo

**Comentarios del editor** (`comentario`, estilos `impacto` · `comic` · `mlg` · `nota`):
frases cortas y sueltas adaptadas al contexto y al vocabulario de quien habla:
«se le reinició Windows», «el cerebro abandonó la partida», «misión fallida», «NPC
detectado», «+10 de estupidez», «cara de pendejo :v». Faltas intencionales y emoticonos
cuando suman al chiste. Que aparezcan en el momento exacto y duren lo suficiente para
leerlos (≈ 1 s por cada 3 palabras, mínimo 1,2 s). `nota` (cursiva chica) para los
comentarios secos tipo «(silencio incómodo)».

**HUD de videojuego** — que **reaccione** a lo que pasa:

| Tipo | Cuándo |
|---|---|
| `vida` (`nombre`, `inicio`, `fin`) | golpe al ego, a la billetera, a la paciencia: se vacía en la frase que duele |
| `logro` (`text`, `icono`, `puntos`) | algo sale bien, un logro absurdo («Habló 10 s sin trabarse») |
| `mision` (`text`, `objetivos`, `estado` + `estadoAt`) | una meta (o una mala decisión que activa una misión imposible); el sello `fallida`/`completada` remata |
| `dialogo` (`nombre`, `text`) | convertir una frase en diálogo de RPG; el retrato es la cámara en vivo |
| `busqueda` (`estrellas`) | algo «ilegal», arriesgado o polémico: nivel de búsqueda |
| `xp` (`text`) | recompensa flotante («+50 de rapidez») |
| `personaje` (`titulo`, `nombre`, `stats`) | presentar a alguien o una opción como selección de personaje (stats inventados **claramente en broma**) |
| `derrota` (`text`, `sub`) | el error del video: todo a gris, banda roja y trombón triste |

**Memes e intervenciones:**

| Tipo | Cuándo |
|---|---|
| `mlg` (`textos`) | el momento más «épico» o más ridículo: hitmarkers en la cara, lentes que caen, airhorn, sacudida |
| `error` (`titulo`, `text`, `n`) | algo se rompe, se traba o se complica: ventanas de Windows en cascada |
| `congelar` (`texto`) | antes de un remate o un plot twist: cuadro detenido, saturado, rayón de disco |
| `cara` (`texto`, `zoom`) | reacción exagerada: la cara en un círculo enorme con rayos |
| `deformar` | una palabra rara o un gesto: estirar y aplastar la cámara |
| `vhs` · `glitch` · `pixel` | recursos cómicos **puntuales** (nostalgia, «se cayó el sistema», «calidad papa») |

**FPV** (cuando el video es de drones; `lib/sobrevideo-fpv.js`):

| Tipo | Cuándo |
|---|---|
| `osd` (`low: [t0, t1]`) | todo el video: REC, piloto, tiempo, señal y **batería = barra de progreso**; se esconde sola bajo tarjetas y señal |
| `senal` (`texto`) | transición entre secciones/juegos: estática analógica, desgarro y «SIN SEÑAL» o «CANAL 2 · …» |
| `licencia` (`pruebas`, `cambia`, `cambiaAt`, `sello`) | el hilo del video: carnet con las pruebas; vuelve al final de cada una con su sello |
| `choque` | cada choque **que se ve**: suma 1 al contador del OSD (chiste recurrente) |
| `rotulo` (`titulo`, `text`, `pos`) | contexto: qué es la app / el mod / la prueba que se está mostrando |

**Sonido** — la mitad del chiste, y **solo sonidos grabados de verdad**:

- Lo sintetizado suena artificial: el perfil (`sonidos` en `perfiles/gaming.json`) calla
  pop/tic/blip/click/whoosh/xp… y cambia golpe/hit/sello por grabaciones de
  `_motor/assets/sonidos-reales/` (puñetazo, WTF, «mmm yeah», CHAN CHAN, niños celebrando,
  censura, alarma, «I believe I can fly», suspenso, disparos, sax…). Un `sfx` o un `sonido`
  con el nombre de uno de esos archivos lo usa tal cual. Agregar sonidos nuevos ahí
  (recortados y nivelados, WAV 44,1 kHz) desde la carpeta de Isaac `Videos\Sonidos`.
- Pocos y en el momento exacto: puntuación del chiste, no fondo. Nunca en cada subtítulo.
- `silencio` (`dur`, `voz`): medio segundo de silencio **antes** del remate hace que
  funcione (anticipación → pausa → remate). La música se corta de golpe.
- **Censura** (recurrente): `silencio` con `voz: true` sobre la grosería + `sonido`
  `censura` encima; mejor si vuelve 2–3 veces en el video.
- `voz` (`efecto`: `aguda`, `grave`, `eco`, `catedral`, `saturada`, `radio`): pitch,
  reverberación absurda o distorsión en una frase.
- **Música por tramos** (`musicas`): una canción por sección que entra y sale en seco con el
  corte; contraste cómico (Rocky en una subida en timelapse, Titanic en flauta en el
  fracaso). Música con derechos (Mario…) puede llevarse un reclamo de Content ID: avisar.

## 6. Revisión de la hoja (antes del render)

- ¿Cada beat potencia, cuenta, prepara o remata? Tachar los que no.
- ¿Hay chistes recurrentes y vuelven al final?
- ¿Hay pausas entre ráfagas? ¿Alguna toma dura menos de 2 s sin motivo?
- ¿Algún texto tapa la cara o lo que se muestra en pantalla?
- ¿Los textos se alcanzan a leer?
- ¿La voz se entiende en las ráfagas (transcribir 20 s del final)?

## Reglas

Las de [README.md](README.md) siguen valiendo: nada inventado como si fuera verdad (lo
inventado tiene que ser **obviamente** broma: stats absurdos, logros ridículos), sin logos
de terceros, sin burlarse de clientes ni de terceros reales: el blanco del chiste es la
situación o quien habla.

Referencia aprobada por Isaac (24-oct-2026): tramo de 82 s de un video de demo con las
cinco tomas y casi todos los recursos (~30 beats en 82 s). Su plan (`motion.json` de la
carpeta de prueba del motor, fuera de este repo) es el ejemplo a copiar.
