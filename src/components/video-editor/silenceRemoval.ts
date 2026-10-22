import { packClipSequence } from "./clipSequence";
import { type ClipRegion, getClipSourceEndMs, getClipSourceStartMs, sortClipRegions } from "./types";

/** A silence in *source* time. `endMs` may be `null` for a trailing silence that runs to the end. */
export interface SourceSilence {
	startMs: number;
	endMs: number | null;
	/** A filler word ("eh", "um") is cut whole: no minimum length, no padding. */
	kind?: "silence" | "filler";
}

/** Single-word fillers in Spanish and English, matched against caption words. */
export const DEFAULT_FILLER_WORDS = [
	"eh", "em", "ehm", "emm", "mm", "mmm", "um", "uh", "uhm", "umm", "hmm", "hm", "ah", "er", "erm",
];

function normalizeWord(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z]/g, "");
}

/** Caption words (source time) that are fillers, as cuts for `planSilenceRemoval`. */
export function findFillerWordSpans(
	cues: ReadonlyArray<{ words?: ReadonlyArray<{ text: string; startMs: number; endMs: number }> }>,
	fillers: ReadonlyArray<string> = DEFAULT_FILLER_WORDS,
): SourceSilence[] {
	const set = new Set(fillers.map(normalizeWord).filter(Boolean));
	const spans: SourceSilence[] = [];
	for (const cue of cues) {
		for (const word of cue.words ?? []) {
			if (!set.has(normalizeWord(word.text))) continue;
			if (!(word.endMs > word.startMs)) continue;
			spans.push({ startMs: word.startMs, endMs: word.endMs, kind: "filler" });
		}
	}
	return spans.sort((left, right) => left.startMs - right.startMs);
}

export interface SilenceRemovalOptions {
	/** Only pauses at least this long (source ms) are removed. */
	minSilenceMs: number;
	/** Silence kept on each side of a cut so speech never feels clipped. */
	padMs: number;
	/** Where a trailing silence without an end stops. */
	sourceDurationMs: number;
	createId: () => string;
}

export interface SilenceRemovalPlan {
	/**
	 * The clips split at every cut but still at their original timeline positions.
	 * Effects are rippled from this sequence to `after`, piece by piece.
	 */
	split: ClipRegion[];
	/** The retained pieces packed back into a gapless sequence. */
	after: ClipRegion[];
	removedCount: number;
	removedMs: number;
}

/** A cut shorter than this (source ms) is not worth a clip boundary. */
const MIN_CUT_MS = 80;

interface SourceSpan {
	startMs: number;
	endMs: number;
}

function safeSpeed(clip: ClipRegion): number {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

/** Silences inside [sourceStart, sourceEnd] worth cutting, with padding applied. */
function planCutsForClip(
	clip: ClipRegion,
	silences: SourceSilence[],
	options: SilenceRemovalOptions,
): SourceSpan[] {
	const sourceStart = getClipSourceStartMs(clip);
	const sourceEnd = getClipSourceEndMs(clip);
	const cuts: SourceSpan[] = [];
	for (const silence of silences) {
		const silenceEnd = silence.endMs ?? Math.max(options.sourceDurationMs, silence.startMs);
		const filler = silence.kind === "filler";
		if (!filler && silenceEnd - silence.startMs < options.minSilenceMs) continue;
		if (silenceEnd <= sourceStart || silence.startMs >= sourceEnd) continue;
		// A silence touching the clip edge is trimmed fully; padding only protects speech.
		const pad = filler ? 0 : options.padMs;
		const cutStart = silence.startMs <= sourceStart ? sourceStart : silence.startMs + pad;
		const cutEnd = silenceEnd >= sourceEnd ? sourceEnd : silenceEnd - pad;
		const start = Math.max(sourceStart, Math.round(cutStart));
		const end = Math.min(sourceEnd, Math.round(cutEnd));
		if (end - start < MIN_CUT_MS) continue;
		const previous = cuts[cuts.length - 1];
		if (previous && start <= previous.endMs) previous.endMs = Math.max(previous.endMs, end);
		else cuts.push({ startMs: start, endMs: end });
	}
	return cuts;
}

/**
 * Plan removing detected pauses from the footage. Each clip is split at the cut
 * boundaries; the pieces covering a pause are dropped and the rest is packed.
 * The first retained piece of a clip keeps the clip's id so per-clip settings and
 * selection survive.
 */
export function planSilenceRemoval(
	clipRegions: ClipRegion[],
	silences: SourceSilence[],
	options: SilenceRemovalOptions,
): SilenceRemovalPlan {
	const sorted = sortClipRegions(clipRegions);
	const ordered = [...silences].sort((left, right) => left.startMs - right.startMs);
	const split: ClipRegion[] = [];
	const kept: ClipRegion[] = [];
	let removedCount = 0;
	let removedMs = 0;

	for (const clip of sorted) {
		const cuts = planCutsForClip(clip, ordered, options);
		if (cuts.length === 0) {
			split.push(clip);
			kept.push(clip);
			continue;
		}
		const speed = safeSpeed(clip);
		const sourceStart = getClipSourceStartMs(clip);
		const sourceEnd = getClipSourceEndMs(clip);
		const toTimeline = (sourceMs: number) =>
			Math.round(clip.startMs + (sourceMs - sourceStart) / speed);
		let originalIdUsed = false;
		const pushPiece = (span: SourceSpan, keep: boolean) => {
			const startMs = toTimeline(span.startMs);
			const endMs = keep ? toTimeline(span.endMs) : Math.max(startMs + 1, toTimeline(span.endMs));
			if (endMs <= startMs) return;
			const id = keep && !originalIdUsed ? clip.id : options.createId();
			if (keep && !originalIdUsed) originalIdUsed = true;
			const piece: ClipRegion = { ...clip, id, startMs, endMs, sourceStartMs: span.startMs };
			split.push(piece);
			if (keep) kept.push(piece);
			else {
				removedCount += 1;
				removedMs += span.endMs - span.startMs;
			}
		};
		let cursor = sourceStart;
		for (const cut of cuts) {
			if (cut.startMs > cursor) pushPiece({ startMs: cursor, endMs: cut.startMs }, true);
			pushPiece(cut, false);
			cursor = cut.endMs;
		}
		if (sourceEnd > cursor) pushPiece({ startMs: cursor, endMs: sourceEnd }, true);
	}

	// Never empty the timeline: a recording that is all silence is left alone.
	if (kept.length === 0) return { split: sorted, after: sorted, removedCount: 0, removedMs: 0 };
	return { split, after: packClipSequence(kept), removedCount, removedMs };
}
