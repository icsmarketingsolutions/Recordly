// Records ~8 s with the webcam on and prints the webcam file's size and frame rate,
// to check the camera records at full quality while the HUD preview is open.
// Launch first: Recordly.exe --remote-debugging-port=9333 --user-data-dir=<test profile>
// usage: node scripts/e2e/e2e-webcam-quality.mjs <recordings dir> [camera name regex]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, , recordingsDir, cameraPattern = "."] = process.argv;
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
			ws.send(
				JSON.stringify({
					id: n,
					method: "Runtime.evaluate",
					params: { expression, awaitPromise: true, returnByValue: true },
				}),
			);
		});
	return { evaluate, close: () => ws.close() };
}
// HUD buttons carry their label in aria-label (HeroUI) or title.
const byLabel = (label) =>
	`[...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || x.title) === ${JSON.stringify(label)})`;
const click = (selectorJs) =>
	`(() => { const b = ${selectorJs}; if (!b) return false; for (const t of ["pointerdown", "pointerup"]) b.dispatchEvent(new PointerEvent(t, { bubbles: true })); b.click(); return true; })()`;

let target;
for (let i = 0; i < 40 && !target; i++) {
	target = (await listPages()).find((t) => /app\.asar\/dist/.test(t.url));
	if (!target) await sleep(500);
}
const hud = await connect(target);
for (let i = 0; i < 20 && (await hud.evaluate(`document.visibilityState`)) !== "visible"; i++)
	await sleep(500);
if (await hud.evaluate(`document.body.innerText.includes("Pick screen")`)) {
	await hud.evaluate(
		`(async () => { const s = await window.electronAPI.getSources({ types: ["screen"] }); await window.electronAPI.selectSource(s[0]); })()`,
	);
	await sleep(1500);
}
// Webcam on: open the camera menu and pick the camera.
if (await hud.evaluate(click(byLabel("Enable webcam overlay")))) {
	await sleep(1200);
	const picked = await hud.evaluate(
		click(
			`[...document.querySelectorAll("button")].find((x) => new RegExp(${JSON.stringify(cameraPattern)}, "i").test(x.textContent))`,
		),
	);
	console.log("camera picked:", picked);
	await sleep(2500);
}
console.log("webcam on:", await hud.evaluate(`!!${byLabel("Disable webcam overlay")}`));
const before = new Set(fs.existsSync(recordingsDir) ? fs.readdirSync(recordingsDir) : []);
await hud.evaluate(click(byLabel("Record")));
let recording = false;
for (let i = 0; i < 30 && !recording; i++) {
	await sleep(1000);
	recording = await hud.evaluate(
		`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`,
	);
}
console.log("recording:", recording);
await sleep(8000);
await hud.evaluate(click(`document.querySelector('[aria-label="Stop"]')`));
hud.close();
let webcamFile;
for (let i = 0; i < 40 && !webcamFile; i++) {
	await sleep(1000);
	webcamFile = fs
		.readdirSync(recordingsDir)
		.find((f) => !before.has(f) && /-webcam\.(mp4|webm)$/.test(f));
}
if (!webcamFile) throw new Error("no webcam file was written");
await sleep(2000);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const probe = spawnSync(
	ffmpeg,
	["-hide_banner", "-i", path.join(recordingsDir, webcamFile), "-map", "0:v", "-f", "null", "-"],
	{ encoding: "utf8" },
);
console.log(webcamFile);
const lines = probe.stderr.split(/\r?\n|\r/);
console.log(lines.find((l) => /Stream #0:0/.test(l))?.trim());
console.log(lines.filter((l) => /frame=/.test(l)).at(-1)?.trim());
