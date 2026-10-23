# Edición con Claude (`npm run claude-edit`)

Una CLI para que Claude lea lo que se dijo en una grabación de Recordly y corte los
errores sin abrir el editor. Escribe un proyecto `.recordly` normal: se abre en
Recordly, se revisa y se exporta como cualquier otro.

Código: `electron/cli/claudeEdit.ts` (lo empaqueta `scripts/claude-edit.mjs` con esbuild).
Reusa la lógica del editor: `planSilenceRemoval` (los mismos cortes que «Quitar
pausas»), `rippleRegions` para zooms y anotaciones, y el parser y la segmentación
de subtítulos de `electron/ipc/captions`.

## Comandos

Desde `Recordly/source`, con la ruta del proyecto (los proyectos viven en
`%APPDATA%\Recordly\recordings\Projects\`):

```bash
npm run -s claude-edit -- info        "<proyecto>.recordly"
npm run -s claude-edit -- transcribe  "<proyecto>.recordly" --lang es
npm run -s claude-edit -- transcript  "<proyecto>.recordly"
npm run -s claude-edit -- transcript  "<proyecto>.recordly" --words 120-135
npm run -s claude-edit -- apply       "<proyecto>.recordly" --plan plan.json --dry-run
npm run -s claude-edit -- apply       "<proyecto>.recordly" --plan plan.json
npm run -s claude-edit -- listen      "<proyecto> (Claude).recordly" --lang es
npm run -s claude-edit -- frame       "<proyecto>.recordly" --at 1:23.4
```

- **transcribe**: micrófono (con su desfase) o la pista de la grabación → Whisper
  (la build CUDA de `%APPDATA%\Recordly\whisper-cuda` si está; ~13 s por 3,5 min) con
  **DTW** (`-dtw <modelo> -nfa`): los tiempos propios de Whisper se corren hasta medio
  segundo en habla rápida y cortaban la palabra de al lado. Guarda en
  `%APPDATA%\Recordly\claude-edit\<projectId>\` la transcripción, las pausas
  (`silencedetect` −30 dB) y el volumen cada 10 ms. `--prompt` = glosario (nombres).
- **transcript**: frases con ids de palabra, en *tiempo de fuente* (no se mueve al
  cortar). `✂` ya cortado, `~` cortado en parte, `tl` = posición en la línea de tiempo.
- **apply**: nunca toca el original; escribe `<proyecto> (Claude).recordly` (con `.bak`
  del anterior si existe) y lo pone primero en «recientes». `--in-place` solo si Isaac
  lo pide. Si el proyecto no tenía subtítulos, les pone la transcripción
  (`"captions": false` en el plan para no hacerlo).
- **listen**: arma el audio de la línea de tiempo editada y lo transcribe de nuevo:
  es la verificación de los cortes sin exportar el video.

## El plan

```json
{
  "cuts": [
    { "words": "302-303", "expect": "tiene que", "reason": "arranque en falso" },
    { "words": "534-555", "expect": "Pero sí, si quisieran …", "reason": "cierre repetido" },
    { "from": "1:02.4", "to": "1:05.0", "reason": "pantalla con datos reales" }
  ],
  "pauses": { "minMs": 700, "padMs": 150 },
  "fillers": true
}
```

- `words` corta un rango de palabras; cada borde cae en el punto más silencioso justo
  antes del inicio de la palabra (nunca pasa la mitad de una palabra vecina).
- `expect` es obligatorio en la práctica: si las palabras del rango no dicen eso, el
  plan se rechaza (los ids cambian al volver a transcribir).
- `pauses`: igual que «Quitar pausas» del editor; `false` las deja. `fillers`: «eh»,
  «em», «um»… enteros, más las palabras que se pasen en una lista.

## Reglas de edición (para Claude)

1. `info` → `transcribe` → leer `transcript` completo antes de decidir nada.
2. Buscar: **tomas repetidas** (la misma idea arrancada dos veces: queda la última
   completa), **arranques en falso** («tiene que para, bueno…»), **palabras
   duplicadas** («un sistema, un sistema»), **frases que se dicen dos veces con otras
   palabras**, muletillas largas («o sea, digamos, este…») y pausas. Lo que ya está `✂`
   no se vuelve a cortar.
3. No corregir lo que Whisper oyó mal (marcas, nombres): eso es texto, no audio.
   Ante la duda, no cortar y anotarlo para Isaac.
4. Revisar `--words` alrededor de cada corte; poner `expect` y `reason` en todos.
5. `apply --dry-run` y leer «what remains» de corrido: tiene que sonar natural.
6. `apply` y luego **`listen`**: confirmar que cada error desapareció y que no se
   perdió ninguna palabra vecina. Si un corte quedó corrido, ajustar el rango y repetir.
7. Para datos sensibles en pantalla, `frame --at` y mirar el cuadro.
8. Contarle a Isaac qué se cortó (con `reason`), la duración antes → después y la ruta
   del proyecto «(Claude)». Él lo abre en Recordly, lo revisa y exporta.

## Probado (23-oct-2026)

«video para osa great adventure» (3:37): 4 cortes (arranque en falso, «en este en
específico», «un sistema» repetido, cierre grabado dos veces) + pausas ≥ 0,7 s →
3:00, 22 clips. `listen` y una exportación real de Recordly
(`RECORDLY_SMOKE_EXPORT_PROJECT`) confirman los cuatro errores fuera y ninguna palabra
perdida. Sin DTW, dos de los cortes se llevaban la palabra anterior.
