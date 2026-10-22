// Starts a recording from the HUD (via Clips → "Record a take" when an editor is
// open) and exits while it is still recording, so an OS-level key chord can be
// sent next (e.g. PowerShell SendKeys "^+S") and e2e-shortcut-check.mjs can read
// the HUD state afterwards.
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
	const evaluate = (expression) =>
		new Promise((r) => {
			const n = ++id;
			pending.set(n, (m) => r(m.result?.result?.value));
			ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
		});
	return { evaluate, close: () => ws.close() };
}
const hudTarget = (pages) => pages.find((t) => /app\.asar\/dist/.test(t.url));
const editorTarget = (pages) => pages.find((t) => /windowType=editor/.test(t.url));

const editor = editorTarget(await listPages());
if (editor) {
	const e = await connect(editor);
	await e.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Clips'); if (b) b.click(); })()`);
	await sleep(800);
	await e.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Record a take'); if (b) b.click(); })()`);
	e.close();
	await sleep(1500);
}
let target = hudTarget(await listPages());
for (let i = 0; i < 30 && !target; i++) {
	await sleep(500);
	target = hudTarget(await listPages());
}
const hud = await connect(target);
for (let i = 0; i < 20 && (await hud.evaluate(`document.visibilityState`)) !== "visible"; i++) await sleep(500);
if (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)) {
	await hud.evaluate(`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); await window.electronAPI.selectSource(s[0]); })()`);
	for (let i = 0; i < 10 && (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)); i++) await sleep(500);
}
await hud.evaluate(`(() => { document.querySelector('[class*="recDot"]').closest('button').click(); })()`);
let recording = false;
for (let i = 0; i < 20 && !recording; i++) {
	await sleep(1000);
	recording = await hud.evaluate(`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`);
}
console.log("recording:", recording);
hud.close();
