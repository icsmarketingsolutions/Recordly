// usage: node cdp.mjs <urlFilterRegex> <expression> [screenshotPath]
import fs from "node:fs";
const [, , filter, expression, shot] = process.argv;
const targets = (await (await fetch("http://127.0.0.1:9333/json")).json()).filter(
	(t) => t.type === "page" && new RegExp(filter).test(t.url),
);
if (!targets.length) throw new Error("no page matches " + filter);
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
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
if (expression) {
	const r = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	console.log(
		JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r, null, 1),
	);
}
if (shot) {
	const r = await send("Page.captureScreenshot", { format: "png" });
	fs.writeFileSync(shot, Buffer.from(r.result.data, "base64"));
	console.log("screenshot:", shot);
}
ws.close();
