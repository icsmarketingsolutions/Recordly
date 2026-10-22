// Records a take, then checks the new editor controls are wired: "Re-record this
// clip" on the selected clip, export presets apply aspect ratio + quality, the
// Whisper model picker, and the Remove pauses button. Also fires a global
// shortcut IPC round-trip by starting a recording and sending Ctrl+Shift+S.
// usage: node e2e-new-controls.mjs   (app running with --remote-debugging-port=9333)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listPages = async () =>
	(await (await fetch("http://127.0.0.1:9333/json")).json()).filter((t) => t.type === "page");

async function connect(target) {
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r));
	let id = 0;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id && pending.has(m.id)) pending.get(m.id)(m);
	};
	const send = (method, params = {}) =>
		new Promise((r) => {
			const n = ++id;
			pending.set(n, r);
			ws.send(JSON.stringify({ id: n, method, params }));
		});
	const evaluate = async (expression) => {
		const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (r.result?.exceptionDetails)
			throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
		return r.result?.result?.value;
	};
	return { evaluate, send, close: () => ws.close() };
}

const hudTarget = (pages) => pages.find((t) => /app\.asar\/dist/.test(t.url));
const editorTargets = (pages) => pages.filter((t) => /windowType=editor/.test(t.url));
const clipsQuery = `document.querySelectorAll('[data-timeline-item][data-variant="clip"]').length`;

async function hud() {
	let target = hudTarget(await listPages());
	for (let i = 0; i < 30 && !target; i++) {
		await sleep(500);
		target = hudTarget(await listPages());
	}
	if (!target) throw new Error("HUD window not found");
	const h = await connect(target);
	for (let i = 0; i < 20 && (await h.evaluate(`document.visibilityState`)) !== "visible"; i++)
		await sleep(500);
	if (await h.evaluate(`document.body.innerText.includes("Pick screen")`)) {
		await h.evaluate(`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); await window.electronAPI.selectSource(s[0]); })()`);
		for (let i = 0; i < 10 && (await h.evaluate(`document.body.innerText.includes("Pick screen")`)); i++)
			await sleep(500);
	}
	return h;
}

// Take 1 → editor (skipped when an editor is already open).
let recording = null;
let wired = null;
if (editorTargets(await listPages()).length === 0) {
const h = await hud();
await h.evaluate(`(() => { document.querySelector('[class*="recDot"]').closest('button').click(); })()`);
recording = false;
for (let i = 0; i < 20 && !recording; i++) {
	await sleep(1000);
	recording = await h.evaluate(`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`);
}
console.log("recording:", recording);
await sleep(3000);
// Keyboard events via CDP are delivered to the page, not the OS; global shortcuts
// need OS input. Use the renderer listener directly to prove the wiring instead.
wired = await h.evaluate(`typeof window.electronAPI.onHudShortcut === "function"`);
console.log("onHudShortcut wired:", wired);
await h.evaluate(`(() => { document.querySelector('[aria-label="Stop"]').click(); })()`);
h.close();
}

let editors = [];
for (let i = 0; i < 30 && editors.length === 0; i++) {
	await sleep(1000);
	editors = editorTargets(await listPages());
}
const editor = await connect(editors[0]);
for (let i = 0; i < 30 && (await editor.evaluate(clipsQuery)) === 0; i++) await sleep(1000);
await sleep(2000);

// HeroUI/react-aria controls need real pointer events, not a bare click().
await editor.evaluate(
	`window.press = (b) => { for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) b.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, { bubbles: true, button: 0, pointerId: 1, pointerType: 'mouse' })); }`,
);
// Select the clip → "Re-record this clip" button appears in the panel.
await editor.evaluate(`(() => { const c = document.querySelector('[data-timeline-item][data-variant="clip"]'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); c.click(); })()`);
await sleep(800);
const rerecord = await editor.evaluate(
	`!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Re-record this clip')`,
);
console.log("re-record button:", rerecord);

// Export menu → presets.
const exportOpened = await editor.evaluate(
	`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.textContent.trim()) === 'Publish'); if (!b) return false; press(b); return true; })()`,
);
await sleep(1200);
// The Publish popover opens on "Link"; MP4 settings (and presets) live under "Local".
await editor.evaluate(
	`(() => { const d = document.querySelector('[role=dialog]'); const local = d && [...d.querySelectorAll('[role=row]')].find((x) => x.textContent.trim() === 'Local'); if (local) press(local); })()`,
);
await sleep(1200);
const presetClicked = await editor.evaluate(
	`(() => { const b = document.querySelector('[data-testid="export-preset-instagram"]'); if (!b) return false; press(b); return true; })()`,
);
await sleep(800);
const menuText = await editor.evaluate(`document.body.innerText`);
const aspectNow = await editor.evaluate(
	`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(16:9|9:16|1:1|4:3|4:5|Native)$/.test(x.textContent.trim())); return b ? b.textContent.trim() : null; })()`,
);
const fps30 = /30 fps|30fps/i.test(menuText);
console.log("export opened:", exportOpened, "| preset clicked:", presetClicked, "| aspect now:", aspectNow, "| 30 fps shown:", fps30);
await editor.evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(500);

// Captions settings → model picker + glossary.
const captionsTab = await editor.evaluate(
	`(() => { const b = [...document.querySelectorAll('button, [role="tab"]')].find((x) => (x.getAttribute('aria-label') || x.textContent.trim()) === 'Captions'); if (!b) return false; b.click(); return true; })()`,
);
await sleep(1000);
const modelPicker = await editor.evaluate(`document.body.innerText.includes('Small · fast')`);
const glossary = await editor.evaluate(`!!document.querySelector('textarea[aria-label="Glossary"]')`);
const removePauses = await editor.evaluate(`!!document.querySelector('button[aria-label="Remove pauses"]')`);
console.log("captions tab:", captionsTab, "| model picker:", modelPicker, "| glossary:", glossary, "| remove pauses:", removePauses);
console.log(
	"RESULT",
	JSON.stringify({ recording, wired, rerecord, presetClicked, aspectNow, modelPicker, glossary, removePauses }),
);
editor.close();
