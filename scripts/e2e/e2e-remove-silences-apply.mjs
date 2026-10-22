// Records a take, adds a recording with speech from the Clips library, runs
// "Remove pauses" and checks the timeline splits into more clips, then undoes.
// usage: node e2e-remove-silences-apply.mjs <file name inside the test recordings dir>
//        (app already running with --remote-debugging-port=9333)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speechName = process.argv[2];
if (!speechName) throw new Error("usage: e2e-remove-silences-apply.mjs <recording name>");
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
const clipsQuery = `document.querySelectorAll('[data-timeline-item][data-variant="clip"]').length`;

async function recordWithHud(label) {
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
	for (let i = 0; i < 20; i++) {
		await sleep(1000);
		if (await hud.evaluate(`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`)) break;
	}
	await sleep(3000);
	await hud.evaluate(`(() => { document.querySelector('[aria-label="Stop"]').click(); })()`);
	hud.close();
}

// Take 1 → editor, unless one is already open.
let editors = editorTargets(await listPages());
if (editors.length === 0) {
	await recordWithHud("take 1");
	for (let i = 0; i < 30 && editors.length === 0; i++) {
		await sleep(1000);
		editors = editorTargets(await listPages());
	}
}
const editor = await connect(editors[0]);
for (let i = 0; i < 30 && (await editor.evaluate(clipsQuery)) === 0; i++) await sleep(1000);
const clipsStart = await editor.evaluate(clipsQuery);
console.log("clips at start:", clipsStart);

// Clips → "Add <name> to timeline".
await editor.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Clips'); if (b) b.click(); })()`);
await sleep(1000);
let added = false;
for (let i = 0; i < 20 && !added; i++) {
	added = await editor.evaluate(
		`(() => { const b = document.querySelector('button[aria-label="Add ${speechName} to timeline"]'); if (!b) return false; b.click(); return true; })()`,
	);
	if (!added) await sleep(1000);
}
console.log("add to timeline clicked:", added);
let clipsBefore = clipsStart;
for (let i = 0; i < 600 && clipsBefore <= clipsStart; i++) {
	await sleep(1000);
	clipsBefore = await editor.evaluate(clipsQuery);
}
await sleep(3000);
console.log("clips before:", clipsBefore);

// Remove pauses.
await editor.evaluate(`document.querySelector('button[aria-label="Remove pauses"]').click()`);
let status = "";
for (let i = 0; i < 240; i++) {
	await sleep(500);
	status = await editor.evaluate(
		`(() => { const p = document.querySelector('[data-testid="remove-silences-popover"]'); return p ? p.innerText : ""; })()`,
	);
	if (status && !/Analyzing/.test(status)) break;
}
console.log("popover:", JSON.stringify(status.split("\n").filter(Boolean).slice(-2)));
const applied = await editor.evaluate(
	`(() => { const b = document.querySelector('[data-testid="remove-silences-apply"]'); if (!b || b.disabled) return false; b.click(); return true; })()`,
);
await sleep(2000);
const clipsAfter = await editor.evaluate(clipsQuery);
const toast = await editor.evaluate(
	`(() => { const n = [...document.querySelectorAll('[role="status"], [data-sonner-toast], [role="alert"], [data-toast]')].map((x) => x.textContent.trim()).filter(Boolean); return n.slice(-1)[0] || ""; })()`,
);
console.log("applied:", applied, "| clips after:", clipsAfter, "| toast:", toast.slice(0, 120));

// Undo brings the previous sequence back.
await editor.evaluate(
	`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }))`,
);
await sleep(1000);
const clipsUndo = await editor.evaluate(clipsQuery);
console.log("clips after undo:", clipsUndo);
console.log("RESULT", JSON.stringify({ clipsBefore, clipsAfter, clipsUndo, applied }));
editor.close();
