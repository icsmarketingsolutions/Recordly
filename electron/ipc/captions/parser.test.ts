import { describe, expect, it } from "vitest";
import { parseWhisperJsonCues, parseWhisperJsonWords } from "./parser";

describe("Whisper word timing metadata", () => {
	it("ignores zero-length control markers without losing actual word times", () => {
		const tokens = [
			{ text: "[_BEG_]", offsets: { from: 0, to: 0 } },
			{ text: " prob", offsets: { from: 240, to: 740 } },
			{ text: "ando", offsets: { from: 770, to: 1490 } },
			{ text: " uno", offsets: { from: 2990, to: 3320 } },
			{ text: "[_TT_820]", offsets: { from: 8200, to: 8200 } },
			{ text: "[_EOT_]", offsets: { from: 8200, to: 8200 } },
		];
		expect(parseWhisperJsonWords(tokens)).toEqual([
			{ text: "probando", startMs: 240, endMs: 1490 },
			{ text: "uno", startMs: 2990, endMs: 3320, leadingSpace: true },
		]);
		const cues = parseWhisperJsonCues(
			JSON.stringify({
				transcription: [{ text: "probando uno", offsets: { from: 0, to: 8200 }, tokens }],
			}),
		);
		expect(cues[0].words).toHaveLength(2);
	});
	it("does not accept missing timing on an actual speech token", () => {
		expect(parseWhisperJsonWords([{ text: " palabra", offsets: { from: 0, to: 0 } }])).toEqual(
			[],
		);
	});
});
