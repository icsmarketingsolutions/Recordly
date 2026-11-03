# Perfil «recorrido» (demo narrada del sistema)

En el plan: `"perfil": "recorrido"` (valores por defecto en
`_videos-brag/_motor/perfiles/recorrido.json`). Creado el 3-nov-2026 a pedido de Isaac para los
videos en los que **enseña un sistema por dentro** (el primero: el recorrido de Tours Tico).
Es la mezcla de [narrativa.md](narrativa.md) (las ideas se vuelven escenas dibujadas) y
[gaming.md](gaming.md) (recortes sin piedad, contexto siempre, un recurso que vuelve), con la
**marca del producto** (colores, fuentes y mascota en `estilo` del plan).

**La regla de oro: la pantalla manda.** El espectador vino a ver el sistema. Todo lo que se
pone encima aprovecha los momentos en que se habla y en pantalla no pasa nada; cuando hay
clics, formularios o datos que leer, la pantalla queda limpia (solo subtítulos).

## 1. Cómo se ve

- **Escenas de papel** (las de «narrativa», con la marca): solo en los tramos de **pantalla
  quieta**. El video no desaparece: vuela a una ventana grande (`[0.5, 0.15, 0.46]`) y sigue
  ahí. Una escena por idea que **se explica mejor dibujada que mostrada**: un flujo de dinero,
  un antes/después, quién ve qué, por qué conviene.
- **Tarjeta de capítulo** (`capitulo`) al empezar cada sección: número, título corto y puntos
  de avance (el recorrido que se va cumpliendo = el hilo con final). Los mismos títulos van como
  capítulos de YouTube.
- **La mascota del producto** como guía: saluda al inicio, aparece en 3–5 momentos con un globo
  corto (una idea que remata, nunca una que se dijo igual) y celebra en el cierre. Va a la
  izquierda, la cámara está a la derecha.
- **Llamadas** (`callout`) solo cuando señalan algo que está pasando en pantalla y es fácil de
  perderse («Vista del teléfono», «Lógica condicional»), en zona vacía, ≤ 4 palabras.
- **Cámara chica y con fondo desenfocado** (Recordly: `webcam.effects.backgroundBlur` ≈ 0,9,
  tamaño ≈ 22). Nada de tomas grandes de la cara: la persona acompaña, no protagoniza.
- **Subtítulos limpios** (caja oscura, la palabra dicha en el acento de la marca).
- **Sonido sutil**: lápiz y tic en las escenas, un soplido en los capítulos; música baja con
  ducking. Nada de sonidos de meme.

## 2. Ritmo en números

| Qué | Pauta |
|---|---|
| Recortes (fase 1) | muletillas, enredos y tomas repetidas fuera; pausas de pensar casi a cero y las largas con acción en pantalla a ~1,5 s de lo que más se mueve: `"pauses": { "minMs": 650, "padMs": 160, "keepMs": 250, "longMs": 2500, "keepLongMs": 1500 }` |
| Esperas (algo cargando, una IA generando) | corte manual (`from`/`to`): queda solo el momento en que aparece el resultado |
| Capítulos | uno cada 45–90 s; 8–14 en un video de 8–10 min |
| Escenas | 30–45 % del video, 15–45 s cada una, solo sobre pantalla quieta |
| Pausas entre escenas | ≥ 8 s de video limpio |
| Llamadas y mascota fuera de escenas | 1 cada 10–20 s como máximo |

## 3. Encontrar los huecos (antes del plan)

1. `claude-edit apply` ya midió el movimiento de la pantalla (`motion.json` en la carpeta de
   trabajo del proyecto). Mapearlo a la línea editada y listar los tramos de **≥ 6 s con la
   pantalla quieta** y qué se dice en cada uno: ahí van las escenas.
2. Mirar la hoja de cuadros cada 6 s del original: dónde hay datos que leer (no tapar), dónde
   hay datos privados (tarjetas guardadas, correos, historiales: `difuminar` o corte) y qué
   pantallas se repiten.
3. Marcar las secciones: cada cambio de tema es un capítulo.

## 4. Qué recurso para qué idea

| La narración… | Recurso |
|---|---|
| explica un flujo (cobro, reserva, QR → reserva → banco) | `escena` con `nodo` + `flecha` `viaja` |
| dice quién puede ver qué (roles, permisos) | `escena`: persona → lo que ve (`check`) y lo que no (`tachar`) |
| compara («sin comisión» vs. las plataformas que cobran, app vacía vs. lista) | `escena` de dos columnas con `insignia` |
| muestra algo en pantalla que se pierde fácil | `callout` arriba, sin tapar la zona activa |
| remata una ventaja | `mascota` con globo de 2–4 palabras |
| empieza un tema | `capitulo` |
| deja ver un dato privado | `difuminar` (`rect` en fracciones del video base, `t`/`at`, `dur`) |

## 5. Revisión de la hoja

- [ ] ¿Alguna escena o llamada tapa algo que se está haciendo en pantalla?
- [ ] ¿Cada escena cae en un tramo de pantalla quieta y se entiende sin audio?
- [ ] ¿Capítulos con títulos cortos y en orden? ¿Los puntos de avance cuadran?
- [ ] ¿Algún dato privado visible (tarjetas, correos, teléfonos, historiales)?
- [ ] ¿Algún dato inventado? Cifras, nombres y promesas solo si se dicen.

## 6. Shorts

De cada recorrido salen 2–4 verticales de 40–70 s, **una ventaja con final** cada uno (p. ej.
«revendedores con QR», «el cliente elige cómo pagar», «sin comisión por reserva»): gancho
arriba en el primer segundo, la pantalla en el centro (con los zooms de Recordly), subtítulos
grandes abajo y la mascota en el cierre con la invitación a la demo.

## 7. Referencia

Primer video: recorrido de Tours Tico (3-nov-2026), plan en
`_videos-brag/sobrevideo/tours-overview-2026-11-03/motion.json` (fuera del repo).
