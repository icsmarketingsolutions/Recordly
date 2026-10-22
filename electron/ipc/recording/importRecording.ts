import { composeSequenceWebcam, sequenceWebcamOutputs } from "./sequenceWebcam";
import { probeNativeVideoMetadata } from "../ffmpeg/metadata";
import { isLibrarySequenceSource } from "./sequenceSource";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildMediaUrl, getMediaServerBaseUrl } from "../../mediaServer";
import { getFfmpegBinaryPath } from "../ffmpeg/binary";
import { rememberApprovedLocalReadPath, resolveApprovedLocalMediaPath } from "../project/manager";
import { getRecordingsDir, getTelemetryPathForVideo } from "../utils";
import { getUsableCompanionAudioCandidates } from "./diagnostics";
import { normalizeCursorTelemetrySamples, writeCursorTelemetry } from "../cursor/telemetry";
import { listRecordings } from "./library";
import { isApprovedExternalImport } from "./clipSources";
import { getAvailableNativeVideoEncoders } from "../export/native-video";
import { getPreferredNativeVideoEncoders } from "../nativeVideoExport";
import type {
	RecordingImportResult,
	RecordingWebcamSource,
} from "../../../src/types/recordingLibrary";

const FFMPEG_TIMEOUT_MS = 60 * 60 * 1000;

export interface RecordingImportProgress {
	/** 0–100 across the whole import. */
	percent: number;
	phase: "base" | "clip" | "mix";
}

// Runs ffmpeg and, when asked, reports the output timestamp it has reached
// (`-progress pipe:1`) so the editor can show how far the import is.
async function ffmpeg(args: string[], signal?: AbortSignal, onTime?: (seconds: number) => void) {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			getFfmpegBinaryPath(),
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-nostdin",
				"-y",
				...(onTime ? ["-progress", "pipe:1", "-nostats"] : []),
				...args,
			],
			{ signal, windowsHide: true },
		);
		let stderr = "";
		let pending = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			if (!onTime) return;
			pending += chunk.toString();
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const match = /^out_time_(us|ms)=(\d+)/.exec(line);
				if (match) onTime(Number(match[2]) / 1_000_000);
			}
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-4000);
		});
		const timer = setTimeout(() => child.kill(), FFMPEG_TIMEOUT_MS);
		child.on("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
		});
	});
}

// Encoder-specific quality settings, visually on par with libx264 crf 18.
function importEncoderArgs(encoder: string): string[] {
	switch (encoder) {
		case "h264_nvenc":
			return ["-preset", "p4", "-rc", "vbr", "-cq", "19", "-b:v", "0", "-profile:v", "high"];
		case "h264_qsv":
			return ["-global_quality", "19", "-preset", "medium"];
		case "h264_amf":
			return ["-quality", "balanced", "-rc", "cqp", "-qp_i", "19", "-qp_p", "19"];
		case "h264_videotoolbox":
			return ["-q:v", "65"];
		case "h264_mf":
			return ["-rate_control", "quality", "-quality", "80"];
		default:
			return ["-preset", "fast", "-crf", "18"];
	}
}

// A GPU encoder (NVENC/QSV/AMF/VideoToolbox) turns a multi-minute re-encode into
// seconds. The export's tiny probe rejects NVENC (it refuses 64x64 frames), so the
// importer tries the real job with each available encoder in order and falls back
// to libx264 when one fails to open.
async function pickImportEncoders(): Promise<string[]> {
	let available = new Set<string>();
	try {
		available = await getAvailableNativeVideoEncoders(getFfmpegBinaryPath());
	} catch {
		// ffmpeg -encoders failed; only the software encoder is safe to assume.
	}
	const preferred = getPreferredNativeVideoEncoders(process.platform).filter((name) =>
		available.has(name),
	);
	return [...new Set([...preferred, "libx264"])];
}
async function probe(file: string, signal?: AbortSignal) {
	const meta = await probeNativeVideoMetadata(getFfmpegBinaryPath(), file, signal);
	return {
		width: meta.width,
		height: meta.height,
		fps: meta.frameRate,
		duration: meta.duration,
		audio: meta.hasAudio,
		codec: meta.codec,
		pixelFormat: meta.pixelFormat,
	};
}
type Format = { width: number; height: number; fps: number };
type Probe = Awaited<ReturnType<typeof probe>>;

/**
 * H.264 yuv420p footage already in the sequence format needs no re-encode: the
 * concat step copies it (with its SPS/PPS carried in-band), which turns a long
 * append into seconds and avoids a generation loss.
 */
export function canStreamCopyIntoSequence(meta: Probe, format: Format): boolean {
	return (
		/^h264\b/i.test(meta.codec ?? "") &&
		meta.pixelFormat === "yuv420p" &&
		meta.width === format.width &&
		meta.height === format.height &&
		Math.abs(meta.fps - format.fps) < 0.01
	);
}

/** Normalize new media once. Existing sequence video is copied, avoiding generation loss. */
async function normalize(
	file: string,
	out: string,
	format: Format,
	copyVideo: boolean,
	signal?: AbortSignal,
	encoders: string[] = ["libx264"],
	onTime?: (seconds: number) => void,
) {
	const meta = await probe(file, signal);
	const encoder = encoders[0] ?? "libx264";
	const candidates = await getUsableCompanionAudioCandidates(file);
	const companion = candidates[0];
	const system = companion?.usablePaths.includes(companion.systemPath)
		? companion.systemPath
		: null;
	const mic = companion?.usablePaths.includes(companion.micPath) ? companion.micPath : null;
	const args = ["-i", file];
	const filters: string[] = [];
	let input = 1;
	for (const [kind, source] of [
		["system", system],
		["mic", mic],
	] as const) {
		let label: string;
		let delay = 0;
		if (source) {
			args.push("-i", source);
			label = `${input++}:a:0`;
			try {
				delay = Math.max(
					0,
					Number(JSON.parse(await fs.readFile(`${source}.json`, "utf8")).startDelayMs) ||
						0,
				);
			} catch {
				/* Optional capture timing. */
			}
		} else if (kind === "system" && meta.audio) {
			label = "0:a:0";
		} else {
			args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
			label = `${input++}:a:0`;
		}
		filters.push(
			`[${label}]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=${Math.round(delay)}:all=1,apad,atrim=duration=${meta.duration}[${kind}]`,
		);
	}
	if (!copyVideo)
		filters.push(
			`[0:v:0]setpts=PTS-STARTPTS,scale=${format.width}:${format.height}:force_original_aspect_ratio=decrease,pad=${format.width}:${format.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${format.fps},format=yuv420p[v]`,
		);
	args.push(
		"-filter_complex",
		filters.join(";"),
		"-map",
		copyVideo ? "0:v:0" : "[v]",
		"-map",
		"[system]",
		"-map",
		"[mic]",
		"-c:v",
		copyVideo ? "copy" : encoder,
	);
	if (!copyVideo) args.push(...importEncoderArgs(encoder));
	args.push("-c:a", "pcm_s16le", "-t", String(meta.duration), out);
	try {
		await ffmpeg(args, signal, onTime);
	} catch (error) {
		if (copyVideo || encoders.length <= 1 || signal?.aborted) throw error;
		console.warn(`[import-recording] ${encoder} failed, trying ${encoders[1]}:`, error);
		await normalize(file, out, format, copyVideo, signal, encoders.slice(1), onTime);
	}
}

/** The editor and export share one immutable source, with stable offsets across imports. */
export async function importRecording(
	currentPath: string,
	recordingPath: string,
	currentWebcam?: RecordingWebcamSource,
	signal?: AbortSignal,
	onProgress?: (progress: RecordingImportProgress) => void,
): Promise<RecordingImportResult> {
	const entry = (await listRecordings()).find((entry) => entry.path === recordingPath);
	const sourcePath =
		entry?.path ?? (isApprovedExternalImport(recordingPath) ? recordingPath : null);
	if (!sourcePath) throw new Error("Recording is no longer in Videos");
	const current = await resolveApprovedLocalMediaPath(currentPath);
	if (!current) throw new Error("Current video is no longer available");
	const server = getMediaServerBaseUrl();
	if (!server) throw new Error("Media server is not ready");
	const root = path.join(await getRecordingsDir(), ".recordly-media");
	await fs.mkdir(root, { recursive: true });
	const base = await probe(current, signal);
	const format = {
		width: Math.ceil(base.width / 2) * 2,
		height: Math.ceil(base.height / 2) * 2,
		fps: base.fps,
	};
	const id = randomUUID();
	const work = await fs.mkdtemp(path.join(root, "import-"));
	const output = path.join(root, `${id}.mp4`);
	const stem = output.slice(0, -4);
	const outputs = recordingImportOutputs(output);
	try {
		const normalizedBase = path.join(work, "base.mkv");
		const normalizedNew = path.join(work, "new.mkv");
		const encoders = await pickImportEncoders();
		const added = await probe(sourcePath, signal);
		// Our own sequence output and any H.264 footage already in the sequence
		// format are copied; everything else is normalized through the encoder.
		const copyVideo = isLibrarySequenceSource(current) || canStreamCopyIntoSequence(base, format);
		const copyAdded = canStreamCopyIntoSequence(added, format);
		console.log(
			`[import-recording] encoder candidates: ${encoders.join(", ")}; copy base=${copyVideo} clip=${copyAdded}`,
		);
		// Progress is weighted by how much work each phase does: a stream copy of the
		// base is cheap, the mix pass runs over the whole combined length.
		const weights = {
			base: copyVideo ? base.duration * 0.15 : base.duration,
			clip: copyAdded ? added.duration * 0.15 : added.duration,
			mix: (base.duration + added.duration) * 0.25,
		};
		const total = weights.base + weights.clip + weights.mix || 1;
		const done = { base: 0, clip: 0 };
		const report = (phase: RecordingImportProgress["phase"], seconds: number) => {
			const reached =
				phase === "base"
					? Math.min(
							weights.base,
							(seconds / Math.max(base.duration, 0.001)) * weights.base,
						)
					: phase === "clip"
						? weights.base +
							Math.min(weights.clip, (seconds / Math.max(added.duration, 0.001)) * weights.clip)
						: weights.base +
							weights.clip +
							Math.min(
								weights.mix,
								(seconds / Math.max(base.duration + added.duration, 0.001)) *
									weights.mix,
							);
			if (phase === "base") done.base = reached;
			if (phase === "clip") done.clip = reached;
			onProgress?.({ percent: Math.max(0, Math.min(99, (reached / total) * 100)), phase });
		};
		report("base", 0);
		await normalize(current, normalizedBase, format, copyVideo, signal, encoders, (seconds) =>
			report("base", seconds),
		);
		report("clip", 0);
		await normalize(sourcePath, normalizedNew, format, copyAdded, signal, encoders, (seconds) =>
			report("clip", seconds),
		);
		report("mix", 0);
		const baseMeta = await probe(normalizedBase, signal);
		const newMeta = await probe(normalizedNew, signal);
		await fs.writeFile(path.join(work, "list.txt"), "file 'base.mkv'\nfile 'new.mkv'\n");
		const combined = path.join(work, "combined.mkv");
		await ffmpeg(
			[
				"-f",
				"concat",
				"-safe",
				"1",
				"-i",
				path.join(work, "list.txt"),
				"-map",
				"0",
				"-c",
				"copy",
				// Pieces may come from different encoders: carry each one's SPS/PPS
				// in-band so every keyframe decodes with its own parameters.
				"-bsf:v",
				"dump_extra=freq=keyframe",
				combined,
			],
			signal,
		);
		await ffmpeg(
			[
				"-i",
				combined,
				"-filter_complex",
				"[0:a:0][0:a:1]amix=inputs=2:normalize=0[mix]",
				"-map",
				"0:v:0",
				"-map",
				"[mix]",
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				"-movflags",
				"+faststart",
				output,
				"-map",
				"0:a:0",
				"-c:a",
				"pcm_s16le",
				`${stem}.system.wav`,
				"-map",
				"0:a:1",
				"-c:a",
				"pcm_s16le",
				`${stem}.mic.wav`,
			],
			signal,
			(seconds) => report("mix", seconds),
		);
		const sourceStartMs = Math.round(baseMeta.duration * 1000);
		const samples = [];
		for (const [file, offset, meta] of [
			[current, 0, base],
			[sourcePath, sourceStartMs, await probe(sourcePath, signal)],
		] as const) {
			let points: ReturnType<typeof normalizeCursorTelemetrySamples> = [];
			try {
				points = normalizeCursorTelemetrySamples(
					JSON.parse(await fs.readFile(getTelemetryPathForVideo(file), "utf8")),
				);
			} catch {
				/* Recording may not contain cursor telemetry. */
			}
			const scale = Math.min(format.width / meta.width, format.height / meta.height);
			samples.push(
				...points.map((point) => ({
					...point,
					timeMs: point.timeMs + offset,
					cx:
						(point.cx * meta.width * scale + (format.width - meta.width * scale) / 2) /
						format.width,
					cy:
						(point.cy * meta.height * scale +
							(format.height - meta.height * scale) / 2) /
						format.height,
				})),
			);
		}
		await writeCursorTelemetry(output, samples);
		const webcam = await composeSequenceWebcam(
			current,
			sourcePath,
			output,
			work,
			sourceStartMs,
			Math.round(newMeta.duration * 1000),
			currentWebcam,
			signal,
		);
		signal?.throwIfAborted();
		await rememberApprovedLocalReadPath(output);
		return {
			path: output,
			webcam,
			url: buildMediaUrl(server, output),
			sourceStartMs,
			durationMs: Math.round(newMeta.duration * 1000),
			totalDurationMs: sourceStartMs + Math.round(newMeta.duration * 1000),
		};
	} catch (error) {
		await Promise.all(outputs.map((file) => fs.rm(file, { force: true })));
		throw error;
	} finally {
		await fs.rm(work, { recursive: true, force: true });
	}
}

function recordingImportOutputs(output: string) {
	const stem = output.slice(0, -4);
	return [
		...sequenceWebcamOutputs(output),
		output,
		`${stem}.system.wav`,
		`${stem}.mic.wav`,
		`${output}.cursor.json`,
	];
}
export async function discardRecordingImport(output: string) {
	await Promise.all(recordingImportOutputs(output).map((file) => fs.rm(file, { force: true })));
}
