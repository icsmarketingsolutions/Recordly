// Starts a recording (screen + webcam + microphone) and leaves it running, so the caller
// can kill Recordly hard to simulate a power cut, relaunch it and check the recovery.
// Launch first: Recordly.exe --remote-debugging-port=9333 --user-data-dir=<test profile>
// usage: node scripts/e2e/e2e-crash-recording.mjs [seconds] [camera name regex]
const [, , seconds = "15", cameraPattern = "."] = process.argv;
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
const byLabel = (label) =>
	`[...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || x.title) === ${JSON.stringify(label)})`;
const click = (selectorJs) =>
	`(() => { const b = ${selectorJs}; if (!b) return false; for (const t of ["pointerdown", "pointerup"]) b.dispatchEvent(new PointerEvent(t, { bubbles: true })); b.click(); return true; })()`;
const pickMenuItem = (pattern) =>
	click(
		`[...document.querySelectorAll("button")].find((x) => new RegExp(${JSON.stringify(pattern)}, "i").test(x.textContent))`,
	);

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
if (await hud.evaluate(click(byLabel("Enable webcam overlay")))) {
	await sleep(1200);
	await hud.evaluate(pickMenuItem(cameraPattern));
	await sleep(2500);
}
if (await hud.evaluate(click(byLabel("Enable microphone")))) {
	await sleep(1200);
	await hud.evaluate(pickMenuItem("micr|headset|audio|realtek"));
	await sleep(1500);
}
console.log("webcam on:", await hud.evaluate(`!!${byLabel("Disable webcam overlay")}`));
console.log("microphone on:", await hud.evaluate(`!!${byLabel("Disable microphone")}`));
await hud.evaluate(click(byLabel("Record")));
let recording = false;
for (let i = 0; i < 30 && !recording; i++) {
	await sleep(1000);
	recording = await hud.evaluate(
		`!!document.querySelector('[role="group"][aria-label="Recording controls"]')`,
	);
}
console.log("recording:", recording, new Date().toISOString());
await sleep(Number(seconds) * 1000);
console.log("still recording, ready to kill:", new Date().toISOString());
hud.close();
