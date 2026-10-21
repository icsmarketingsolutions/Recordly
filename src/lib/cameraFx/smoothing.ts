/**
 * One Euro filter (Casiez et al. 2012): heavy smoothing while still, low lag
 * while moving. Used on facial landmarks so the eye warp never shimmers.
 */
export class OneEuroFilter {
	private previous: number | null = null;
	private previousDerivative = 0;
	private previousTimeMs: number | null = null;

	constructor(
		private readonly minCutoff = 1.2,
		private readonly beta = 0.02,
		private readonly derivativeCutoff = 1,
	) {}

	reset() {
		this.previous = null;
		this.previousDerivative = 0;
		this.previousTimeMs = null;
	}

	filter(value: number, timeMs: number): number {
		if (this.previous === null || this.previousTimeMs === null) {
			this.previous = value;
			this.previousTimeMs = timeMs;
			return value;
		}

		const dt = Math.max(1e-3, (timeMs - this.previousTimeMs) / 1000);
		// A backwards seek or a long gap means the history no longer applies.
		if (timeMs < this.previousTimeMs || dt > 0.5) {
			this.reset();
			return this.filter(value, timeMs);
		}

		const derivative = (value - this.previous) / dt;
		const smoothedDerivative = lerp(
			this.previousDerivative,
			derivative,
			smoothingFactor(dt, this.derivativeCutoff),
		);
		const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
		const smoothed = lerp(this.previous, value, smoothingFactor(dt, cutoff));

		this.previous = smoothed;
		this.previousDerivative = smoothedDerivative;
		this.previousTimeMs = timeMs;
		return smoothed;
	}
}

/** Smooths a fixed-length vector of numbers with one filter per component. */
export class OneEuroVectorFilter {
	private filters: OneEuroFilter[] = [];

	constructor(
		private readonly minCutoff = 1.2,
		private readonly beta = 0.02,
	) {}

	reset() {
		this.filters = [];
	}

	filter(values: number[], timeMs: number): number[] {
		if (this.filters.length !== values.length) {
			this.filters = values.map(() => new OneEuroFilter(this.minCutoff, this.beta));
		}
		return values.map((value, index) => this.filters[index].filter(value, timeMs));
	}
}

function smoothingFactor(dtSeconds: number, cutoffHz: number) {
	const tau = 1 / (2 * Math.PI * cutoffHz);
	return 1 / (1 + tau / dtSeconds);
}

function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t;
}
