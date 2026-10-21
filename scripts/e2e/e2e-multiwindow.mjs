// Records two takes in a row and checks that each one opens in its own editor
// window, that the second launch brings the HUD back while the first editor stays
// open, and that each editor keeps its own recording.
import { spawn } from "node:child_process";

const [, , exePath, userDataDir] = process.argv;
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
		const r = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.result?.exceptionDetails)
			throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
		return r.result?.result?.value;
	};
	return { evaluate, close: () => ws.close() };
}

const hudTarget = (pages) => pages.find((t) => /app\.asar\/dist/.test(t.url));
const editorTargets = (pages) => pages.filter((t) => /windowType=editor/.test(t.url));

async function recordOneTake(label) {
	const hud = await connect(hudTarget(await listPages()));
	const visible = await hud.evaluate(`document.visibilityState`);
	console.log(`[${label}] hud visibility:`, visible);
	if (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)) {
		await hud.evaluate(
			`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); await window.electronAPI.selectSource(s[0]); })()`,
		);
		for (
			let i = 0;
			i < 10 && (await hud.evaluate(`document.body.innerText.includes("Pick screen")`));
			i++
		)
			await sleep(500);
	}
	const editorsBefore = editorTargets(await listPages()).length;
	await hud.evaluate(
		`(() => { const b = document.querySelector('[class*="recDot"]').closest('button'); b.click(); })()`,
	);
	let recording = false;
	for (let i = 0; i < 20 && !recording; i++) {
		await sleep(1000);
		recording = await hud.evaluate(
			`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`,
		);
	}
	console.log(`[${label}] recording:`, recording);
	await sleep(4000);
	await hud.evaluate(
		`(() => { const b = document.querySelector('[aria-label="Stop"]'); b.click(); return !!b; })()`,
	);
	let editors = [];
	for (let i = 0; i < 30; i++) {
		await sleep(1000);
		editors = editorTargets(await listPages());
		if (editors.length > editorsBefore) break;
	}
	console.log(`[${label}] editors after stop:`, editors.length, "(before:", editorsBefore + ")");
	hud.close();
	return editors;
}

const take1Editors = await recordOneTake("take 1");
await sleep(3000);

// Second launch with the same user data: the single-instance lock turns it into a
// "second-instance" event, which should bring the HUD back next to the editor.
const second = spawn(exePath, [`--user-data-dir=${userDataDir}`], {
	detached: true,
	stdio: "ignore",
});
second.unref();
await sleep(4000);
const hudAfter = await connect(hudTarget(await listPages()));
console.log("[second launch] hud visibility:", await hudAfter.evaluate(`document.visibilityState`));
console.log("[second launch] editors still open:", editorTargets(await listPages()).length);
hudAfter.close();

const take2Editors = await recordOneTake("take 2");

const videos = [];
for (const target of take2Editors) {
	const editor = await connect(target);
	videos.push(
		await editor.evaluate(
			`window.electronAPI.getCurrentVideoPath().then((r) => r.path || null)`,
		),
	);
	editor.close();
}
console.log("editor videos:", videos);
console.log(
	"RESULT",
	JSON.stringify({
		editorsAfterTake1: take1Editors.length,
		editorsAfterTake2: take2Editors.length,
		distinctVideos: new Set(videos.filter(Boolean)).size,
	}),
);
