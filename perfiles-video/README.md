# Perfiles de edición de video

Un **perfil** es un estilo de edición completo: el criterio (este directorio, en git) más
los valores por defecto del motor (`_videos-brag/_motor/perfiles/<nombre>.json`, fuera de
git: viaja con el pase de compu). El plan elige uno con `"perfil": "<nombre>"`; todo lo
que el plan diga en `estilo`, `subtitulos`, `volumenSfx` o `musica` manda sobre el perfil.

| Perfil | Para qué | Ritmo | Criterio |
|---|---|---|---|
| `exagerado` | Videos de venta y redes: retener a toda costa | Un efecto cada 3–5 s, subtítulos gigantes palabra a palabra, zooms, emojis | [exagerado.md](exagerado.md) |
| `narrativa` | Explicar: comparar opciones, mostrar un proceso, enseñar | Escenas ilustradas que se arman al ritmo de la voz, alternadas con pausas de video limpio | [narrativa.md](narrativa.md) |
| `gaming` | Gameplays, reacciones, videos con personalidad | Ráfagas de memes, HUD de videojuego y bromas de sonido (1 cada 2–4 s) con pausas; tomas de cámara propias | [gaming.md](gaming.md) |

**Tomas de cámara (cualquier perfil):** con `claude-edit export --no-webcam` + `claude-edit
webcam` la cámara va aparte y el plan elige la toma (`esquina`, `completa`, `grande`,
`dividida`, `pantalla`) con beats `camara`. Ver `SOBREVIDEO.md`.

Si Isaac no dice cuál, preguntar. Un video puede llevar la **marca** de un producto
(colores, fuentes, mascota) con cualquier perfil: va en `estilo` del plan.

## Orden de trabajo (todos los perfiles)

1. **Recortes primero** (`CLAUDE-EDIT.md`, fase 1): pausas, muletillas y tomas repetidas
   fuera, verificado con `listen`. Nada de efectos hasta que el corte suene natural.
2. **Después el perfil** (fase 2): `timeline` + `export` del proyecto «(Claude)» y el plan
   del motor. Si hay que volver a cortar, se rehace `timeline` y se revisan las anclas.

Lo que se corta en la fase 1, sea cual sea el perfil:

- **Repeticiones y errores:** si la persona se equivoca y vuelve a decir lo mismo, queda
  solo la toma buena y completa, aunque el perfil sea de humor. Una repetición se deja
  solo si ella misma es el chiste (y eso se le cuenta a Isaac).
- **Silencios sin acción:** en gameplays y grabaciones largas, `pauses.keepMs` acorta cada
  pausa larga a su tramo con más movimiento en pantalla (ver `CLAUDE-EDIT.md`).

**Vocabulario tico:** `vocabulario.json` (este directorio) va en todos los perfiles: su
`whisperPrompt` le enseña a Whisper palabras como mae, tuanis, la vara, diay, brete, y
sus `correcciones` arreglan en los subtítulos los errores que Whisper repite (las del plan
van después y mandan). Cada palabra tica o nombre que salga mal se agrega ahí, no solo en
el plan del video.

## Reglas que valen para todos los perfiles

- Nada inventado: cifras, nombres y promesas solo si la persona los dice.
- Sin logos de terceros (solo texto con el nombre).
- El original nunca se toca; cortes en `<nombre> (Claude).recordly`.
- Mirar la hoja de contacto (`--hoja`) antes de cada render y revisar cuadros del final.
- Para probar un perfil o un tramo largo: `--tramo a,b` renderiza solo ese pedazo.
- Nombres de clientes y frases de sus videos **no** van a este repo (es público).

## Agregar un perfil nuevo

1. `perfiles-video/<nombre>.md` con el criterio: para qué sirve, ritmo en números,
   catálogo de recursos y cuándo usar cada uno, revisión.
2. `_videos-brag/_motor/perfiles/<nombre>.json` con `estilo`, `subtitulos`,
   `volumenSfx` y `musica.volumen` por defecto.
3. Si necesita recursos nuevos, agregarlos al motor (`lib/sobrevideo-escena.html`) y
   documentarlos en `SOBREVIDEO.md`.
4. Probarlo con `--tramo` sobre un video real y anotar la referencia aprobada.
