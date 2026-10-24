# Perfil «narrativa» (narrativa visual elaborada)

En el plan: `"perfil": "narrativa"` (valores por defecto en
`_videos-brag/_motor/perfiles/narrativa.json`). Creado el 23-oct-2026 a pedido de Isaac.

**La idea:** las ideas principales de lo que se cuenta se convierten en escenas visuales
propias. Si se habla de un proceso, se dibuja el proceso; si se comparan dos opciones, se
arma una composición que deje ver la diferencia; si algo crece o se conecta, se ve crecer
y conectarse. Cada escena se arma **por etapas, sincronizada con la voz**, para que el
espectador descubra cada parte justo cuando la escucha.

## 1. Cómo se ve

- **Papel y tinta:** fondo crema con grano, trazos de tinta con un leve temblor de dibujo
  a mano (el «hervor» de las líneas), un acento cálido, uno verde y uno rojo. Con marca,
  los acentos y fuentes son los del producto.
- **El video original no desaparece:** vuela a una ventana sobre el papel
  (`video.rect`), sigue hablando ahí y vuelve a pantalla completa al cerrar la escena.
- **Subtítulos limpios:** frase corta (hasta 5 palabras) en una caja oscura abajo, la
  palabra dicha en el acento. Nada de letras gigantes.
- **Sonido sutil:** lápiz al dibujar, tic al aparecer un texto, sello al estampar una
  insignia, campanita en un check, un soplido suave al entrar y salir de una escena.
  Música baja (0,09).

## 2. Ritmo en números

| Qué | Pauta |
|---|---|
| Escenas | una por idea principal; 8–40 s cada una |
| Pausas | **entre escenas, 3–10 s de video limpio** (solo subtítulos): dan tiempo a entender |
| Etapas dentro de una escena | un elemento nuevo cada 1,5–4 s, anclado a la frase que lo nombra |
| Cobertura | 50–70 % del video dentro de escenas; nunca todo |
| Textos | ≤ 4 palabras por etiqueta; el título de la escena es una pregunta o idea corta |

Un video de 3–4 min lleva 6–10 escenas.

## 3. Qué recurso para qué idea

| La narración… | Composición | Elementos |
|---|---|---|
| describe un proceso o un flujo de dinero/datos | fila de nodos con flechas; una bolita `viaja` por la flecha | `nodo` + `flecha` (`viaja`) |
| dice «hay varias opciones», «se conecta con…» | nodo central con satélites y flechas punteadas que salen de a una | `nodo` + `flecha` (`punteada`) |
| compara dos opciones | dos columnas: navegador/objeto de cada lado, título marcado arriba, ventajas como insignias | `texto` (`marcador`), `navegador`, `insignia`, `check` |
| muestra una pantalla o un paso del usuario | navegador dibujado que se llena por partes (líneas, campo, botón) | `navegador` con `contenido` |
| destaca la opción recomendada | foco que oscurece todo menos esa | `foco` + `insignia` |
| dice una cifra o condición | nodo con ícono y la cifra en la etiqueta («Abrirla ≈ $150») | `nodo` |
| descarta algo | se tacha | `tachar` |
| elige o confirma | check verde | `check` |
| presenta a alguien o una emoción | mascota con globo | `imagen` |

Íconos: cualquiera de lucide.dev/icons por su nombre (`credit-card`, `landmark`,
`smartphone`, `bitcoin`, `user-round`, `ship`, `calendar-check`…): se dibujan trazo a trazo.

## 4. Composición

- El video va en una ventana grande a la derecha (`[0.52, 0.16, 0.44]`) cuando la escena
  es de una sola columna, o chico arriba a la derecha (`[0.71, 0.05, 0.26]`) cuando la
  escena necesita todo el ancho (comparaciones).
- Zona libre para subtítulos: de `y` 0,84 para abajo. Nada ahí.
- Título de la escena arriba a la izquierda (lo pone solo).
- Etiquetas que choquen con flechas: `textoPos: "arriba"`.
- Cada escena tiene un elemento protagonista (el más grande) y el resto lo acompaña.

## 5. Revisión de la hoja

- [ ] ¿Cada elemento aparece cuando se dice lo que representa (ni antes ni después)?
- [ ] ¿Se entiende la escena sin audio?
- [ ] ¿Algo choca: etiqueta con flecha, insignia con subtítulo, nada encima de la ventana?
- [ ] ¿Hay pausas de video limpio entre escenas?
- [ ] ¿Algún dato inventado?

## 6. Referencia

Prueba del 23-oct-2026: primeros 112 s del video de pasarelas de pago de Tours Tico
(5 escenas: cómo se cobra una reserva, un sistema/cinco pasarelas, dentro o fuera de tu web,
la recomendada, el cliente elige). El plan está fuera del repo, en
`_videos-brag/sobrevideo/tours-pasarelas-narrativa/escenas.json`: copiar de ahí la forma de cada escena.
