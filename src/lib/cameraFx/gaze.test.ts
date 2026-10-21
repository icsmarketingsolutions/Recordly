import { describe, expect, it } from "vitest";
import {
	computeGazeWarps,
	EYE_CONTOURS,
	extractEyes,
	gazeCorrectionFade,
	IRIS_LANDMARKS,
	type Point,
} from "./gaze";
import { normalizeCameraFxSettings, SUBTLE_CAMERA_FX } from "./settings";
import { OneEuroFilter } from "./smoothing";

/** Two almond-shaped eyes; the iris sits `irisOffset` (px) from the opening's centre. */
function makeFace({
	irisOffset = { x: 0, y: 0 },
	openness = 0.35,
	rightEyeScale = 1,
}: {
	irisOffset?: Point;
	openness?: number;
	rightEyeScale?: number;
} = {}) {
	const points = new Map<number, Point>();
	const eyes = [
		{ center: { x: 300, y: 300 }, width: 60 },
		{ center: { x: 420, y: 300 }, width: 60 * rightEyeScale },
	];
	eyes.forEach((eye, eyeIndex) => {
		const halfWidth = eye.width / 2;
		const halfHeight = (eye.width * openness) / 2;
		EYE_CONTOURS[eyeIndex].forEach((landmark, index) => {
			const angle = Math.PI - (index / EYE_CONTOURS[eyeIndex].length) * Math.PI * 2;
			points.set(landmark, {
				x: eye.center.x + Math.cos(angle) * halfWidth,
				y: eye.center.y - Math.sin(angle) * halfHeight,
			});
		});
		const iris = { x: eye.center.x + irisOffset.x, y: eye.center.y + irisOffset.y };
		const ring = IRIS_LANDMARKS[eyeIndex];
		points.set(ring[0], iris);
		ring.slice(1).forEach((landmark, index) => {
			const angle = (index / 4) * Math.PI * 2;
			points.set(landmark, {
				x: iris.x + Math.cos(angle) * 10,
				y: iris.y + Math.sin(angle) * 10,
			});
		});
	});
	return extractEyes((index) => points.get(index) ?? { x: 0, y: 0 });
}

describe("camera fx gaze correction", () => {
	it("measures eye width, openness and iris radius", () => {
		const [eye] = makeFace();
		expect(eye.width).toBeCloseTo(60, 5);
		expect(eye.openness).toBeCloseTo(0.35, 2);
		expect(eye.irisRadius).toBeCloseTo(10, 5);
	});

	it("lifts the iris toward a camera above the screen", () => {
		for (const warp of computeGazeWarps(makeFace(), 1, 1)) {
			expect(warp.shift.y).toBeCloseTo(-4, 5);
			expect(warp.shift.x).toBeCloseTo(0, 5);
		}
	});

	it("pulls a sideways glance back toward the centre and keeps both eyes converged", () => {
		const warps = computeGazeWarps(makeFace({ irisOffset: { x: 3, y: 0 } }), 1, 1);
		expect(warps[0].shift.x).toBeLessThan(0);
		expect(warps[0].shift.x).toBeCloseTo(warps[1].shift.x, 5);
	});

	it("caps the shift to a fraction of the iris radius", () => {
		const warps = computeGazeWarps(makeFace({ irisOffset: { x: 5, y: 8 } }), 1, 1);
		for (const warp of warps) {
			expect(Math.hypot(warp.shift.x, warp.shift.y)).toBeLessThanOrEqual(10 * 0.65 + 1e-9);
		}
	});

	it("scales with strength and disappears at zero", () => {
		const eyes = makeFace();
		const full = computeGazeWarps(eyes, 1, 1)[0].shift.y;
		expect(computeGazeWarps(eyes, 0.5, 1)[0].shift.y).toBeCloseTo(full / 2, 5);
		expect(computeGazeWarps(eyes, 0, 1)[0].shift.y).toBeCloseTo(0, 9);
	});

	it("fades out on blinks, look-aways and strong head turns", () => {
		expect(gazeCorrectionFade(makeFace())).toBeCloseTo(1, 5);
		expect(gazeCorrectionFade(makeFace({ openness: 0.08 }))).toBe(0);
		expect(gazeCorrectionFade(makeFace({ irisOffset: { x: 14, y: 0 } }))).toBe(0);
		expect(gazeCorrectionFade(makeFace({ rightEyeScale: 0.5 }))).toBe(0);
	});
});

describe("camera fx settings", () => {
	it("clamps and defaults unknown input", () => {
		expect(
			normalizeCameraFxSettings({
				backgroundBlur: 3,
				gazeCorrection: -1,
				backgroundVeilTone: "x",
			}),
		).toEqual({
			backgroundBlur: 1,
			backgroundVeil: 0,
			backgroundVeilTone: "dark",
			ambientDarken: 0,
			gazeCorrection: 0,
			eyeRedness: 0,
		});
		expect(normalizeCameraFxSettings(SUBTLE_CAMERA_FX)).toEqual(SUBTLE_CAMERA_FX);
	});
});

describe("one euro filter", () => {
	it("smooths jitter while still and resets after a backwards seek", () => {
		const filter = new OneEuroFilter(1.2, 0.02);
		filter.filter(100, 0);
		const jittered = filter.filter(104, 33);
		expect(jittered).toBeGreaterThan(100);
		expect(jittered).toBeLessThan(104);
		expect(filter.filter(50, 10)).toBe(50);
	});
});
