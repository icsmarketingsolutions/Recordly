// In an open editor: checks the "Remove pauses" toolbar button, runs the silence
// analysis through the real IPC on a file with speech, and verifies the popover
// refuses to empty a fully silent timeline.
// usage: node e2e-remove-silences.mjs "<path to a recording with speech>"
//        (app already running with --remote-debugging-port=9333 and an editor open)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speechFile = process.argv[2];
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

const editorTarget = (await listPages()).find((t) => /windowType=editor/.test(t.url));
if (!editorTarget) throw new Error("no editor window open");
const editor = await connect(editorTarget);

// 1. IPC on a real file with speech.
let ipc = null;
if (speechFile) {
	ipc = await editor.evaluate(
		`window.electronAPI.detectRecordingSilences(${JSON.stringify({ videoPath: speechFile, noiseDb: -30, minSilenceS: 0.3 })})`,
	);
	console.log(
		"ipc:",
		ipc.success,
		ipc.audioSourceLabel,
		"silences:",
		ipc.silences?.length,
		"first:",
		JSON.stringify(ipc.silences?.slice(0, 3)),
	);
}

// 2. Toolbar button + popover on the current (silent) timeline.
const clipsBefore = await editor.evaluate(
	`document.querySelectorAll('[data-timeline-item][data-variant="clip"]').length`,
);
const opened = await editor.evaluate(
	`(() => { const b = document.querySelector('button[aria-label="Remove pauses"]'); if (!b) return false; b.click(); return true; })()`,
);
console.log("button clicked:", opened);
let status = "";
for (let i = 0; i < 60; i++) {
	await sleep(500);
	status = await editor.evaluate(
		`(() => { const p = document.querySelector('[data-testid="remove-silences-popover"]'); return p ? p.innerText : ""; })()`,
	);
	if (status && !/Analyzing/.test(status)) break;
}
console.log("popover text:", JSON.stringify(status).slice(0, 300));
const applyDisabled = await editor.evaluate(
	`(() => { const b = document.querySelector('[data-testid="remove-silences-apply"]'); return b ? b.disabled || b.getAttribute('aria-disabled') === 'true' || b.hasAttribute('data-disabled') : null; })()`,
);
console.log("apply disabled:", applyDisabled, "| clips:", clipsBefore);
console.log(
	"RESULT",
	JSON.stringify({
		ipcOk: ipc ? ipc.success && ipc.silences.length > 0 : null,
		popover: Boolean(status),
		applyDisabled,
	}),
);
editor.close();
