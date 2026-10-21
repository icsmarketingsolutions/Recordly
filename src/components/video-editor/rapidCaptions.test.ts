import { describe, expect, it, vi } from "vitest";
import { buildActiveCaptionLayout } from "./captionLayout";
import { normalizeProjectEditor } from "./projectPersistence";
import {
	initialCaptionSettings,
	loadCaptionGenerationDefaults,
	saveCaptionGenerationDefaults,
	splitRapidCaptions,
} from "./rapidCaptions";
import type { CaptionCue } from "./types";

const text = "esto cómo funciona donde lo hacemos así y estás";
const cue: CaptionCue = {
	id: "caption-1",
	text,
	startMs: 1000,
	endMs: 5500,
	words: text.split(" ").map((text, i) => ({
		text,
		startMs: 1000 + i * 500,
		endMs: 1400 + i * 500,
		leadingSpace: i > 0,
	})),
};

describe("rapid captions", () => {
	it("requires real word times in production instead of silently distributing text", () => {
		expect(() => splitRapidCaptions([{ ...cue, words: undefined }], 3, true)).toThrow(
			/Regenerate Captions/,
		);
		expect(splitRapidCaptions([cue], 3, true)[1].startMs).toBe(2500);
	});
	it("keeps every word and its real timing in short, unique blocks", () => {
		const result = splitRapidCaptions([cue], 3);
		expect(result.map((c) => c.text)).toEqual([
			"esto cómo funciona",
			"donde lo hacemos",
			"así y estás",
		]);
		expect(result.map((c) => [c.startMs, c.endMs])).toEqual([
			[1000, 2400],
			[2500, 3900],
			[4000, 5400],
		]);
		expect(new Set(result.map((c) => c.id)).size).toBe(3);
		expect(cue.words?.[3].leadingSpace).toBe(true);
	});
	it("estimates timing for SRT without losing text or exceeding the source span", () => {
		const result = splitRapidCaptions([{ ...cue, words: undefined }], 2);
		expect(result.map((c) => c.text).join(" ")).toBe(text);
		expect(result.every((c) => c.text.split(" ").length <= 2 && c.endMs > c.startMs)).toBe(
			true,
		);
		expect(result[0].startMs).toBe(cue.startMs);
		expect(result[result.length - 1].endMs).toBe(cue.endMs);
		expect(result.every((c) => !c.words)).toBe(true);
	});
	it("breaks at pauses and punctuation, and preserves edited text", () => {
		const input = {
			...cue,
			words: cue.words!.map((w, i) => ({
				...w,
				startMs: w.startMs + (i >= 2 ? 800 : 0),
				endMs: w.endMs + (i >= 2 ? 800 : 0),
			})),
			endMs: 6500,
		};
		expect(splitRapidCaptions([input], 6)[0].text).toBe("esto cómo");
		const edited = { ...cue, text: "Texto corregido. Sigue aquí" };
		expect(splitRapidCaptions([edited], 6).map((c) => c.text)).toEqual([
			"Texto corregido.",
			"Sigue aquí",
		]);
	});
	it("falls back for overlapping or invalid word times", () => {
		const bad = {
			...cue,
			words: cue.words!.map((w) => ({ ...w, startMs: 1000, endMs: 2000 })),
		};
		const result = splitRapidCaptions([bad], 3);
		expect(result.map((c) => c.text).join(" ")).toBe(text);
		expect(result.every((c, i) => i === 0 || c.startMs >= result[i - 1].endMs)).toBe(true);
	});
	it("renders consecutive groups independently in preview and export layout", () => {
		const cues = splitRapidCaptions([cue], 3);
		const settings = initialCaptionSettings();
		for (const [timeMs, expected] of [
			[1300, "esto cómo funciona"],
			[2800, "donde lo hacemos"],
			[4300, "así y estás"],
		] as const) {
			const layout = buildActiveCaptionLayout({
				cues,
				timeMs,
				settings,
				maxWidthPx: 1000,
				measureText: (t) => t.length * 10,
			});
			expect(layout?.editTarget.text).toBe(expected);
			expect(layout?.opacity).toBe(1);
		}
	});
	it("remembers the mode for new videos and round-trips it through presets/projects", () => {
		const settings = {
			...initialCaptionSettings(),
			segmentationMode: "rapid" as const,
			wordsPerCaption: 2,
		};
		const values = new Map<string, unknown>();
		vi.stubGlobal("electronAPI", {
			getAppSetting: (key: string) => values.get(key),
			setAppSetting: (key: string, value: unknown) => {
				values.set(key, value);
				return true;
			},
		});
		try {
			expect(saveCaptionGenerationDefaults(settings)).toBe(true);
			expect(loadCaptionGenerationDefaults().wordsPerCaption).toBe(2);
			expect(initialCaptionSettings().wordsPerCaption).toBe(2);
			expect(
				normalizeProjectEditor({ autoCaptionSettings: settings }).autoCaptionSettings,
			).toMatchObject({ segmentationMode: "rapid", wordsPerCaption: 2 });
			expect(saveCaptionGenerationDefaults({ ...settings, segmentationMode: "phrase" })).toBe(
				true,
			);
			expect(initialCaptionSettings().segmentationMode).toBe("phrase");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
