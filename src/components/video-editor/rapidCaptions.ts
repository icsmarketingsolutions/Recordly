import { loadAppSetting, saveAppSetting } from "../../lib/appSettings";
import {
	DEFAULT_AUTO_CAPTION_SETTINGS,
	type AutoCaptionSettings,
	type CaptionCue,
	type CaptionCueWord,
} from "./types";

const STORAGE_KEY = "recordly.rapid-captions.v1";
export const RAPID_CAPTION_STYLE = {
	animationStyle: "pop",
	maxRows: 1,
	fontSize: 48,
	maxWidth: 62,
	bottomOffset: 7,
	backgroundOpacity: 0.55,
	boxRadius: 18,
} as const;

export function normalizeCaptionWordLimit(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(1, Math.min(6, Math.round(value)))
		: 3;
}

export function loadCaptionGenerationDefaults(): Pick<
	AutoCaptionSettings,
	"segmentationMode" | "wordsPerCaption"
> {
	const saved = loadAppSetting<Partial<AutoCaptionSettings>>(STORAGE_KEY);
	return {
		segmentationMode: saved?.segmentationMode === "phrase" ? "phrase" : "rapid",
		wordsPerCaption: normalizeCaptionWordLimit(saved?.wordsPerCaption),
	};
}

export function saveCaptionGenerationDefaults(settings: AutoCaptionSettings) {
	return saveAppSetting(STORAGE_KEY, {
		segmentationMode: settings.segmentationMode,
		wordsPerCaption: normalizeCaptionWordLimit(settings.wordsPerCaption),
	});
}

export function initialCaptionSettings(): AutoCaptionSettings {
	const defaults = loadCaptionGenerationDefaults();
	return {
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		...(defaults.segmentationMode === "rapid" ? RAPID_CAPTION_STYLE : {}),
		...defaults,
	};
}

/** Keep Whisper's word times; estimate only when the source has no usable word timing. */
export function splitRapidCaptions(
	cues: CaptionCue[],
	wordLimit = 3,
	requireTiming = false,
): CaptionCue[] {
	const limit = normalizeCaptionWordLimit(wordLimit);
	const result: CaptionCue[] = [];
	for (const cue of cues) {
		const textWords = cue.text.trim().split(/\s+/).filter(Boolean);
		if (
			!textWords.length ||
			!Number.isFinite(cue.startMs) ||
			!Number.isFinite(cue.endMs) ||
			cue.endMs <= cue.startMs
		)
			continue;
		const realTiming = Boolean(
			cue.words?.length &&
				cue.words.every(
					(w, i, all) =>
						Number.isFinite(w.startMs) &&
						Number.isFinite(w.endMs) &&
						w.endMs > w.startMs &&
						(i === 0 || w.startMs >= all[i - 1].endMs),
				) &&
				cue.words.map((w) => w.text.trim()).join(" ") === textWords.join(" "),
		);
		if (requireTiming && !realTiming)
			throw new Error(
				"Estos subtítulos no tienen tiempos válidos por palabra. Pulsa Regenerate Captions para sincronizarlos con el audio.",
			);
		const words: CaptionCueWord[] = realTiming
			? cue.words!.map((w) => ({ ...w }))
			: textWords.map((text, i) => ({
					text,
					startMs: cue.startMs + ((cue.endMs - cue.startMs) * i) / textWords.length,
					endMs: cue.startMs + ((cue.endMs - cue.startMs) * (i + 1)) / textWords.length,
					leadingSpace: i > 0,
				}));
		let group: CaptionCueWord[] = [];
		const flush = () => {
			if (!group.length) return;
			const startMs = Math.max(
				cue.startMs,
				group[0].startMs,
				result[result.length - 1]?.endMs ?? 0,
			);
			const endMs = Math.min(cue.endMs, group[group.length - 1].endMs);
			if (endMs > startMs)
				result.push({
					id: `${cue.id}-rapid-${result.length + 1}`,
					text: group.map((w) => w.text.trim()).join(" "),
					startMs,
					endMs,
					...(realTiming
						? { words: group.map((w, i) => ({ ...w, leadingSpace: i > 0 })) }
						: {}),
				});
			group = [];
		};
		for (const word of words) {
			const previous = group[group.length - 1];
			if (previous && word.startMs - previous.endMs >= 400) flush();
			group.push(word);
			if (group.length >= limit || /[.!?…]$/.test(word.text)) flush();
		}
		flush();
	}
	return result;
}
