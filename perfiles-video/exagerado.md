# Perfil «exagerado» (estilo MrBeast)

En el plan: `"perfil": "exagerado"` (valores por defecto en `_videos-brag/_motor/perfiles/exagerado.json`).
Los otros perfiles están en [README.md](README.md).

Esta guía es el criterio. El motor (`_videos-brag/_motor/sobrevideo.mjs`, ver
`SOBREVIDEO.md` ahí) solo ejecuta lo que el plan pide; **la calidad sale de cómo se
escribe el plan**. Vale para Claude, Codex o cualquier agente.

Referencia aprobada por Isaac (23-oct-2026): un video de venta personalizado de 3 min
con 26 efectos + subtítulos dinámicos. Su veredicto: «obra maestra… quiero que sea así,
edición exagerada, con muchos detallitos». **Ese video es el piso, no el techo**: los
siguientes llevan más.

## 1. El flujo, sin saltarse pasos

1. **Cortar** (fase 1, `CLAUDE-EDIT.md`): transcribir, leer TODO, cortar tomas repetidas,
   arranques en falso y pausas, verificar con `listen`.
2. **Preparar**: `claude-edit timeline` (palabras en tiempo del video editado) y
   `claude-edit export --no-captions` (video base sin los subtítulos de Recordly).
3. **Mirar el video** antes de escribir nada: una hoja de 1 cuadro cada 10 s
   (`ffmpeg -i base.mp4 -vf "fps=1/10,scale=480:-2,tile=4x5" -frames:v 1 hoja-base.png`)
   y leer la transcripción por frases con tiempos. Anotar qué hay en pantalla en cada tramo.
4. **Escribir el plan** con las reglas de abajo.
5. **Hoja de contacto** (`--hoja` con 10–14 momentos: cada efecto importante + 2 tramos
   sin efectos) y revisarla con la lista de la sección 6. Corregir y repetir.
6. **Render**, y revisar 6 cuadros del `final.mp4` + transcribir un tramo de 20–30 s para
   confirmar que la voz se entiende sobre la música.
7. **Entregar** el video, la portada y el plan; contar en 3 líneas qué se hizo.

## 2. Densidad: «exagerado» en números

| Qué | Mínimo | Ideal |
|---|---|---|
| Efecto visual (cualquier beat que no sea subtítulo) | 1 cada 6 s | **1 cada 3–5 s** |
| Golpes de zoom (`punch`) | 1 por minuto | 2–3 por minuto, en las frases fuertes |
| Emojis | 1 por minuto | 2–3 por minuto, cada uno con sentido |
| Cambios de tema | `flash` siempre | `flash` + `callout` de título del tramo |
| Silencio visual | nunca más de 8 s sin nada nuevo en pantalla | — |

Un video de 3 min lleva **35–50 beats**. Si el plan tiene menos de 30, falta trabajo.

## 3. Subtítulos (lo que más se nota)

- Siempre activos, salvo durante `title` y `cta` (los tapan solos).
- `maxPalabras`: **3** (2 si el ritmo es muy rápido). Nunca frases largas.
- `enfasis`: **12–20 palabras**: cifras («2.5%»), nombres de producto, beneficios
  («gratis», «directo», «automático»), dolores («mediocre», «falta»), el CTA («demo»).
  Salen en verde y más grandes. No poner palabras comunes («muy», «bien»).
- `correcciones`: revisar CADA nombre propio, marca, sigla y cifra de la transcripción.
  Whisper se equivoca seguido con marcas (LAFISE, WeTravel, Tilopay, ONVO, Viator) y
  convierte palabras en otras («fishing» → «phishing»). Un subtítulo mal escrito arruina
  el efecto: ante la duda, corregir.
- Altura `y` 0,78–0,84; si hay algo importante abajo en pantalla, subir a 0,7.

## 4. Catálogo de efectos y cuándo usar cada uno

| Tipo | Úsalo cuando… | Detalles que lo hacen «pro» |
|---|---|---|
| `title` | primeros 0–3 s (gancho) y, si el video pasa de 2 min, al cambiar de bloque grande | 3–6 palabras; `sub` con emoji; con nombre del cliente si es personalizado |
| `callout` | se nombra algo que se ve en pantalla o un beneficio | ≤ 6 palabras; `point` hacia lo que se señala (flecha + anillo); `verde` = positivo, amarillo = atención |
| `punch` | frase fuerte, cifra, dolor, «mirá esto» | zoom 1,06–1,08 (1,10 solo si la cámara no queda cortada); `shake` 4–8 en dolores o sorpresas; `focus` hacia lo que importa |
| `emoji` | emoción o idea concreta (🏆 logro, 📱 celular, 🤖 IA, 🏦 banco, 📅 calendario, 🔥 algo fuerte, 💸 plata, ⚡ rápido, ✅ listo) | en el lado opuesto a la tarjeta o llamada activa; nunca dos a la vez |
| `stat` | se dice una cifra | `value` exacto a lo dicho; `label` corto; cuenta hacia arriba con *ding* |
| `list` | se enumeran 3+ cosas (opciones, mejoras, funciones) | `items` en el orden en que se dicen; `paso` ≈ ritmo del habla (0,4–0,9 s) |
| `highlight` | se señala un botón o zona concreta | `rect` medido sobre la hoja; 1,5–2,5 s |
| `flash` | cambio de pantalla o de tema | siempre en el corte de tema, anclado a la primera palabra del tema nuevo |
| `cta` | la invitación final («demo», «escribime») | hasta el final del video; `sub` = URL o contacto real |

Combos que funcionan (usar seguido):
- **Cifra**: `punch` + `stat` + palabra en `enfasis`.
- **Dolor**: `punch` con `shake` + `callout` amarillo + emoji.
- **Cambio de tema**: `flash` + `callout` con el título del tramo.
- **Enumeración**: `list` + `click` por ítem (viene solo).

## 5. Posiciones y lo que no se tapa

- Cuadro 1920×1080; posiciones en fracciones `[x, y]`.
- La cámara de Recordly va abajo a la derecha (≈ x 0,85–1, y 0,75–1): **nada encima**.
- Llamadas arriba al centro (`pos` y ≈ 0,15–0,2). Tarjetas (`stat`, `list`) a la derecha
  arriba (`y` 0,16–0,22) o a la izquierda si lo importante de la pantalla está a la derecha.
- No tapar lo que se está mostrando (el formulario, la cifra, el botón): mirar la hoja.
- Un solo elemento grande a la vez (tarjeta o llamada + emoji, no dos tarjetas).

## 6. Revisión de la hoja de contacto (obligatoria)

Para cada cuadro:
- [ ] ¿Se lee todo a tamaño de teléfono? ¿Nada cortado por los bordes?
- [ ] ¿El subtítulo dice exactamente lo que se escucha, con marcas bien escritas?
- [ ] ¿El efecto calza con lo que se dice en ese segundo?
- [ ] ¿Tapa algo que se está mostrando, o la cámara?
- [ ] ¿Hay un tramo de más de 8 s sin nada nuevo?
- [ ] ¿Algún dato inventado? Solo cifras, nombres y promesas que la persona DICE.

## 7. Reglas que no se negocian

- Nada inventado: cifras, testimonios ni funciones que no se digan en el video.
- Sin logos de terceros (solo texto con el nombre).
- Si se habla de cobros: «la procesadora aplica su propia tarifa» si se dice «sin comisión».
- El original nunca se toca: cortes en `<nombre> (Claude).recordly`, entregables aparte.
- Nombres de clientes y frases del video **no se suben** a este repo (es público): los
  planes y entregables viven en `_videos-brag/sobrevideo/<cliente>/`, fuera de git.

## 8. Esqueleto de plan (copiar y llenar)

```json
{
  "estilo": { "acento": "#ffd400", "acento2": "#2ee59d", "progreso": true },
  "subtitulos": { "maxPalabras": 3, "y": 0.8, "enfasis": ["<cifras>", "<producto>", "<beneficios>", "demo"] },
  "correcciones": [["<lo que oyó Whisper>", "<lo correcto>"]],
  "musica": { "archivo": "../_musica/<pista con licencia>.mp3", "desde": 0, "volumen": 0.12 },
  "beats": [
    { "type": "title", "t": 0.1, "dur": 3, "text": "Un video para <cliente>", "sub": "hecho a la medida 👋" },
    { "type": "callout", "at": "<frase>", "text": "<≤ 6 palabras>", "color": "verde", "pos": [0.5, 0.18] },
    { "type": "punch", "at": "<frase fuerte>", "zoom": 1.08, "dur": 1.4 },
    { "type": "emoji", "at": "<frase>", "offset": 0.3, "emoji": "🏆", "pos": [0.78, 0.26] },
    { "type": "flash", "at": "<primera palabra del tema nuevo>" },
    { "type": "stat", "at": "<cifra>", "offset": -0.4, "value": 0, "suffix": "%", "label": "<qué es>" },
    { "type": "list", "at": "<frase que abre la lista>", "title": "<título>", "items": ["…"], "paso": 0.8 },
    { "type": "cta", "at": "<frase de la invitación>", "offset": -0.2, "dur": 5, "text": "Demo gratis", "sub": "<url>" }
  ]
}
```

Música con licencia disponible: `_videos-brag/_musica/` (ver `LICENCIAS.md`); para Tours,
`tours-island-beat`, `tours-spanish-heart`, `tours-my-last-mojito`, `tours-okay`; para
Agenda, `agenda-happy-times`, `agenda-funky-triplets`, `agenda-feel-alive`, `agenda-pop-one`.
