# Perfil «gaming» (caótico)

En el plan: `"perfil": "gaming"` (valores por defecto en `_videos-brag/_motor/perfiles/gaming.json`).
Los otros perfiles están en [README.md](README.md).

Edición explosiva, exagerada, irreverente y muy gamer: el espectáculo y la escalada de los
videos de retos de MrBeast + el humor de internet de los 2010 (montajes MLG, rage faces,
«:v», shitpost, errores de Windows) + motion graphics modernos. Tiene que sentirse
**elaborada, llena de detalles y con timing cómico preciso**, como si un editor con sentido
del humor estuviera mirando el material y metiéndose en la conversación.

**Intensidad:** energía 9/10 · exageración 9/10 · memes 8/10 · elaboración visual 9/10 ·
humor absurdo 9/10.

**Criterio principal:** cada intervención potencia una reacción, cuenta algo, prepara un
chiste o lo remata. Si no hace ninguna de las cuatro, se quita.

## 1. Flujo

Igual que [exagerado.md](exagerado.md) §1, con la **cámara aparte** (este perfil vive de
las tomas de cámara):

```bash
npm run -s claude-edit -- timeline "<p> (Claude).recordly" --out words.json
npm run -s claude-edit -- export   "<p> (Claude).recordly" --out pantalla.mp4 --no-captions --no-webcam
npm run -s claude-edit -- webcam   "<p> (Claude).recordly" --out cam.mp4
# plan: "camara": { "archivo": "cam.mp4", "cara": [x, y] }  (cara = centro de la cara en el cuadro de la cámara, 0–1)
```

Si la grabación no tiene cámara, el perfil funciona igual pero pierde los recursos de
cara (`cara`, `personaje`, retratos, tomas): avisar a Isaac.

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
| Intervención (cualquier beat) | 1 cada **2–4 s** en las ráfagas |
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

**Sonido** — la mitad del chiste:

- `silencio` (`dur`, `voz`): medio segundo de silencio **antes** del remate hace que
  funcione (anticipación → pausa → remate). La música se corta de golpe.
- `voz` (`efecto`: `aguda`, `grave`, `eco`, `catedral`, `saturada`, `radio`): pitch,
  reverberación absurda o distorsión en una frase.
- `sonido` (`archivo`, `volumen`, `dur`): memes de audio reales o música épica de
  contraste (archivos en `_motor/assets/sonidos/`; solo con licencia de uso).
- SFX sintetizados que traen los tipos solos (`sfx` en cualquier beat los cambia):
  `hit`, `airhorn`, `error`, `logro`, `golpe`, `scratch`, `derrota`, `blip`, `xp`,
  `boom`, `select`, `vhs`, `glitch`, `estrella`, `epico`, `alarma`.

Reservar los sonidos más fuertes (`airhorn`, `boom`, `epico`) para las explosiones grandes.

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
