// Records a take, then uses Clips → "Record a take" from the editor and checks
// that the second recording is appended to the same timeline as a new clip.
// usage: node e2e-append-take.mjs   (app already running with --remote-debugging-port=9333)
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
	return { evaluate, close: () => ws.close() };
}

const hudTarget = (pages) => pages.find((t) => /app\.asar\/dist/.test(t.url));
const editorTargets = (pages) => pages.filter((t) => /windowType=editor/.test(t.url));

async function recordWithHud(label) {
	// The HUD window is recreated when the editor asks for a take; wait for it.
	let target = hudTarget(await listPages());
	for (let i = 0; i < 30 && !target; i++) {
		await sleep(500);
		target = hudTarget(await listPages());
	}
	if (!target) throw new Error(`[${label}] HUD window not found`);
	const hud = await connect(target);
	for (let i = 0; i < 20 && (await hud.evaluate(`document.visibilityState`)) !== "visible"; i++)
		await sleep(500);
	if (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)) {
		await hud.evaluate(`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); await window.electronAPI.selectSource(s[0]); })()`);
		for (let i = 0; i < 10 && (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)); i++)
			await sleep(500);
	}
	await hud.evaluate(`(() => { document.querySelector('[class*="recDot"]').closest('button').click(); })()`);
	let recording = false;
	for (let i = 0; i < 20 && !recording; i++) {
		await sleep(1000);
		recording = await hud.evaluate(`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`);
	}
	console.log(`[${label}] recording:`, recording);
	await sleep(4000);
	await hud.evaluate(`(() => { document.querySelector('[aria-label="Stop"]').click(); })()`);
	hud.close();
}

const clipCount = (editor) =>
	editor.evaluate(`document.querySelectorAll('[data-timeline-item][data-variant="clip"]').length`);

// Take 1 → its own editor.
await recordWithHud("take 1");
let editors = [];
for (let i = 0; i < 30 && editors.length === 0; i++) {
	await sleep(1000);
	editors = editorTargets(await listPages());
}
console.log("editors after take 1:", editors.length);
const editor = await connect(editors[0]);
for (let i = 0; i < 30 && (await clipCount(editor)) === 0; i++) await sleep(1000);
console.log("clips before:", await clipCount(editor));

// Clips → Record a take.
console.log("open clips:", await editor.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Clips'); if (!b) return false; b.click(); return true; })()`));
await sleep(800);
console.log("record a take:", await editor.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Record a take'); if (!b) return false; b.click(); return true; })()`));
await sleep(1500);
await recordWithHud("take 2");

// The import re-encodes both takes, so give it time.
let clips = await clipCount(editor);
for (let i = 0; i < 120 && clips < 2; i++) {
	await sleep(1000);
	clips = await clipCount(editor);
}
console.log("clips after append:", clips, "| editors:", editorTargets(await listPages()).length);
console.log("source:", await editor.evaluate(`window.electronAPI.getCurrentVideoPath().then((r) => r.path || null)`));
console.log("RESULT", JSON.stringify({ clips, editors: editorTargets(await listPages()).length }));
editor.close();
