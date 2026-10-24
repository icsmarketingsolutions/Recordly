---
name: editar-video
description: Editar una grabación de Recordly con Claude — transcribir, encontrar errores al hablar (tomas repetidas, arranques en falso, palabras duplicadas, pausas) y cortarlos en un proyecto aparte «(Claude)». Usar cuando Isaac pida editar, limpiar o recortar una grabación o «el video de hoy».
---

Seguí `CLAUDE-EDIT.md` y `perfiles-video/` (los perfiles de edición: «exagerado» = estilo MrBeast, «narrativa» = escenas ilustradas, «gaming» = caótico con memes y HUD de videojuego; si Isaac no dice cuál, preguntar) en la raíz de este repo: comandos de `npm run claude-edit`,
formato del plan y las reglas de edición (leer todo, `expect` en cada corte,
`--dry-run`, `apply`, `listen` para verificar, reportar a Isaac).

- Proyectos: `%APPDATA%\Recordly\recordings\Projects\*.recordly`; «el de hoy» es el de
  fecha de modificación más reciente (preguntar si hay duda).
- Nunca sobrescribir el original (sin `--in-place` salvo pedido explícito).
- Los planes van al scratchpad de la sesión, no al repo.
- Fase 2 (motion graphics, «estilo MrBeast», subtítulos animados): `timeline` + `export --no-captions`
  y luego `_videos-brag/_motor/sobrevideo.mjs` según `_videos-brag/_motor/SOBREVIDEO.md`.
