// Bundles electron/cli/claudeEdit.ts with esbuild and runs it with the given arguments.
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(os.tmpdir(), "recordly-claude-edit.mjs");

await build({
	entryPoints: [path.join(root, "electron", "cli", "claudeEdit.ts")],
	outfile,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	alias: { "@": path.join(root, "src") },
	logLevel: "error",
});

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
	cwd: root,
	stdio: "inherit",
});
process.exit(result.status ?? 1);
