# AGENTS.md — fork de Recordly (ICS Marketing Solutions)

Instrucciones para agentes de código (Codex y similares). Claude Code usa la skill
`.claude/skills/editar-video`, que apunta a los mismos documentos. Responder a Isaac en
español.

## Qué es este repo

Fork de Recordly (grabador de pantalla en Electron) en la rama de trabajo **`ics-main`**.
Lo que agrega el fork está en `FORK.md`; cómo se construye y se prueba, también ahí.
Este repo es **público**: nunca subir nombres de clientes, frases de sus videos, rutas
con datos personales ni secretos.

## Si la tarea es editar un video

Leer en este orden y seguirlos al pie de la letra:

1. `CLAUDE-EDIT.md` — fase 1: transcribir y cortar errores con `npm run -s claude-edit`.
2. `perfiles-video/README.md` y el perfil elegido (`exagerado.md`, `narrativa.md` o `gaming.md`) — **el criterio de calidad** (densidad, subtítulos, catálogo de
   efectos, revisión). Sin esta guía el resultado queda pobre.
3. `../../_videos-brag/_motor/SOBREVIDEO.md` — fase 2: motion graphics con
   `node sobrevideo.mjs` (esa carpeta está fuera de git, junto a `Recordly/`).

Resumen de comandos (desde esta carpeta, Windows, Git Bash o PowerShell):

```bash
npm run -s claude-edit -- info        "<p>.recordly"
npm run -s claude-edit -- transcribe  "<p>.recordly" --lang es
npm run -s claude-edit -- transcript  "<p>.recordly"
npm run -s claude-edit -- apply       "<p>.recordly" --plan plan.json --dry-run
npm run -s claude-edit -- apply       "<p>.recordly" --plan plan.json
npm run -s claude-edit -- listen      "<p> (Claude).recordly" --lang es
npm run -s claude-edit -- timeline    "<p> (Claude).recordly" --out words.json
npm run -s claude-edit -- export      "<p> (Claude).recordly" --out base.mp4 --no-captions
# luego, en ../../_videos-brag/_motor:
node sobrevideo.mjs --video base.mp4 --palabras words.json --plan motion.json --out ../sobrevideo/<cliente> --hoja "1,<frase>,<frase>"
node sobrevideo.mjs --video base.mp4 --palabras words.json --plan motion.json --out ../sobrevideo/<cliente> --workers 6
```

Los proyectos de Isaac están en `%APPDATA%\Recordly\recordings\Projects\*.recordly`; «el
de hoy» es el modificado más recientemente (preguntar si hay duda).

## Reglas duras

- **Nunca** sobrescribir el proyecto original (`apply` sin `--in-place`, salvo pedido explícito).
- **Leer la transcripción completa** antes de cortar; cada corte por palabras lleva
  `expect` y `reason`; verificar siempre con `listen`.
- **Mirar la hoja de contacto** antes de cada render y revisar cuadros del video final.
- Nada inventado en pantalla: solo cifras, nombres y promesas que la persona dice.
- Planes, palabras y entregables de un cliente van en `../../_videos-brag/sobrevideo/<cliente>/`
  o en una carpeta temporal, **nunca en este repo**.
- Renders largos (más de 2 min) en segundo plano.

## Requisitos de la máquina (no viajan por git)

- `npm install --ignore-scripts` en esta carpeta.
- Whisper: `%APPDATA%\Recordly\whisper-cuda\bin\Release\whisper-cli.exe` (GPU) o el que
  trae Recordly; modelo en `%APPDATA%\Recordly\whisper\ggml-small.bin`.
- `../Recordly-Nuevo/Recordly.exe` (paquete del fork) o Recordly instalado, para `export`.
- `../../_videos-brag/_motor` con `node_modules`, Chrome instalado y FFmpeg de WinGet
  (`Gyan.FFmpeg`, 8 o más: usa `-/filter_complex`).

## Si la tarea es de código en este repo

- Definición de terminado: `npx tsc --noEmit` y `npx biome lint .` en cero avisos, y la
  función probada corriendo de verdad (no solo compilada).
- Commits con `-c user.name=icsmarketingsolutions -c user.email=294332648+icsmarketingsolutions@users.noreply.github.com`;
  `git add` explícito de los archivos tocados (hay scripts locales sin commitear que no se suben).
- Si cambia un flujo, actualizar `FORK.md` / `CLAUDE-EDIT.md` en el mismo commit.
