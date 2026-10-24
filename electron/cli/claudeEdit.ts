/**
 * Edit a Recordly project from the command line, so Claude can read what was said
 * and cut mistakes without opening the editor. Everything works in *source* time
 * (milliseconds into the recording), which never moves while clips are cut.
 *
 * Run through `npm run claude-edit -- <command> <project.recordly> [options]`.
 * See CLAUDE-EDIT.md for the commands and the editing rules.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
	packClipSequence,
	rippleRegionAnchors,
	rippleRegions,
} from "../../src/components/video-editor/clipSequence";
import {
	DEFAULT_FILLER_WORDS,
	findFillerWordSpans,
	planSilenceRemoval,
	type SourceSilence,
} from "../../src/components/video-editor/silenceRemoval";
import {
	type CaptionCue,
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "../../src/components/video-editor/types";
import { readWhisperCaptionOutput } from "../ipc/captions/output";
import { segmentCuesIntoPhrases } from "../ipc/captions/segment";
import { parseSilenceIntervals, type SilenceInterval } from "../ipc/captions/silence";

const execFileAsync = promisify(execFile);
const EXEC_OPTIONS = { timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 };

const USER_DATA = path.join(
	process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
	"Recordly",
);
const WORK_ROOT = path.join(USER_DATA, "claude-edit");
const RECENT_PROJECTS = path.join(USER_DATA, "recent-projects.json");

/** Pauses are found on the speech track at this level and length, like "Remove pauses". */
const NOISE_DB = -30;
const DETECT_MIN_S = 0.3;
/** How far a word cut edge may move to land on the quietest moment between words. */
const WORD_CUT_REACH_MS = 200;
/** Loudness is measured in steps of this length (160 samples at 16 kHz). */
const ENVELOPE_STEP_MS = 10;

type Project = {
	version: number;
	projectId?: string;
	videoPath: string;
	editor: Record<string, unknown> & {
		clipRegions?: ClipRegion[];
		zoomRegions?: Array<{ startMs: number; endMs: number }>;
		annotationRegions?: Array<{ startMs: number; endMs: number }>;
		audioRegions?: Array<{ startMs: number; endMs: number }>;
		autoCaptions?: CaptionCue[];
		autoFullTrackClipId?: string | null;
	};
};

type Word = { i: number; text: string; startMs: number; endMs: number };
type Phrase = { startMs: number; endMs: number; words: Word[] };

type Transcript = {
	videoPath: string;
	audioSource: string;
	sourceDurationMs: number;
	cues: CaptionCue[];
	silences: SilenceInterval[];
	/** Loudness of the speech track in dB, one value per `ENVELOPE_STEP_MS`. */
	envelopeDb?: number[];
	/** The 16 kHz speech track the timings refer to, shared by edited copies. */
	speechWav?: string;
};

type CutSpec = {
	words?: string;
	from?: string | number;
	to?: string | number;
	reason?: string;
	/** The words the range must hold; the plan is refused when they differ. */
	expect?: string;
};

type EditPlan = {
	cuts?: CutSpec[];
	/** `false` keeps pauses; otherwise the "Remove pauses" settings. */
	pauses?: false | { minMs?: number; padMs?: number };
	/** `true` for the built-in list, or extra words to treat as fillers. */
	fillers?: boolean | string[];
	/** Store the transcript as the project's captions when it has none. */
	captions?: boolean;
};

// ---------------------------------------------------------------- helpers

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

function formatTime(ms: number): string {
	const total = Math.max(0, ms) / 1000;
	const minutes = Math.floor(total / 60);
	const seconds = total - minutes * 60;
	return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** `83.4`, `1:23.4` or `1:02:03` as milliseconds. */
function parseTime(value: string | number): number {
	if (typeof value === "number") return Math.round(value * 1000);
	const parts = value.trim().split(":").map(Number);
	if (parts.some((part) => !Number.isFinite(part))) fail(`bad time "${value}"`);
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return Math.round(seconds * 1000);
}

function parseArgs(argv: string[]) {
	const positional: string[] = [];
	const flags: Record<string, string | true> = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const [key, inline] = arg.slice(2).split("=", 2);
		const next = argv[index + 1];
		if (inline !== undefined) flags[key] = inline;
		else if (next !== undefined && !next.startsWith("--")) {
			flags[key] = next;
			index++;
		} else flags[key] = true;
	}
	return { positional, flags };
}

function flagString(flags: Record<string, string | true>, key: string): string | undefined {
	const value = flags[key];
	return typeof value === "string" ? value : undefined;
}

function findFfmpeg(): string {
	const candidates = [
		process.env.RECORDLY_FFMPEG,
		path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
		path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
	].filter((value): value is string => Boolean(value));
	return candidates.find((candidate) => existsSync(candidate)) ?? "ffmpeg";
}

/** The GPU build Recordly prefers, then the CPU one it ships with. */
function findWhisper(): string {
	const programs = process.env.LOCALAPPDATA
		? path.join(process.env.LOCALAPPDATA, "Programs", "Recordly", "resources")
		: "";
	const candidates = [
		process.env.RECORDLY_WHISPER,
		path.join(USER_DATA, "whisper-cuda", "bin", "Release", "whisper-cli.exe"),
		path.join(USER_DATA, "whisper-cuda", "whisper-cli.exe"),
		programs &&
			path.join(
				programs,
				"app.asar.unpacked",
				"electron",
				"native",
				"bin",
				"win32-x64",
				"whisper-cli.exe",
			),
		path.join(process.cwd(), "electron", "native", "bin", "win32-x64", "whisper-cli.exe"),
	].filter((value): value is string => Boolean(value));
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) fail("no whisper-cli found; set RECORDLY_WHISPER to its path");
	return found;
}

async function findWhisperModel(preferred?: string): Promise<string> {
	if (preferred) return preferred;
	try {
		const settings = JSON.parse(
			await fs.readFile(path.join(USER_DATA, "app-settings.json"), "utf8"),
		) as { whisperModelPath?: string };
		if (settings.whisperModelPath && existsSync(settings.whisperModelPath))
			return settings.whisperModelPath;
	} catch {
		// Fall through to the default model.
	}
	const fallback = path.join(USER_DATA, "whisper", "ggml-small.bin");
	if (!existsSync(fallback)) fail("no Whisper model found; pass --model <ggml file>");
	return fallback;
}

async function readProject(projectPath: string): Promise<Project> {
	const project = JSON.parse(await fs.readFile(projectPath, "utf8")) as Project;
	if (!project || typeof project.videoPath !== "string" || typeof project.editor !== "object")
		fail(`${projectPath} is not a Recordly project`);
	return project;
}

async function probeDurationMs(ffmpeg: string, file: string): Promise<number> {
	const { stderr } = await execFileAsync(
		ffmpeg,
		["-hide_banner", "-i", file],
		EXEC_OPTIONS,
	).catch((error: { stderr?: string }) => ({ stderr: error.stderr ?? "" }));
	const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
	if (!match) fail(`could not read the duration of ${file}`);
	return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

/**
 * Speech audio in source time: the microphone sidecar (shifted by its recorded start
 * delay) when the recording has one, otherwise the recording's own audio track.
 */
async function extractSpeechWav(ffmpeg: string, videoPath: string, wavPath: string) {
	const micPath = videoPath.replace(/\.mp4$/i, ".mic.wav");
	if (micPath !== videoPath && existsSync(micPath)) {
		let delayMs = 0;
		try {
			const meta = JSON.parse(await fs.readFile(`${micPath}.json`, "utf8")) as {
				startDelayMs?: number;
			};
			if (Number.isFinite(meta.startDelayMs) && (meta.startDelayMs as number) > 0)
				delayMs = Math.round(meta.startDelayMs as number);
		} catch {
			// No metadata: the sidecar starts with the video.
		}
		await execFileAsync(
			ffmpeg,
			[
				"-y",
				"-i",
				micPath,
				"-map",
				"0:a:0",
				"-vn",
				...(delayMs > 0 ? ["-af", `adelay=${delayMs}:all=1`] : []),
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"pcm_s16le",
				wavPath,
			],
			EXEC_OPTIONS,
		);
		return `microphone sidecar (+${delayMs} ms)`;
	}
	await execFileAsync(
		ffmpeg,
		[
			"-y",
			"-i",
			videoPath,
			"-map",
			"0:a:0",
			"-vn",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"pcm_s16le",
			wavPath,
		],
		EXEC_OPTIONS,
	);
	return "recording audio track";
}

async function detectSilences(ffmpeg: string, wavPath: string, noiseDb = NOISE_DB) {
	const { stderr } = await execFileAsync(
		ffmpeg,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			wavPath,
			"-af",
			`silencedetect=noise=${noiseDb}dB:d=${DETECT_MIN_S}`,
			"-f",
			"null",
			"-",
		],
		EXEC_OPTIONS,
	);
	return parseSilenceIntervals(stderr ?? "");
}

/** RMS loudness every 10 ms, so cuts can land between words rather than on Whisper's guess. */
async function measureEnvelope(ffmpeg: string, wavPath: string, dir: string): Promise<number[]> {
	const metadataPath = path.join(dir, "envelope.txt");
	// ametadata's file option is parsed as filter-graph text, where a drive colon breaks
	// it: run ffmpeg inside the work folder and name the file relatively.
	await execFileAsync(
		ffmpeg,
		[
			"-hide_banner",
			"-nostats",
			"-i",
			wavPath,
			"-af",
			`asetnsamples=${(16000 * ENVELOPE_STEP_MS) / 1000},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=envelope.txt`,
			"-f",
			"null",
			"-",
		],
		{ ...EXEC_OPTIONS, cwd: dir },
	);
	const text = await fs.readFile(metadataPath, "utf8");
	await fs.rm(metadataPath, { force: true });
	return [...text.matchAll(/RMS_level=(\S+)/g)].map((match) => {
		const value = Number(match[1]);
		return Number.isFinite(value) ? Math.round(value) : -120;
	});
}

/** whisper.cpp's alignment-head preset for a ggml model file, e.g. ggml-large-v3-turbo.bin. */
function dtwPresetFor(modelPath: string): string | null {
	const name = path
		.basename(modelPath)
		.replace(/^ggml-/, "")
		.replace(/(-q\d.*)?\.bin$/, "");
	const preset = name.replace(/-/g, ".");
	return /^(tiny|base|small|medium|large)(\.en|\.v[123]|\.v3\.turbo)?$/.test(preset)
		? preset
		: null;
}

type WhisperToken = { text?: string; offsets?: { from: number; to: number }; t_dtw?: number };
type WhisperSegment = { offsets?: { from: number; to: number }; tokens?: WhisperToken[] };

/**
 * Rewrite token offsets in whisper's full JSON from their DTW times (`t_dtw`, in
 * 10 ms units), so the editor's own parser builds words on the better timings.
 * Returns false when the file carries no DTW times.
 */
async function applyDtwTimings(jsonPath: string): Promise<boolean> {
	const parsed = JSON.parse(await fs.readFile(jsonPath, "utf8")) as {
		transcription?: WhisperSegment[];
	};
	const tokens = (parsed.transcription ?? []).flatMap((segment) =>
		(segment.tokens ?? []).filter(
			(token) =>
				token.offsets &&
				typeof token.t_dtw === "number" &&
				token.t_dtw >= 0 &&
				!/^\s*\[_[^\]]+\]\s*$/.test(token.text ?? ""),
		),
	);
	if (tokens.length === 0) return false;
	let previous = 0;
	const starts = tokens.map((token) => {
		previous = Math.max(previous, (token.t_dtw as number) * 10);
		return previous;
	});
	tokens.forEach((token, index) => {
		const offsets = token.offsets as { from: number; to: number };
		const next = starts[index + 1] ?? Math.max(offsets.to, starts[index] + 10);
		offsets.from = starts[index];
		offsets.to = Math.max(starts[index] + 10, next);
	});
	for (const segment of parsed.transcription ?? []) {
		const timed = (segment.tokens ?? []).filter((token) => tokens.includes(token));
		if (!segment.offsets || timed.length === 0) continue;
		segment.offsets.from = (timed[0].offsets as { from: number }).from;
		segment.offsets.to = (timed[timed.length - 1].offsets as { to: number }).to;
	}
	await fs.writeFile(jsonPath, JSON.stringify(parsed));
	return true;
}

function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function workDir(project: Project, projectPath: string): string {
	const key = project.projectId ?? path.basename(projectPath, ".recordly");
	return path.join(WORK_ROOT, key.replace(/[^\w.-]+/g, "_"));
}

async function loadTranscript(project: Project, projectPath: string): Promise<Transcript> {
	const file = path.join(workDir(project, projectPath), "transcript.json");
	if (!existsSync(file)) fail(`no transcript yet: run "transcribe" first`);
	const transcript = JSON.parse(await fs.readFile(file, "utf8")) as Transcript;
	if (transcript.videoPath !== project.videoPath)
		fail(`the transcript belongs to another video: run "transcribe --force"`);
	return transcript;
}

/**
 * Whisper often starts a word inside the pause before it (300–400 ms early after a
 * breath). Acoustic silence is ground truth, so a word is pushed out of any silence
 * it overlaps.
 */
function snapToSpeech(word: Word, silences: SilenceInterval[]): Word {
	let { startMs, endMs } = word;
	for (const silence of silences) {
		const silenceEnd = Number.isFinite(silence.endMs)
			? silence.endMs
			: Number.POSITIVE_INFINITY;
		if (silenceEnd <= startMs || silence.startMs >= endMs) continue;
		if (silence.startMs <= startMs && silenceEnd >= endMs) {
			// Entirely inside: the word is really spoken right after the pause.
			const duration = endMs - startMs;
			startMs = silenceEnd;
			endMs = silenceEnd + duration;
		} else if (silence.startMs <= startMs) startMs = silenceEnd;
		else endMs = silence.startMs;
	}
	return {
		...word,
		startMs: Math.round(startMs),
		endMs: Math.round(Math.max(endMs, startMs + 1)),
	};
}

function wordsOf(transcript: Transcript): Word[] {
	const words: Word[] = [];
	for (const cue of transcript.cues) {
		for (const word of cue.words ?? []) {
			const text = word.text.trim();
			if (!text) continue;
			words.push(
				snapToSpeech(
					{ i: words.length, text, startMs: word.startMs, endMs: word.endMs },
					transcript.silences,
				),
			);
		}
	}
	return words;
}

/** The quietest moment in [fromMs, toMs], or `fallbackMs` without a loudness track. */
function quietestMs(
	envelopeDb: number[] | undefined,
	fromMs: number,
	toMs: number,
	fallbackMs: number,
): number {
	if (!envelopeDb?.length || toMs <= fromMs) return fallbackMs;
	let best = fallbackMs;
	let bestDb = Number.POSITIVE_INFINITY;
	for (
		let step = Math.floor(fromMs / ENVELOPE_STEP_MS);
		step * ENVELOPE_STEP_MS <= toMs;
		step++
	) {
		const db = envelopeDb[step];
		if (db === undefined) break;
		// Ties go to the moment closest to Whisper's own boundary.
		const ms = step * ENVELOPE_STEP_MS + ENVELOPE_STEP_MS / 2;
		if (
			db < bestDb ||
			(db === bestDb && Math.abs(ms - fallbackMs) < Math.abs(best - fallbackMs))
		) {
			bestDb = db;
			best = ms;
		}
	}
	return best;
}

function phrasesOf(transcript: Transcript): Phrase[] {
	const words = wordsOf(transcript);
	let cursor = 0;
	return transcript.cues
		.map((cue) => {
			const count = (cue.words ?? []).filter((word) => word.text.trim()).length;
			const slice = words.slice(cursor, cursor + count);
			cursor += count;
			return { startMs: cue.startMs, endMs: cue.endMs, words: slice };
		})
		.filter((phrase) => phrase.words.length > 0);
}

function getClips(project: Project, sourceDurationMs: number): ClipRegion[] {
	const clips = project.editor.clipRegions ?? [];
	if (clips.length > 0) return sortClipRegions(clips);
	return [{ id: "clip-1", startMs: 0, endMs: sourceDurationMs, speed: 1 }];
}

/** How much of [start, end) (source ms) still plays in the timeline. */
function keptFraction(clips: ClipRegion[], startMs: number, endMs: number): number {
	const length = Math.max(1, endMs - startMs);
	let kept = 0;
	for (const clip of clips) {
		const overlap =
			Math.min(endMs, getClipSourceEndMs(clip)) -
			Math.max(startMs, getClipSourceStartMs(clip));
		if (overlap > 0) kept += overlap;
	}
	return Math.min(1, kept / length);
}

function overlapFraction(word: Word, startMs: number, endMs: number): number {
	const overlap = Math.min(endMs, word.endMs) - Math.max(startMs, word.startMs);
	return Math.max(0, overlap) / Math.max(1, word.endMs - word.startMs);
}

/** Source ms → timeline ms, or null when that moment is cut. */
function toTimelineMs(clips: ClipRegion[], sourceMs: number): number | null {
	for (const clip of clips) {
		const start = getClipSourceStartMs(clip);
		if (sourceMs >= start && sourceMs < getClipSourceEndMs(clip)) {
			const speed = clip.speed > 0 ? clip.speed : 1;
			return Math.round(clip.startMs + (sourceMs - start) / speed);
		}
	}
	return null;
}

function nextClipIdFactory(clips: ClipRegion[]) {
	let next =
		Math.max(
			0,
			...clips
				.map((clip) => Number(/(\d+)$/.exec(clip.id)?.[1] ?? 0))
				.filter(Number.isFinite),
		) + 1;
	return () => `clip-${next++}`;
}

/** The gap before a word lies just ahead of its (DTW) onset; look there, not inside it. */
const BOUNDARY_LATE_MS = 60;

function midMs(word: Word): number {
	return (word.startMs + word.endMs) / 2;
}

/**
 * A word range cut. Each edge lands on the quietest moment just before the onset of
 * the first cut word and of the word after the range, never past a word's middle,
 * because Whisper's timings drift.
 */
function wordRangeSpan(words: Word[], spec: string, envelopeDb?: number[]): SourceSilence {
	const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(spec.trim());
	if (!match) fail(`bad word range "${spec}" (use 120-135)`);
	const first = Number(match[1]);
	const last = Number(match[2] ?? match[1]);
	if (first > last || !words[first] || !words[last])
		fail(`word range "${spec}" is out of bounds`);
	const before = words[first - 1];
	const after = words[last + 1];
	const startBoundary = words[first].startMs;
	const startMs = quietestMs(
		envelopeDb,
		Math.max(startBoundary - WORD_CUT_REACH_MS, before ? midMs(before) : 0),
		Math.min(startBoundary + BOUNDARY_LATE_MS, midMs(words[first])),
		startBoundary,
	);
	const endBoundary = after ? after.startMs : words[last].endMs;
	const endMs = quietestMs(
		envelopeDb,
		Math.max(endBoundary - WORD_CUT_REACH_MS, midMs(words[last])),
		Math.min(endBoundary + BOUNDARY_LATE_MS, after ? midMs(after) : Number.POSITIVE_INFINITY),
		endBoundary,
	);
	return { startMs: Math.max(0, Math.round(startMs)), endMs: Math.round(endMs), kind: "filler" };
}

// ---------------------------------------------------------------- commands

async function commandInfo(projectPath: string) {
	const project = await readProject(projectPath);
	const ffmpeg = findFfmpeg();
	const durationMs = await probeDurationMs(ffmpeg, project.videoPath);
	const clips = getClips(project, durationMs);
	const timelineMs = clips.reduce((total, clip) => Math.max(total, clip.endMs), 0);
	const transcriptFile = path.join(workDir(project, projectPath), "transcript.json");
	console.log(`project     ${projectPath}`);
	console.log(`video       ${project.videoPath}`);
	console.log(`recording   ${formatTime(durationMs)}   timeline ${formatTime(timelineMs)}`);
	console.log(`clips       ${clips.length}`);
	for (const clip of clips) {
		console.log(
			`  ${clip.id.padEnd(10)} timeline ${formatTime(clip.startMs)}–${formatTime(clip.endMs)}  ` +
				`source ${formatTime(getClipSourceStartMs(clip))}–${formatTime(getClipSourceEndMs(clip))}` +
				(clip.speed !== 1 ? `  ×${clip.speed}` : ""),
		);
	}
	console.log(`zooms       ${project.editor.zoomRegions?.length ?? 0}`);
	console.log(`captions    ${project.editor.autoCaptions?.length ?? 0}`);
	console.log(
		`transcript  ${existsSync(transcriptFile) ? transcriptFile : "none (run transcribe)"}`,
	);
}

async function commandTranscribe(projectPath: string, flags: Record<string, string | true>) {
	const project = await readProject(projectPath);
	const dir = workDir(project, projectPath);
	const file = path.join(dir, "transcript.json");
	if (existsSync(file) && !flags.force) {
		console.log(`transcript already exists: ${file} (use --force to redo it)`);
		return;
	}
	await fs.mkdir(dir, { recursive: true });
	const ffmpeg = findFfmpeg();
	const sourceDurationMs = await probeDurationMs(ffmpeg, project.videoPath);
	const wavPath = path.join(dir, "speech.wav");
	const audioSource = await extractSpeechWav(ffmpeg, project.videoPath, wavPath);
	const silences = await detectSilences(ffmpeg, wavPath);
	const envelopeDb = await measureEnvelope(ffmpeg, wavPath, dir);

	const existing = project.editor.autoCaptions ?? [];
	let cues: CaptionCue[];
	if (existing.some((cue) => cue.words?.length) && !flags.whisper) {
		cues = existing;
		console.log(
			`using the project's ${existing.length} captions (pass --whisper to transcribe again)`,
		);
	} else {
		const whisper = findWhisper();
		const model = await findWhisperModel(flagString(flags, "model"));
		const language = flagString(flags, "lang") ?? "auto";
		const prompt =
			flagString(flags, "prompt") ??
			(project.editor.autoCaptionSettings as { glossary?: string } | undefined)?.glossary;
		const outputBase = path.join(dir, "whisper");
		const started = Date.now();
		console.log(
			`whisper ${path.basename(path.dirname(whisper))}/${path.basename(whisper)} · ${path.basename(model)} · ${language}`,
		);
		const baseArgs = [
			"-m",
			model,
			"-f",
			wavPath,
			"-of",
			outputBase,
			"-l",
			language,
			...(prompt?.trim() ? ["--prompt", prompt.trim().slice(0, 1000)] : []),
			"-np",
			"-mc",
			"0",
			"-ml",
			"1",
			"-sow",
			"-ojf",
		];
		// DTW token timings follow the audio far more closely than Whisper's own offsets,
		// which drift up to half a second inside fast speech. DTW needs flash attention off.
		const dtwPreset = dtwPresetFor(model);
		let timing = "whisper offsets";
		try {
			if (!dtwPreset) throw new Error("no DTW preset for this model");
			await execFileAsync(whisper, [...baseArgs, "-dtw", dtwPreset, "-nfa"], EXEC_OPTIONS);
			if (await applyDtwTimings(`${outputBase}.json`)) timing = `DTW (${dtwPreset})`;
		} catch (error) {
			const reason = error instanceof Error ? error.message.split(/\r?\n/)[0] : String(error);
			console.warn(`DTW timing unavailable (${reason}); using Whisper offsets`);
			await execFileAsync(whisper, baseArgs, EXEC_OPTIONS);
		}
		console.log(`timing      ${timing}`);
		// Same as the editor: a one-word cue without token timings is its own word.
		const raw = (await readWhisperCaptionOutput(outputBase, true)).map((cue) =>
			!cue.words?.length && cue.text.trim().split(/\s+/).length === 1
				? {
						...cue,
						words: [{ text: cue.text.trim(), startMs: cue.startMs, endMs: cue.endMs }],
					}
				: cue,
		);
		cues = segmentCuesIntoPhrases(raw, silences);
		console.log(`transcribed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
	}

	const transcript: Transcript = {
		videoPath: project.videoPath,
		audioSource,
		sourceDurationMs,
		cues,
		silences,
		envelopeDb,
		speechWav: wavPath,
	};
	await fs.writeFile(file, JSON.stringify(transcript));
	console.log(`audio       ${audioSource}`);
	console.log(`words       ${wordsOf(transcript).length} in ${cues.length} phrases`);
	console.log(`pauses      ${silences.length} (≥ ${DETECT_MIN_S} s)`);
	console.log(`saved       ${file}`);
}

async function commandTranscript(projectPath: string, flags: Record<string, string | true>) {
	const project = await readProject(projectPath);
	const transcript = await loadTranscript(project, projectPath);
	const clips = getClips(project, transcript.sourceDurationMs);
	const words = wordsOf(transcript);

	const range = flagString(flags, "words");
	if (range) {
		const [first, last] = range.split("-").map(Number);
		for (const word of words.slice(first, (last ?? first) + 1)) {
			const cut = keptFraction(clips, word.startMs, word.endMs) < 0.5 ? "  ✂" : "";
			console.log(`w${word.i}\t${word.startMs}–${word.endMs} ms\t${word.text}${cut}`);
		}
		return;
	}

	if (flags.json) {
		console.log(JSON.stringify({ words, silences: transcript.silences }));
		return;
	}

	const minPauseMs = Number(flagString(flags, "pause") ?? 700);
	console.log("# source time · w<first>–<last> word ids · ✂ already cut · ~ partly cut");
	let previousEnd = 0;
	for (const phrase of phrasesOf(transcript)) {
		const gap = phrase.words[0].startMs - previousEnd;
		if (gap >= minPauseMs) console.log(`        · pause ${(gap / 1000).toFixed(1)} s`);
		const kept = keptFraction(
			clips,
			phrase.words[0].startMs,
			phrase.words[phrase.words.length - 1].endMs,
		);
		const mark = kept < 0.05 ? "✂" : kept < 0.95 ? "~" : " ";
		const first = phrase.words[0];
		const last = phrase.words[phrase.words.length - 1];
		const timeline = toTimelineMs(clips, first.startMs);
		const text = phrase.words.map((word) => word.text).join(" ");
		console.log(
			`${mark} ${formatTime(first.startMs).padStart(7)}  w${first.i}–${last.i}` +
				`${timeline === null ? "" : `  (tl ${formatTime(timeline)})`}  ${text}`,
		);
		previousEnd = last.endMs;
	}
}

async function commandApply(projectPath: string, flags: Record<string, string | true>) {
	const planPath = flagString(flags, "plan");
	if (!planPath) fail("apply needs --plan <plan.json>");
	const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as EditPlan;
	const project = await readProject(projectPath);
	const transcript = await loadTranscript(project, projectPath);
	const words = wordsOf(transcript);
	const clips = getClips(project, transcript.sourceDurationMs);
	const beforeMs = clips.reduce((total, clip) => Math.max(total, clip.endMs), 0);

	const spans: SourceSilence[] = [];
	const report: string[] = [];
	for (const cut of plan.cuts ?? []) {
		let span: SourceSilence;
		if (cut.words) {
			span = wordRangeSpan(words, cut.words, transcript.envelopeDb);
			if (cut.expect !== undefined) {
				const [first, last = first] = cut.words.split("-").map(Number);
				const actual = words
					.slice(first, last + 1)
					.map((word) => word.text)
					.join(" ");
				if (normalizeText(actual) !== normalizeText(cut.expect))
					fail(
						`words ${cut.words} say «${actual}», not «${cut.expect}»: the transcript changed, re-read it`,
					);
			}
		} else if (cut.from !== undefined && cut.to !== undefined)
			span = { startMs: parseTime(cut.from), endMs: parseTime(cut.to), kind: "filler" };
		else fail(`a cut needs "words" or "from"/"to": ${JSON.stringify(cut)}`);
		if (span.endMs === null || span.endMs <= span.startMs)
			fail(`empty cut ${JSON.stringify(cut)}`);
		spans.push(span);
		const said = words
			.filter((word) => overlapFraction(word, span.startMs, span.endMs as number) >= 0.5)
			.map((word) => word.text)
			.join(" ");
		report.push(
			`  ✂ ${formatTime(span.startMs)}–${formatTime(span.endMs as number)}  ${cut.reason ?? ""}${said ? `  «${said}»` : ""}`,
		);
	}
	if (plan.fillers) {
		const extra = Array.isArray(plan.fillers) ? plan.fillers : [];
		const fillers = findFillerWordSpans(transcript.cues, [...DEFAULT_FILLER_WORDS, ...extra]);
		spans.push(...fillers);
		report.push(`  ✂ ${fillers.length} filler words`);
	}
	const pauses =
		plan.pauses === false ? null : { minMs: 1000, padMs: 150, ...(plan.pauses ?? {}) };
	if (pauses) {
		spans.push(
			...transcript.silences.map((silence) => ({
				startMs: silence.startMs,
				endMs: Number.isFinite(silence.endMs) ? silence.endMs : null,
				kind: "silence" as const,
			})),
		);
	}

	const result = planSilenceRemoval(clips, spans, {
		minSilenceMs: pauses?.minMs ?? Number.POSITIVE_INFINITY,
		padMs: pauses?.padMs ?? 0,
		sourceDurationMs: transcript.sourceDurationMs,
		createId: nextClipIdFactory(clips),
	});
	const after = packClipSequence(result.after);
	const afterMs = after.reduce((total, clip) => Math.max(total, clip.endMs), 0);

	console.log(`cuts:`);
	for (const line of report) console.log(line);
	if (pauses) console.log(`  ✂ pauses ≥ ${pauses.minMs} ms (pad ${pauses.padMs} ms)`);
	console.log(
		`removed     ${result.removedCount} pieces, ${(result.removedMs / 1000).toFixed(1)} s of source`,
	);
	console.log(
		`timeline    ${formatTime(beforeMs)} → ${formatTime(afterMs)}   clips ${clips.length} → ${after.length}`,
	);
	console.log(`\nwhat remains:`);
	const remaining = words.filter((word) => keptFraction(after, word.startMs, word.endMs) >= 0.5);
	console.log(remaining.map((word) => word.text).join(" "));

	if (flags["dry-run"]) {
		console.log(`\n(dry run: nothing written)`);
		return;
	}

	const editor = { ...project.editor };
	editor.clipRegions = after;
	editor.autoFullTrackClipId = null;
	if (editor.zoomRegions)
		editor.zoomRegions = rippleRegions(editor.zoomRegions, result.split, after);
	if (editor.annotationRegions)
		editor.annotationRegions = rippleRegions(editor.annotationRegions, result.split, after);
	if (editor.audioRegions)
		editor.audioRegions = rippleRegionAnchors(editor.audioRegions, result.split, after);
	if (plan.captions !== false && !editor.autoCaptions?.length)
		editor.autoCaptions = transcript.cues;

	const inPlace = Boolean(flags["in-place"]);
	const outPath =
		flagString(flags, "out") ??
		(inPlace
			? projectPath
			: path.join(
					path.dirname(projectPath),
					`${path.basename(projectPath, ".recordly")} (Claude).recordly`,
				));
	if (existsSync(outPath)) await fs.copyFile(outPath, `${outPath}.bak`);
	const output: Project = {
		...project,
		projectId: inPlace ? project.projectId : randomUUID(),
		editor,
	};
	await fs.writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`);
	// Point the new project at the original's transcript so it can be edited again.
	if (!inPlace) {
		const sourceDir = workDir(project, projectPath);
		const targetDir = workDir(output, outPath);
		await fs.mkdir(targetDir, { recursive: true });
		await fs.copyFile(
			path.join(sourceDir, "transcript.json"),
			path.join(targetDir, "transcript.json"),
		);
	}
	await addToRecentProjects(outPath);
	console.log(`\nsaved       ${outPath}`);
}

async function addToRecentProjects(projectPath: string) {
	try {
		const recent = existsSync(RECENT_PROJECTS)
			? (JSON.parse(await fs.readFile(RECENT_PROJECTS, "utf8")) as { paths?: string[] })
			: { paths: [] };
		const paths = [
			projectPath,
			...(recent.paths ?? []).filter((entry) => entry !== projectPath),
		];
		await fs.writeFile(
			RECENT_PROJECTS,
			JSON.stringify({ ...recent, paths: paths.slice(0, 20) }, null, 2),
		);
	} catch {
		// The recent list is a convenience; the project is saved either way.
	}
}

/**
 * What the viewer will hear: the timeline's speech, clip by clip, transcribed again.
 * Reading it back is how a cut is checked without exporting the video.
 */
async function commandListen(projectPath: string, flags: Record<string, string | true>) {
	const project = await readProject(projectPath);
	const transcript = await loadTranscript(project, projectPath);
	const dir = workDir(project, projectPath);
	const wavPath = transcript.speechWav ?? path.join(dir, "speech.wav");
	if (!existsSync(wavPath)) fail(`speech audio missing: run "transcribe --force"`);
	const clips = getClips(project, transcript.sourceDurationMs).filter((clip) => !clip.muted);
	const ffmpeg = findFfmpeg();
	const graph = clips
		.map((clip, index) => {
			const start = getClipSourceStartMs(clip) / 1000;
			const end = getClipSourceEndMs(clip) / 1000;
			return `[0:a]atrim=${start.toFixed(3)}:${end.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`;
		})
		.join(";");
	const concat = `${clips.map((_, index) => `[a${index}]`).join("")}concat=n=${clips.length}:v=0:a=1[out]`;
	const graphPath = path.join(dir, "listen.filter");
	await fs.writeFile(graphPath, `${graph};${concat}`);
	const timelinePath = path.join(dir, "timeline.wav");
	await execFileAsync(
		ffmpeg,
		[
			"-y",
			"-loglevel",
			"error",
			"-i",
			wavPath,
			"-filter_complex_script",
			graphPath,
			"-map",
			"[out]",
			"-ac",
			"1",
			"-ar",
			"16000",
			"-c:a",
			"pcm_s16le",
			timelinePath,
		],
		EXEC_OPTIONS,
	);
	const outputBase = path.join(dir, "listen");
	await execFileAsync(
		findWhisper(),
		[
			"-m",
			await findWhisperModel(flagString(flags, "model")),
			"-f",
			timelinePath,
			"-of",
			outputBase,
			"-l",
			flagString(flags, "lang") ?? "auto",
			"-np",
			"-mc",
			"0",
			"-osrt",
		],
		EXEC_OPTIONS,
	);
	const srt = await fs.readFile(`${outputBase}.srt`, "utf8");
	for (const block of srt.split(/\r?\n\r?\n/)) {
		const lines = block.trim().split(/\r?\n/);
		if (lines.length < 3) continue;
		const start = lines[1].split(" --> ")[0].replace(",", ".").replace(/^00:/, "");
		console.log(`${start}  ${lines.slice(2).join(" ")}`);
	}
}

/**
 * The words as they land in the edited video (timeline ms), for motion graphics laid
 * over the export. Words the cuts removed are left out.
 */
async function commandTimeline(projectPath: string, flags: Record<string, string | true>) {
	const project = await readProject(projectPath);
	const transcript = await loadTranscript(project, projectPath);
	const clips = getClips(project, transcript.sourceDurationMs);
	const words: Array<{ text: string; startMs: number; endMs: number }> = [];
	for (const word of wordsOf(transcript)) {
		if (keptFraction(clips, word.startMs, word.endMs) < 0.5) continue;
		const start = toTimelineMs(clips, word.startMs) ?? toTimelineMs(clips, word.endMs - 1);
		if (start === null) continue;
		const end = toTimelineMs(clips, word.endMs - 1) ?? start + (word.endMs - word.startMs);
		words.push({ text: word.text, startMs: start, endMs: Math.max(start + 1, end) });
	}
	const durationMs = clips.reduce((total, clip) => Math.max(total, clip.endMs), 0);
	const json = JSON.stringify({ project: projectPath, durationMs, words }, null, 1);
	const out = flagString(flags, "out");
	if (out) {
		await fs.writeFile(out, json);
		console.log(`${words.length} words, ${formatTime(durationMs)} → ${out}`);
	} else console.log(json);
}

/** The packaged fork first, then the installed app. */
function findRecordlyExe(): string {
	const candidates = [
		process.env.RECORDLY_EXE,
		path.join(process.cwd(), "..", "Recordly-Nuevo", "Recordly.exe"),
		process.env.LOCALAPPDATA &&
			path.join(process.env.LOCALAPPDATA, "Programs", "Recordly", "Recordly.exe"),
	].filter((value): value is string => Boolean(value));
	const found = candidates.find((candidate) => existsSync(candidate));
	if (!found) fail("no Recordly.exe found; set RECORDLY_EXE");
	return found;
}

/**
 * Export the project with Recordly itself (its smoke-export mode, in a throwaway
 * profile so the user's open app is untouched). `--no-captions` renders without the
 * project's captions, for footage that gets its own animated captions later.
 */
async function commandExport(projectPath: string, flags: Record<string, string | true>) {
	const out = flagString(flags, "out");
	if (!out) fail("export needs --out <file.mp4>");
	const quality = flagString(flags, "quality") ?? "source";
	if (!["medium", "good", "high", "source"].includes(quality))
		fail(`quality must be medium, good, high or source`);
	const project = await readProject(projectPath);
	const dir = workDir(project, projectPath);
	await fs.mkdir(dir, { recursive: true });
	let exportPath = projectPath;
	if (flags["no-captions"] || flags["no-webcam"]) {
		const editor = { ...project.editor };
		if (flags["no-captions"]) {
			const settings = (project.editor.autoCaptionSettings ?? {}) as Record<string, unknown>;
			editor.autoCaptionSettings = { ...settings, enabled: false };
			editor.autoCaptions = [];
		}
		if (flags["no-webcam"]) editor.webcam = { ...((editor.webcam ?? {}) as object), enabled: false };
		exportPath = path.join(dir, "export-copy.recordly");
		await fs.writeFile(exportPath, JSON.stringify({ ...project, editor }));
	}
	const outPath = path.resolve(out);
	await fs.rm(outPath, { force: true });
	const started = Date.now();
	const { stdout, stderr } = await execFileAsync(
		findRecordlyExe(),
		[`--user-data-dir=${path.join(dir, "export-profile")}`],
		{
			...EXEC_OPTIONS,
			env: {
				...process.env,
				RECORDLY_SMOKE_EXPORT: "1",
				RECORDLY_SMOKE_EXPORT_PROJECT: exportPath,
				RECORDLY_SMOKE_EXPORT_OUTPUT: outPath,
				RECORDLY_SMOKE_EXPORT_QUALITY: quality,
			},
		},
	);
	if (!existsSync(outPath)) {
		const log = `${stdout}\n${stderr}`.split(/\r?\n/).filter((line) => /smoke|error/i.test(line));
		fail(`Recordly finished without writing the export:\n${log.slice(-15).join("\n")}`);
	}
	const durationMs = await probeDurationMs(findFfmpeg(), outPath);
	console.log(
		`exported ${formatTime(durationMs)} in ${((Date.now() - started) / 1000).toFixed(0)} s → ${outPath}`,
	);
}

type WebcamSettings = {
	sourcePath?: string | null;
	timeOffsetMs?: number;
	mirror?: boolean;
	cropRegion?: { x: number; y: number; width: number; height: number };
};

/** The project's webcam file, or the one its recording session names when the project lost it. */
async function findWebcamPath(project: Project): Promise<string> {
	const webcam = (project.editor.webcam ?? {}) as WebcamSettings;
	if (webcam.sourcePath && existsSync(webcam.sourcePath)) return webcam.sourcePath;
	const sessionPath = project.videoPath.replace(/\.[^.]+$/, ".recordly-session.json");
	if (existsSync(sessionPath)) {
		const session = JSON.parse(await fs.readFile(sessionPath, "utf8")) as {
			webcamFileName?: string;
		};
		const candidate =
			session.webcamFileName && path.join(path.dirname(project.videoPath), session.webcamFileName);
		if (candidate && existsSync(candidate)) return candidate;
	}
	fail("this project has no webcam recording");
}

/**
 * The webcam footage cut like the edited timeline (same clips, speeds and sync offset as
 * the editor), mirrored and cropped like the editor shows it, without audio. Lets the
 * motion-graphics step place the camera itself (full frame, split, big) over an export
 * made with `export --no-webcam`.
 */
async function commandWebcam(projectPath: string, flags: Record<string, string | true>) {
	const out = flagString(flags, "out");
	if (!out) fail("webcam needs --out <file.mp4>");
	const project = await readProject(projectPath);
	const webcam = (project.editor.webcam ?? {}) as WebcamSettings;
	const webcamPath = await findWebcamPath(project);
	const ffmpeg = findFfmpeg();
	const sourceDurationMs = await probeDurationMs(ffmpeg, project.videoPath);
	const clips = getClips(project, sourceDurationMs);
	const fps = Number(flagString(flags, "fps") ?? 30);
	const offsetS = (webcam.timeOffsetMs ?? 0) / 1000;
	const crop = webcam.cropRegion ?? { x: 0, y: 0, width: 1, height: 1 };
	const look = [
		webcam.mirror ? "hflip" : "",
		crop.width < 1 || crop.height < 1
			? `crop=iw*${crop.width}:ih*${crop.height}:iw*${crop.x}:ih*${crop.y}`
			: "",
	]
		.filter(Boolean)
		.join(",");
	// Same mapping as the editor: webcam media time = source time − offset. Before the
	// webcam started (negative times) the first frame is held.
	const graph = clips
		.map((clip, index) => {
			const start = Math.max(0, getClipSourceStartMs(clip) / 1000 - offsetS);
			const end = Math.max(start + 0.001, getClipSourceEndMs(clip) / 1000 - offsetS);
			const speed = clip.speed > 0 ? clip.speed : 1;
			return `[0:v]trim=${start.toFixed(3)}:${end.toFixed(3)},setpts=(PTS-STARTPTS)/${speed}[v${index}]`;
		})
		.join(";");
	const concat = `${clips.map((_, index) => `[v${index}]`).join("")}concat=n=${clips.length}:v=1:a=0,fps=${fps}${look ? `,${look}` : ""}[out]`;
	const dir = workDir(project, projectPath);
	await fs.mkdir(dir, { recursive: true });
	const graphPath = path.join(dir, "webcam.filter");
	await fs.writeFile(graphPath, `${graph};${concat}`);
	const outPath = path.resolve(out);
	await execFileAsync(
		ffmpeg,
		[
			"-y",
			"-loglevel",
			"error",
			"-i",
			webcamPath,
			"-filter_complex_script",
			graphPath,
			"-map",
			"[out]",
			"-an",
			"-c:v",
			"libx264",
			"-preset",
			"veryfast",
			"-crf",
			"16",
			"-pix_fmt",
			"yuv420p",
			outPath,
		],
		EXEC_OPTIONS,
	);
	const durationMs = await probeDurationMs(ffmpeg, outPath);
	console.log(`webcam ${formatTime(durationMs)} (${clips.length} clips) → ${outPath}`);
}

async function commandFrame(projectPath: string, flags: Record<string, string | true>) {
	const project = await readProject(projectPath);
	const at = flagString(flags, "at");
	if (!at) fail("frame needs --at <source time>");
	const ms = parseTime(at);
	const out =
		flagString(flags, "out") ?? path.join(workDir(project, projectPath), `frame-${ms}.png`);
	await fs.mkdir(path.dirname(out), { recursive: true });
	await execFileAsync(
		findFfmpeg(),
		[
			"-y",
			"-ss",
			(ms / 1000).toFixed(3),
			"-i",
			project.videoPath,
			"-frames:v",
			"1",
			"-vf",
			"scale=1280:-2",
			out,
		],
		EXEC_OPTIONS,
	);
	console.log(out);
}

const USAGE = `usage: npm run claude-edit -- <command> <project.recordly> [options]

  info         clips, durations and whether a transcript exists
  transcribe   speech → words with timings (Whisper, GPU when available)
               --lang es  --model <ggml file>  --prompt "names"  --force  --whisper
  transcript   phrases with word ids in source time  (--pause 700, --words 120-135, --json)
  apply        --plan plan.json  [--dry-run] [--out file] [--in-place]
  listen       transcribe the edited timeline again, to hear what the cuts left (--lang es)
  timeline     words in edited-video time, for motion graphics  (--out words.json)
  export       Recordly renders the project  --out file.mp4 [--quality source] [--no-captions] [--no-webcam]
  webcam       the webcam cut like the timeline, no audio  --out cam.mp4 [--fps 30]
  frame       --at 1:23.4  [--out file.png]   still from the recording, source time`;

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));
	const [command, projectPath] = positional;
	if (!command || flags.help) {
		console.log(USAGE);
		return;
	}
	if (!projectPath) fail(`"${command}" needs a project path`);
	const resolved = path.resolve(projectPath);
	if (!existsSync(resolved)) fail(`not found: ${resolved}`);
	switch (command) {
		case "info":
			return commandInfo(resolved);
		case "transcribe":
			return commandTranscribe(resolved, flags);
		case "transcript":
			return commandTranscript(resolved, flags);
		case "apply":
			return commandApply(resolved, flags);
		case "timeline":
			return commandTimeline(resolved, flags);
		case "export":
			return commandExport(resolved, flags);
		case "listen":
			return commandListen(resolved, flags);
		case "webcam":
			return commandWebcam(resolved, flags);
		case "frame":
			return commandFrame(resolved, flags);
		default:
			fail(`unknown command "${command}"\n${USAGE}`);
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? (error.stack ?? error.message) : error);
	process.exit(1);
});
