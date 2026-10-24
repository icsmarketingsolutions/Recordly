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
