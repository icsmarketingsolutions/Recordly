import { describe, expect, it } from "vitest";
import { rippleRegions } from "./clipSequence";
import { planSilenceRemoval } from "./silenceRemoval";
import { type ClipRegion, getClipSourceEndMs, getClipSourceStartMs } from "./types";

function createIdFactory() {
	let next = 100;
	return () => `clip-${next++}`;
}

const baseOptions = { minSilenceMs: 1000, padMs: 100, sourceDurationMs: 10_000 };

describe("planSilenceRemoval", () => {
	it("cuts a long pause out of the middle of a clip and packs the rest", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 };
		const plan = planSilenceRemoval([clip], [{ startMs: 4000, endMs: 6000 }], {
			...baseOptions,
			createId: createIdFactory(),
		});
		expect(plan.removedCount).toBe(1);
		expect(plan.removedMs).toBe(1800);
		expect(plan.after).toHaveLength(2);
		expect(plan.after[0]).toMatchObject({ id: "clip-1", startMs: 0, endMs: 4100 });
		expect(plan.after[1]).toMatchObject({ startMs: 4100, endMs: 8200 });
		expect(getClipSourceStartMs(plan.after[1])).toBe(5900);
		expect(getClipSourceEndMs(plan.after[1])).toBe(10_000);
		// The split sequence keeps the original positions so effects can ripple.
		expect(plan.split.map((piece) => [piece.startMs, piece.endMs])).toEqual([
			[0, 4100],
			[4100, 5900],
			[5900, 10_000],
		]);
	});

	it("ignores pauses shorter than the minimum and trims edges fully", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 };
		const plan = planSilenceRemoval(
			[clip],
			[
				{ startMs: 0, endMs: 1500 },
				{ startMs: 3000, endMs: 3500 },
				{ startMs: 8000, endMs: null },
			],
			{ ...baseOptions, createId: createIdFactory() },
		);
		expect(plan.removedCount).toBe(2);
		expect(plan.after).toEqual([
			{ id: "clip-1", startMs: 0, endMs: 6700, sourceStartMs: 1400, speed: 1 },
		]);
	});

	it("maps cuts through clip speed and keeps effects on the retained footage", () => {
		const clip: ClipRegion = {
			id: "clip-1",
			startMs: 0,
			endMs: 5000,
			sourceStartMs: 0,
			speed: 2,
		};
		const plan = planSilenceRemoval([clip], [{ startMs: 2000, endMs: 4000 }], {
			...baseOptions,
			createId: createIdFactory(),
		});
		// Source 2100–3900 is cut; at 2x that is timeline 1050–1950.
		expect(plan.after[0]).toMatchObject({ startMs: 0, endMs: 1050 });
		expect(plan.after[1]).toMatchObject({ startMs: 1050, endMs: 4100 });
		const zooms = rippleRegions(
			[{ id: "zoom-1", startMs: 3000, endMs: 4000 }],
			plan.split,
			plan.after,
		);
		expect(zooms).toEqual([{ id: "zoom-1", startMs: 2100, endMs: 3100 }]);
	});

	it("refuses to remove every piece of footage", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 4000, speed: 1 };
		const plan = planSilenceRemoval([clip], [{ startMs: 0, endMs: null }], {
			...baseOptions,
			createId: createIdFactory(),
		});
		expect(plan.removedCount).toBe(0);
		expect(plan.after).toEqual([clip]);
	});

	it("leaves clips untouched when nothing qualifies", () => {
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 3000, speed: 1 },
			{ id: "clip-2", startMs: 3000, endMs: 6000, sourceStartMs: 3000, speed: 1 },
		];
		const plan = planSilenceRemoval(clips, [{ startMs: 2950, endMs: 3050 }], {
			...baseOptions,
			createId: createIdFactory(),
		});
		expect(plan.removedCount).toBe(0);
		expect(plan.after).toEqual(clips);
	});
});
