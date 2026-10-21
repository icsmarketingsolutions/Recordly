// Copies the MediaPipe vision runtime and downloads the two models used by the
// camera effects into public/camera-fx (git-ignored). Models are pinned by
// SHA-256 so a changed upstream file fails loudly instead of shipping silently.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "public", "camera-fx");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");

const MODELS = [
	{
		file: "face_landmarker.task",
		url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
		sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
	},
	{
		file: "selfie_multiclass_256x256.tflite",
		url: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
		sha256: "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
	},
];
const WASM_FILES = ["vision_wasm_internal.js", "vision_wasm_internal.wasm"];

function sha256(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

fs.mkdirSync(path.join(target, "wasm"), { recursive: true });
fs.mkdirSync(path.join(target, "models"), { recursive: true });

for (const file of WASM_FILES) {
	fs.copyFileSync(path.join(wasmSource, file), path.join(target, "wasm", file));
}

for (const model of MODELS) {
	const destination = path.join(target, "models", model.file);
	if (fs.existsSync(destination) && sha256(fs.readFileSync(destination)) === model.sha256) {
		continue;
	}
	const response = await fetch(model.url);
	if (!response.ok) throw new Error(`Download failed (${response.status}): ${model.url}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	const digest = sha256(buffer);
	if (digest !== model.sha256) {
		throw new Error(`Checksum mismatch for ${model.file}: ${digest}`);
	}
	fs.writeFileSync(destination, buffer);
	console.log(`[camera-fx] downloaded ${model.file}`);
}

console.log(`[camera-fx] assets ready in ${path.relative(root, target)}`);
