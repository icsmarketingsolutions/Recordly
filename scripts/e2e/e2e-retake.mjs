// Drives the packaged Recordly HUD over CDP: select a screen, record, retake, cancel.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 9333;
const RECORDINGS = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snapshot = () => ({
	recordings: fs.existsSync(RECORDINGS)
		? fs.readdirSync(RECORDINGS).filter((f) => f.startsWith("recording-"))
		: [],
	temp: fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("recordly-native-")),
});

let targets = [];
for (let i = 0; i < 30 && targets.length === 0; i++) {
	try {
		targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
			(t) => t.type === "page" && !/windowType=editor/.test(t.url),
		);
	} catch {}
	if (targets.length === 0) await sleep(1000);
}
if (targets.length === 0) throw new Error("HUD page not found");
const hud = targets.find((t) => /windowType=(launch|hud)/.test(t.url)) ?? targets[0];
console.log("page:", hud.url.slice(0, 80));

const ws = new WebSocket(hud.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
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
		throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
	return r.result?.result?.value;
};
const recordingHud = () =>
	evaluate(
		`(() => { const g = document.querySelector('[role="group"][aria-label="Recording controls"]'); return g ? g.querySelector('[role="status"] span:nth-child(2)')?.textContent : null; })()`,
	);
const click = (selector) =>
	evaluate(
		`(() => { const b = document.querySelector('${selector}'); if (!b) return false; b.click(); return true; })()`,
	);

if (!(await recordingHud())) {
	console.log(
		"source:",
		await evaluate(
			`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); const r = await window.electronAPI.selectSource(s[0]); return JSON.stringify({ picked: s[0].name, returned: r && r.name }); })()`,
		),
	);
	let hudHasSource = false;
	for (let i = 0; i < 10 && !hudHasSource; i++) {
		await sleep(500);
		hudHasSource = await evaluate(`!document.body.innerText.includes("Pick screen")`);
	}
	console.log("hud shows source:", hudHasSource);
	if (!hudHasSource) throw new Error("HUD never picked up the selected source");
}
if (await recordingHud()) {
	console.log("already recording, skipping record click");
} else {
	console.log("record click:", await click('[class*="recDot"]'));
	await sleep(9000);
}
const take1 = await recordingHud();
const s1 = snapshot();
console.log("take 1 elapsed:", take1, "files:", s1);

console.log("retake arm:", await click('[aria-label="Retake"]'));
await sleep(400);
console.log("retake confirm:", await click('[aria-label="Tap again to retake"]'));
await sleep(9000);
const take2 = await recordingHud();
const s2 = snapshot();
console.log("take 2 elapsed:", take2, "files:", s2);
const take1Files = [...s1.recordings, ...s1.temp];
const leftovers = take1Files.filter((f) => s2.recordings.includes(f) || s2.temp.includes(f));
console.log("take-1 leftovers after retake:", leftovers);

console.log("cancel arm:", await click('[aria-label="Cancel"]'));
await sleep(400);
console.log("cancel confirm:", await click('[aria-label="Tap again to discard"]'));
await sleep(4000);
const s3 = snapshot();
console.log("after cancel hud recording:", await recordingHud(), "files:", s3);
console.log(
	"RESULT",
	JSON.stringify({ take1, take2, leftovers, afterCancel: [...s3.recordings, ...s3.temp] }),
);
ws.close();
