import { spawn } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { persistRecordingSessionManifest } from "../project/session";
import { getRecordingsDir, moveFileWithOverwrite } from "../utils";

// A recording must survive a power cut or a crash. Three things make that possible:
// - the browser recorders (webcam, fallback microphone) append every chunk to
//   `<recordings>/<final name>.part` while recording;
// - the native Windows capture is listed in `.recordly-inflight-<timestamp>.json`
//   until it is stopped, and wgc-capture saves the H.264 sequence header next to its
//   temp MP4 (`.h264hdr`), because the MP4 sink only writes its index on finalize;
// - on the next launch `recoverInterruptedRecordings` turns whatever was left into
//   normal recordings in the library.

const PART_SUFFIX = ".part";
const PART_FILE_NAME = /^recording-[0-9]+(?:-webcam\.(?:webm|mp4)|\.(?:webm|mp4)|\.mic\.webm)$/;
const PART_SYNC_INTERVAL_MS = 2000;
const INFLIGHT_PREFIX = ".recordly-inflight-";
const NATIVE_TEMP_VIDEO = /^recordly-native-([0-9]+)\.mp4$/;
const SEQUENCE_HEADER_SUFFIX = ".h264hdr";
// Files touched this recently may still belong to a running capture.
const ACTIVE_WRITE_GRACE_MS = 60_000;
const SESSION_MATCH_WINDOW_MS = 120_000;

// ---------------------------------------------------------------------------
// Chunk files written while recording

const partChains = new Map<string, Promise<void>>();
const partHandles = new Map<string, { handle: FileHandle; lastSyncAt: number }>();

async function resolvePartPath(fileName: unknown) {
	if (typeof fileName !== "string" || !PART_FILE_NAME.test(fileName)) {
		throw new Error("Invalid recording part name");
	}
	return path.join(await getRecordingsDir(), `${fileName}${PART_SUFFIX}`);
}

function enqueuePartOperation(partPath: string, operation: () => Promise<void>) {
	const next = (partChains.get(partPath) ?? Promise.resolve()).then(operation);
	partChains.set(
		partPath,
		next.catch(() => undefined),
	);
	return next;
}

export async function appendRecordingPart(fileName: unknown, data: ArrayBuffer) {
	const partPath = await resolvePartPath(fileName);
	await enqueuePartOperation(partPath, async () => {
		let entry = partHandles.get(partPath);
		if (!entry) {
			entry = { handle: await fs.open(partPath, "a"), lastSyncAt: Date.now() };
			partHandles.set(partPath, entry);
		}
		await entry.handle.write(Buffer.from(data));
		if (Date.now() - entry.lastSyncAt >= PART_SYNC_INTERVAL_MS) {
			await entry.handle.datasync();
			entry.lastSyncAt = Date.now();
		}
	});
}

async function closePart(partPath: string, remove: boolean) {
	await enqueuePartOperation(partPath, async () => {
		const entry = partHandles.get(partPath);
		partHandles.delete(partPath);
		await entry?.handle.close().catch(() => undefined);
		if (remove) {
			await fs.rm(partPath, { force: true });
		}
	});
	partChains.delete(partPath);
}

export async function discardRecordingPart(fileName: unknown) {
	await closePart(await resolvePartPath(fileName), true);
}

/** The final file is on disk, so its crash copy is no longer needed. */
export async function discardRecordingPartFor(finalPath: string) {
	if (PART_FILE_NAME.test(path.basename(finalPath))) {
		await closePart(`${finalPath}${PART_SUFFIX}`, true);
	}
}

// ---------------------------------------------------------------------------
// Native Windows capture in progress

export interface InflightNativeRecording {
	version: 1;
	startedAt: number;
	tempVideoPath: string;
	videoPath: string;
	tempMicPath: string | null;
	micPath: string | null;
	tempSystemAudioPath: string | null;
	systemAudioPath: string | null;
}

async function getInflightManifestPath(startedAt: number) {
	return path.join(await getRecordingsDir(), `${INFLIGHT_PREFIX}${startedAt}.json`);
}

export async function markNativeRecordingInFlight(
	recording: Omit<InflightNativeRecording, "version">,
) {
	const manifest: InflightNativeRecording = { version: 1, ...recording };
	await fs.writeFile(
		await getInflightManifestPath(recording.startedAt),
		JSON.stringify(manifest, null, 2),
		"utf-8",
	);
}

function getNativeTimestamp(tempVideoPath: string) {
	const match = NATIVE_TEMP_VIDEO.exec(path.basename(tempVideoPath));
	return match ? Number(match[1]) : null;
}

/** The capture stopped normally: forget it and drop its crash-only sidecar. */
export async function clearNativeRecordingInFlight(tempVideoPath: string) {
	await fs
		.rm(`${tempVideoPath}${SEQUENCE_HEADER_SUFFIX}`, { force: true })
		.catch(() => undefined);
	const startedAt = getNativeTimestamp(tempVideoPath);
	if (startedAt !== null) {
		await fs
			.rm(await getInflightManifestPath(startedAt), { force: true })
			.catch(() => undefined);
	}
}

// ---------------------------------------------------------------------------
// Recovery on launch

async function pathExists(filePath: string | null | undefined) {
	if (!filePath) return false;
	return fs.access(filePath).then(
		() => true,
		() => false,
	);
}

async function isStillBeingWritten(filePath: string) {
	const stat = await fs.stat(filePath);
	return Date.now() - stat.mtimeMs < ACTIVE_WRITE_GRACE_MS;
}

async function readTopLevelBoxTypes(filePath: string, limit = 16) {
	const handle = await fs.open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const header = Buffer.alloc(16);
		const types: string[] = [];
		let offset = 0;
		while (offset + 8 <= size && types.length < limit) {
			await handle.read(header, 0, 16, offset);
			let boxSize = header.readUInt32BE(0);
			types.push(header.toString("latin1", 4, 8));
			if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
			if (boxSize === 0) break;
			if (boxSize < 8) return types;
			offset += boxSize;
		}
		return types;
	} finally {
		await handle.close();
	}
}

/** Offset of the first length-prefixed NAL unit in a moov-less MP4 written by Media Foundation. */
async function findBareMdatPayload(filePath: string) {
	const handle = await fs.open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const header = Buffer.alloc(16);
		let offset = 0;
		while (offset + 8 <= size) {
			await handle.read(header, 0, 16, offset);
			const boxSize = header.readUInt32BE(0);
			const type = header.toString("latin1", 4, 8);
			if (type === "mdat") {
				// Media Foundation reserves a 64-bit size it only fills on finalize, so the
				// first NAL starts 8 or 16 bytes in: look for the access unit delimiter.
				const probe = Buffer.alloc(5);
				for (
					let start = offset + 8;
					start <= offset + 24 && start + 5 <= size;
					start += 1
				) {
					await handle.read(probe, 0, 5, start);
					if (probe.readUInt32BE(0) === 2 && (probe[4] & 0x1f) === 9) return start;
				}
				return null;
			}
			if (boxSize < 8) return null;
			offset += boxSize;
		}
		return null;
	} finally {
		await handle.close();
	}
}

/** Walks the NAL units; returns how many access units are complete and where the data ends. */
async function scanNalUnits(filePath: string, payloadOffset: number) {
	const handle = await fs.open(filePath, "r");
	try {
		const { size } = await handle.stat();
		const header = Buffer.alloc(5);
		let offset = payloadOffset;
		let frames = 0;
		while (offset + 5 <= size) {
			await handle.read(header, 0, 5, offset);
			const length = header.readUInt32BE(0);
			if (length === 0 || offset + 4 + length > size) break;
			// NAL type 9 (access unit delimiter) starts every frame Media Foundation writes.
			if ((header[4] & 0x1f) === 9) frames += 1;
			offset += 4 + length;
		}
		return { frames, endOffset: offset };
	} finally {
		await handle.close();
	}
}

function keepParameterSets(annexB: Buffer) {
	const startCode = Buffer.from([0, 0, 0, 1]);
	const units: Buffer[] = [];
	let cursor = 0;
	while (cursor < annexB.length) {
		const start = annexB.indexOf(startCode, cursor);
		if (start < 0) break;
		const next = annexB.indexOf(startCode, start + 4);
		const unit = annexB.subarray(start + 4, next < 0 ? annexB.length : next);
		const type = unit[0] & 0x1f;
		if (type === 7 || type === 8) units.push(startCode, unit);
		cursor = next < 0 ? annexB.length : next;
	}
	return Buffer.concat(units);
}

function runFfmpeg(args: string[], input?: (stdin: NodeJS.WritableStream) => Promise<void>) {
	return new Promise<{ code: number | null; stderr: string; stdout: Buffer }>(
		(resolve, reject) => {
			const child = spawn(getFfmpegBinaryPath(), ["-hide_banner", "-nostats", ...args], {
				stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			const stdout: Buffer[] = [];
			let stderr = "";
			child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr = (stderr + chunk.toString()).slice(-20_000);
			});
			child.on("error", reject);
			child.on("close", (code) => resolve({ code, stderr, stdout: Buffer.concat(stdout) }));
			if (input && child.stdin) {
				child.stdin.on("error", () => undefined);
				input(child.stdin).then(
					() => child.stdin?.end(),
					(error) => {
						child.kill();
						reject(error);
					},
				);
			}
		},
	);
}

async function writeChunk(stdin: NodeJS.WritableStream, chunk: Buffer) {
	if (!stdin.write(chunk)) {
		await new Promise<void>((resolve) => stdin.once("drain", resolve));
	}
}

/** Streams the length-prefixed NAL units as Annex B: each 4-byte length becomes a start code. */
async function streamAsAnnexB(
	stdin: NodeJS.WritableStream,
	filePath: string,
	parameterSets: Buffer,
	payloadOffset: number,
	endOffset: number,
	maxFrames = Number.POSITIVE_INFINITY,
) {
	await writeChunk(stdin, parameterSets);
	const handle = await fs.open(filePath, "r");
	try {
		const lengthBuffer = Buffer.alloc(4);
		const startCode = Buffer.from([0, 0, 0, 1]);
		let offset = payloadOffset;
		let frames = 0;
		while (offset + 4 <= endOffset) {
			await handle.read(lengthBuffer, 0, 4, offset);
			const length = lengthBuffer.readUInt32BE(0);
			const unit = Buffer.alloc(length);
			await handle.read(unit, 0, length, offset + 4);
			if ((unit[0] & 0x1f) === 9) {
				frames += 1;
				if (frames > maxFrames) break;
			}
			await writeChunk(stdin, startCode);
			await writeChunk(stdin, unit);
			offset += 4 + length;
		}
	} finally {
		await handle.close();
	}
}

async function extractParameterSets(videoPath: string) {
	const result = await runFfmpeg([
		"-v",
		"error",
		"-i",
		videoPath,
		"-map",
		"0:v:0",
		"-c",
		"copy",
		"-bsf:v",
		"h264_mp4toannexb",
		"-frames:v",
		"1",
		"-f",
		"h264",
		"pipe:1",
	]);
	return result.code === 0 ? keepParameterSets(result.stdout) : Buffer.alloc(0);
}

/** Decodes the first second with these SPS/PPS: a wrong guess fails on almost every frame. */
async function parameterSetsDecode(
	filePath: string,
	parameterSets: Buffer,
	payloadOffset: number,
	endOffset: number,
) {
	const result = await runFfmpeg(
		["-v", "error", "-f", "h264", "-i", "pipe:0", "-f", "null", "-"],
		(stdin) => streamAsAnnexB(stdin, filePath, parameterSets, payloadOffset, endOffset, 60),
	);
	const errorLines = result.stderr.split("\n").filter((line) => line.trim()).length;
	return result.code === 0 && errorLines <= 2;
}

/**
 * Captures from before the `.h264hdr` sidecar existed: borrow the SPS/PPS of an
 * earlier recording made with the same encoder and keep the one that decodes.
 */
async function findParameterSetsFromLibrary(
	filePath: string,
	payloadOffset: number,
	endOffset: number,
) {
	const recordingsDir = await getRecordingsDir();
	const entries = await fs.readdir(recordingsDir);
	const candidates = await Promise.all(
		entries
			.filter((name) => /^recording-[0-9]+\.mp4$/.test(name))
			.map(async (name) => {
				const candidatePath = path.join(recordingsDir, name);
				return { path: candidatePath, mtimeMs: (await fs.stat(candidatePath)).mtimeMs };
			}),
	);
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

	const tried = new Set<string>();
	for (const candidate of candidates.slice(0, 12)) {
		const parameterSets = await extractParameterSets(candidate.path).catch(() =>
			Buffer.alloc(0),
		);
		const key = parameterSets.toString("hex");
		if (!parameterSets.length || tried.has(key)) continue;
		tried.add(key);
		if (await parameterSetsDecode(filePath, parameterSets, payloadOffset, endOffset)) {
			return parameterSets;
		}
	}
	return null;
}

async function uniqueRecordingPath(preferredPath: string) {
	if (!(await pathExists(preferredPath))) return preferredPath;
	return path.join(path.dirname(preferredPath), `recording-${Date.now()}.mp4`);
}

/** Rebuilds a playable MP4 from the bare mdat a crashed Media Foundation capture leaves. */
async function rebuildNativeVideo(
	tempVideoPath: string,
	outputPath: string,
	startedAt: number,
	referenceDurationSeconds: number | null,
) {
	const payloadOffset = await findBareMdatPayload(tempVideoPath);
	if (payloadOffset === null) return false;

	const { frames, endOffset } = await scanNalUnits(tempVideoPath, payloadOffset);
	if (frames === 0) return false;

	const sidecarPath = `${tempVideoPath}${SEQUENCE_HEADER_SUFFIX}`;
	let parameterSets = (await pathExists(sidecarPath))
		? keepParameterSets(await fs.readFile(sidecarPath))
		: null;
	if (!parameterSets?.length) {
		parameterSets = await findParameterSetsFromLibrary(tempVideoPath, payloadOffset, endOffset);
	}
	if (!parameterSets?.length) return false;

	// The frame timestamps lived in the missing index, so the frames are spread evenly over
	// the capture's length. The microphone WAV, which starts with the video, measures it to
	// the sample; without one, use the first frame (the sidecar is written right after it)
	// to the last write, which can run a few seconds long.
	const { mtimeMs } = await fs.stat(tempVideoPath);
	const firstFrameAt = (await pathExists(sidecarPath))
		? (await fs.stat(sidecarPath)).mtimeMs
		: startedAt;
	const fileDurationSeconds = (mtimeMs - firstFrameAt) / 1000;
	const referenceFps = referenceDurationSeconds ? frames / referenceDurationSeconds : 0;
	const durationSeconds =
		referenceDurationSeconds && referenceFps >= 20 && referenceFps <= 75
			? referenceDurationSeconds
			: fileDurationSeconds;
	const measuredFps = durationSeconds > 1 ? frames / durationSeconds : 60;
	const fps =
		Number.isFinite(measuredFps) && measuredFps >= 1 && measuredFps <= 240 ? measuredFps : 60;

	const partialOutput = `${outputPath}.recovering`;
	const result = await runFfmpeg(
		[
			"-v",
			"error",
			"-y",
			"-f",
			"h264",
			"-r",
			fps.toFixed(4),
			"-i",
			"pipe:0",
			"-c",
			"copy",
			// The SPS/PPS go only in the avcC, like Media Foundation writes them: WebCodecs
			// rejects a key frame whose sample starts with them ahead of the delimiter.
			"-bsf:v",
			"filter_units=remove_types=7|8",
			"-f",
			"mp4",
			partialOutput,
		],
		(stdin) => streamAsAnnexB(stdin, tempVideoPath, parameterSets, payloadOffset, endOffset),
	);
	if (result.code !== 0) {
		await fs.rm(partialOutput, { force: true });
		throw new Error(`FFmpeg could not rebuild ${tempVideoPath}: ${result.stderr.trim()}`);
	}
	await fs.rename(partialOutput, outputPath);
	return true;
}

/** Length of the PCM actually written, whatever the (possibly unfinished) header says. */
async function readWavDurationSeconds(wavPath: string | null) {
	if (!wavPath || !(await pathExists(wavPath))) return null;
	const handle = await fs.open(wavPath, "r");
	try {
		const { size } = await handle.stat();
		const header = Buffer.alloc(44);
		await handle.read(header, 0, 44, 0);
		if (header.toString("latin1", 0, 4) !== "RIFF") return null;
		const byteRate = header.readUInt32LE(28);
		return byteRate > 0 && size > 44 ? (size - 44) / byteRate : null;
	} finally {
		await handle.close();
	}
}

/** A WAV whose header still says 0 bytes: point its sizes at what was actually written. */
async function repairWavHeader(wavPath: string) {
	const handle = await fs.open(wavPath, "r+");
	try {
		const { size } = await handle.stat();
		if (size <= 44) return false;
		const header = Buffer.alloc(44);
		await handle.read(header, 0, 44, 0);
		if (
			header.toString("latin1", 0, 4) !== "RIFF" ||
			header.toString("latin1", 36, 40) !== "data"
		) {
			return false;
		}
		const dataBytes = Math.min(size - 44, 0xffffffff - 36);
		const sizes = Buffer.alloc(4);
		sizes.writeUInt32LE(dataBytes + 36);
		await handle.write(sizes, 0, 4, 4);
		sizes.writeUInt32LE(dataBytes);
		await handle.write(sizes, 0, 4, 40);
		return true;
	} finally {
		await handle.close();
	}
}

async function recoverWav(tempPath: string | null, finalPath: string | null) {
	if (!tempPath || !finalPath || !(await pathExists(tempPath)) || (await pathExists(finalPath))) {
		return;
	}
	await repairWavHeader(tempPath);
	await moveFileWithOverwrite(tempPath, finalPath);
	if (await pathExists(`${tempPath}.json`)) {
		await moveFileWithOverwrite(`${tempPath}.json`, `${finalPath}.json`);
	}
}

async function recoverNativeCapture(recording: InflightNativeRecording) {
	const { tempVideoPath } = recording;
	if (!(await pathExists(tempVideoPath)) || (await isStillBeingWritten(tempVideoPath))) {
		return null;
	}

	const videoPath = await uniqueRecordingPath(recording.videoPath);
	const boxes = await readTopLevelBoxTypes(tempVideoPath);
	if (boxes.includes("moov")) {
		// Finished, but Recordly closed before moving it into the library.
		await moveFileWithOverwrite(tempVideoPath, videoPath);
	} else if (
		!(await rebuildNativeVideo(
			tempVideoPath,
			videoPath,
			recording.startedAt,
			await readWavDurationSeconds(recording.tempMicPath),
		))
	) {
		return null;
	}

	const stem = videoPath.slice(0, -path.extname(videoPath).length);
	await recoverWav(recording.tempMicPath, recording.micPath ? `${stem}.mic.wav` : null);
	await recoverWav(
		recording.tempSystemAudioPath,
		recording.systemAudioPath ? `${stem}.system.wav` : null,
	);
	await fs.rm(tempVideoPath, { force: true });
	await fs.rm(`${tempVideoPath}${SEQUENCE_HEADER_SUFFIX}`, { force: true });
	return videoPath;
}

function recordingTimestamp(fileName: string) {
	const match = /^recording-([0-9]+)/.exec(fileName);
	return match ? Number(match[1]) : null;
}

async function findNearestRecording(recordingsDir: string, timestamp: number) {
	const entries = await fs.readdir(recordingsDir);
	let best: { name: string; distance: number } | null = null;
	for (const name of entries) {
		if (!/^recording-[0-9]+\.mp4$/.test(name)) continue;
		const distance = Math.abs((recordingTimestamp(name) ?? 0) - timestamp);
		if (distance <= SESSION_MATCH_WINDOW_MS && (!best || distance < best.distance)) {
			best = { name, distance };
		}
	}
	return best ? path.join(recordingsDir, best.name) : null;
}

async function recoverPart(recordingsDir: string, partName: string) {
	const partPath = path.join(recordingsDir, partName);
	const finalName = partName.slice(0, -PART_SUFFIX.length);
	const finalPath = path.join(recordingsDir, finalName);
	if (await isStillBeingWritten(partPath)) return null;
	if (await pathExists(finalPath)) {
		await fs.rm(partPath, { force: true });
		return null;
	}

	const timestamp = recordingTimestamp(finalName) ?? 0;
	if (finalName.endsWith(".mic.webm")) {
		const videoPath = await findNearestRecording(recordingsDir, timestamp);
		const micPath = videoPath ? `${videoPath.slice(0, -4)}.mic.wav` : null;
		if (micPath && !(await pathExists(micPath))) {
			const result = await runFfmpeg([
				"-v",
				"error",
				"-y",
				"-i",
				partPath,
				"-vn",
				"-ac",
				"1",
				"-ar",
				"48000",
				"-c:a",
				"pcm_s16le",
				micPath,
			]);
			if (result.code === 0) {
				await fs.rm(partPath, { force: true });
				return micPath;
			}
		}
		await fs.rename(partPath, finalPath);
		return finalPath;
	}

	await fs.rename(partPath, finalPath);
	if (finalName.includes("-webcam.")) {
		const videoPath = await findNearestRecording(recordingsDir, timestamp);
		if (videoPath) {
			await persistRecordingSessionManifest({
				videoPath,
				webcamPath: finalPath,
				timeOffsetMs: 0,
			});
		}
		return finalPath;
	}
	return finalPath;
}

/** Turns recordings cut short by a crash or power cut into normal library recordings. */
export async function recoverInterruptedRecordings(): Promise<string[]> {
	const recordingsDir = await getRecordingsDir();
	const tempDir = app.getPath("temp");
	const recordings = new Map<
		number,
		{ recording: InflightNativeRecording; manifestPath: string | null }
	>();

	for (const name of await fs.readdir(recordingsDir)) {
		if (!name.startsWith(INFLIGHT_PREFIX) || !name.endsWith(".json")) continue;
		const manifestPath = path.join(recordingsDir, name);
		try {
			const recording = JSON.parse(
				await fs.readFile(manifestPath, "utf-8"),
			) as InflightNativeRecording;
			if (recording.version === 1 && typeof recording.tempVideoPath === "string") {
				recordings.set(recording.startedAt, { recording, manifestPath });
			}
		} catch {
			// unreadable manifest: the temp scan below still finds its capture
		}
	}

	// Captures from versions that did not write a manifest yet.
	for (const name of await fs.readdir(tempDir).catch(() => [] as string[])) {
		const match = NATIVE_TEMP_VIDEO.exec(name);
		if (!match) continue;
		const startedAt = Number(match[1]);
		if (recordings.has(startedAt)) continue;
		const tempBase = path.join(tempDir, `recordly-native-${startedAt}`);
		const finalBase = path.join(recordingsDir, `recording-${startedAt}`);
		recordings.set(startedAt, {
			manifestPath: null,
			recording: {
				version: 1,
				startedAt,
				tempVideoPath: `${tempBase}.mp4`,
				videoPath: `${finalBase}.mp4`,
				tempMicPath: `${tempBase}.mic.wav`,
				micPath: `${finalBase}.mic.wav`,
				tempSystemAudioPath: `${tempBase}.system.wav`,
				systemAudioPath: `${finalBase}.system.wav`,
			},
		});
	}

	const recovered: string[] = [];
	for (const { recording, manifestPath } of recordings.values()) {
		try {
			const videoPath = await recoverNativeCapture(recording);
			if (videoPath) recovered.push(videoPath);
			// Keep the manifest while the capture is still on disk, so a later launch retries.
			if (manifestPath && !(await pathExists(recording.tempVideoPath))) {
				await fs.rm(manifestPath, { force: true });
			}
		} catch (error) {
			console.error(`[recovery] Could not recover ${recording.tempVideoPath}:`, error);
		}
	}

	for (const name of await fs.readdir(recordingsDir)) {
		if (
			!name.endsWith(PART_SUFFIX) ||
			!PART_FILE_NAME.test(name.slice(0, -PART_SUFFIX.length))
		) {
			continue;
		}
		try {
			const recoveredPath = await recoverPart(recordingsDir, name);
			if (
				recoveredPath &&
				/^recording-[0-9]+\.(?:mp4|webm)$/.test(path.basename(recoveredPath))
			) {
				recovered.push(recoveredPath);
			}
		} catch (error) {
			console.error(`[recovery] Could not recover ${name}:`, error);
		}
	}

	return recovered;
}
