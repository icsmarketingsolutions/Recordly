# Perfil «que-hago» (explicador 3D: ¿qué hago si…?)

Creado el 8-nov-2026 para el canal ¿QUÉ HAGO? de Isaac. A diferencia de los otros perfiles, no edita una
grabación: **construye todo el video** desde un guion. Motor: `1. Clientes/nanoyackson youtube/que hago/motor/`
(`voz.py`, `render.mjs`, `kit.js`, `capas.js`). Valores por defecto para cuando haya cámara real:
`_videos-brag/_motor/perfiles/que-hago.json`.

**La idea:** al que mira le pasa algo, tiene que decidir, se equivoca con el instinto y aprende qué sirve de verdad.
No es «5 consejos»: es una historia corta con una decisión en el medio.

## 1. La receta

| Tiempo | Qué pasa | Recurso |
|---|---|---|
| 0–3 s | La situación en una pregunta, con el personaje ya metido en el problema | Titular gigante, marca arriba |
| 3–15 s | Se pone peor; se nombra el problema | Plano que enseña el peligro (cenital, primer plano) |
| 15–20 s | **¿Qué hacés?** A/B/C con 2 s de silencio y tictac | `opciones`: la firma del canal |
| 20–35 s | Qué pasa con lo que haría cualquiera | `medidor` que se cae, sello «¡La peor!» |
| 35–65 s | La buena, en 2–4 pasos cortos | `paso`, flechas 3D, etiquetas |
| 65–75 s | El caso extra («¿y si no podés?», «¿y si le pasa a otro?») | Plano nuevo |
| últimos 5 s | «Mandáselo a…» y **el que sigue** | `siguiente`: la pregunta del próximo video |

Duración: 60–100 s, vertical 1080×1920. Una idea por video.

## 2. Cómo se ve

- **Mundo 3D de colores planos y vivos:** formas redondeadas, sombra suave, cielo claro, sin texturas.
- **Personaje simple y expresivo:** cabeza grande; las caras (`feliz`, `susto`, `cansado`) cuentan la historia.
- **Marca fija arriba:** burbuja naranja ¿QUÉ HAGO? + la situación. Si alguien cae a mitad del video, sabe de qué va.
- **Subtítulos:** 1–3 palabras, mayúscula, gruesa, borde negro, a 2/3 de la altura. Lo importante en amarillo.
- **Paleta:** naranja `#ff8a00`, amarillo `#ffd21f`, tinta `#141414`, rojo = mal, verde = bien.
- **Zonas libres:** nada importante en los 150 px de arriba, ni en la franja derecha y los 500 px de abajo que tapa la interfaz de Shorts.

## 3. Ritmo en números

| Qué | Pauta |
|---|---|
| Plano de cámara | cambia cada 2–5 s; la cámara nunca está quieta |
| Elemento nuevo en capas | uno cada 3–5 s, anclado a la palabra que lo nombra |
| Whoosh | en cada cambio de idea, suave |
| Música | baja con la voz (sidechain); −14 LUFS en total |
| Voz IA | `es-CR-JuanNeural` o `es-CR-MariaNeural`, `+10–14 %` |

## 4. Cómo habla

- **Línea tica:** voseo (`hacés`, `flotá`), `mae`, `diay`, `la vara`, lugares reales, CCSS, INS, SINPE, 9-1-1. Con sabor, sin forzar: 1–2 ticismos por video.
- **Línea internacional:** español neutro con `tú`, sin datos locales. Dobla bien a inglés.
- Frases de menos de 12 palabras. Hablarle a una sola persona. Nada de «en este video te voy a contar».

## 5. Reglas que no se negocian

1. **Sin fuente, no hay video.** Cada dato se verifica con una fuente primaria (CNE, CCSS, INS, OIJ, Cruz Roja, Instituto Clodomiro Picado, NOAA…) y las fuentes van en `guion.json` y en la descripción.
2. **Nada de cifras sin respaldo** («casi todo el mundo», «9 de cada 10»). Si no se puede citar, se reescribe.
3. **Temas de salud, legales y de emergencia:** decir qué hacer *primero* y a quién llamar. El video orienta, no reemplaza al médico ni al abogado; si la guía oficial se contradice, se aclara o no se dice.
4. **Noticias:** nada de víctimas con nombre ni morbo; lo que importa es qué hacer si te pasa a vos.
5. **Sin personajes, marcas ni logos de terceros;** de los videos de referencia se toma el género, no el contenido.

## 6. Variedad: YouTube desmonetiza lo que parece plantilla

La política de contenido no auténtico de YouTube castiga los videos en serie con poca variación, y revisa el canal entero, no cada video. A 2–3 por día este es el riesgo mayor. Por eso:

- **Cada video lleva escena propia** (lugar, cámara, elementos). El kit es la caja de piezas, no una plantilla para cambiarle el texto.
- La receta se dobla: no siempre A/B/C; a veces «mito o verdad», «lo que nadie te dice», historia de un error real.
- Alternar voz IA con la voz de Isaac, y sumar su cara cuando se pueda: es la mejor prueba de autor humano.
- Si un video se parece demasiado al anterior, se cambia el enfoque antes de renderizar.

## 7. Revisión antes de entregar

- [ ] ¿Las fuentes respaldan cada dato dicho y cada etiqueta?
- [ ] ¿Se entiende en los primeros 3 s sin audio?
- [ ] Hoja de contacto (`--hoja`): ¿cámara dentro de un objeto, pose rota, texto que tapa la cara, subtítulo fuera de cuadro?
- [ ] ¿La persona nada/camina hacia donde dice la voz?
- [ ] ¿Audio en −14 LUFS, sin picos?
- [ ] ¿Se parece demasiado al video anterior?

## 8. Referencia

Piloto APROBADO por Isaac (8-nov-2026, «Perfecto»): `videos/001-me-jala-el-mar/` en la carpeta del canal (`escena.js` es el ejemplo a copiar). Variante con otra estructura: `videos/002-me-muerde-terciopelo/` (varios sets, «pasillo de mitos» con X, voz de María).

**Revisar siempre de cerca, en cuadro grande, los objetos orgánicos:** en la hoja chica una forma puede verse bien y en el video parecer otra cosa. La culebra salió primero como un montón de bolitas y luego con cabeza de hongo; se arregló con cuerpo continuo, cuello fino y cabeza en cuña.
