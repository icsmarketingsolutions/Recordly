import {
	computeGazeWarps,
	type EyeWarp,
	extractEyes,
	GAZE_LANDMARK_INDICES,
	gazeCorrectionFade,
	type Point,
} from "./gaze";
import { CameraFxRenderer } from "./renderer";
import {
	type CameraFxSettings,
	cameraFxNeedsFace,
	cameraFxNeedsSegmentation,
	isCameraFxActive,
} from "./settings";
import { OneEuroFilter, OneEuroVectorFilter } from "./smoothing";
import { detect, loadVisionTasks, type VisionDetection, type VisionTasks } from "./vision";

/**
 * Stateful per-stream processor: detection → temporal smoothing → GPU render.
 * One engine must see one stream's frames in order (preview or bake), because
 * the landmark and mask filters carry history between frames.
 */
export class CameraFxEngine {
	private tasks: VisionTasks | null = null;
	private renderer: CameraFxRenderer | null = null;
	private readonly landmarkFilter = new OneEuroVectorFilter(1.4, 0.015);
	private readonly fadeFilter = new OneEuroFilter(2, 0);
	private smoothedMask: Float32Array | null = null;
	private lastMask: { data: Uint8Array; width: number; height: number } | null = null;
	private lastEyes: ReturnType<typeof extractEyes> = [];
	private lastFade = 0;
	private lastTimeMs: number | null = null;
	private analyzedFace = false;
	private analyzedMask = false;

	async init() {
		this.tasks = await loadVisionTasks();
	}

	/** Clears temporal history; call after a seek in the preview. */
	reset() {
		this.landmarkFilter.reset();
		this.fadeFilter.reset();
		this.smoothedMask = null;
		this.lastMask = null;
		this.lastEyes = [];
		this.lastFade = 0;
		this.lastTimeMs = null;
		this.analyzedFace = false;
		this.analyzedMask = false;
	}

	/**
	 * Detects on `frame` (unless `reuseDetection` and the cached analysis is for
	 * the same frame) and renders the effects. Returns the output canvas, which
	 * is reused between calls.
	 */
	process(
		frame: TexImageSource,
		width: number,
		height: number,
		timeMs: number,
		fx: CameraFxSettings,
		options: { reuseDetection?: boolean } = {},
	): HTMLCanvasElement {
		const renderer = this.prepare(width, height);
		const needsFace = cameraFxNeedsFace(fx);
		const needsMask = cameraFxNeedsSegmentation(fx);
		const canReuse =
			options.reuseDetection &&
			this.lastTimeMs === timeMs &&
			(!needsFace || this.analyzedFace) &&
			(!needsMask || this.analyzedMask);

		if (isCameraFxActive(fx) && this.tasks && !canReuse) {
			this.analyze(
				detect(this.tasks, frame, { face: needsFace, segmentation: needsMask }),
				width,
				height,
				timeMs,
			);
			this.analyzedFace = needsFace;
			this.analyzedMask = needsMask;
		}

		const eyes: EyeWarp[] =
			needsFace && this.lastEyes.length === 2
				? computeGazeWarps(this.lastEyes, fx.gazeCorrection, this.lastFade)
				: [];
		renderer.render(frame, { fx, mask: needsMask ? this.lastMask : null, eyes });
		return renderer.canvas;
	}

	/** Output canvas for a given frame size (recreated, with history cleared, on resize). */
	prepare(width: number, height: number): CameraFxRenderer {
		if (!this.renderer || this.renderer.width !== width || this.renderer.height !== height) {
			this.renderer?.dispose();
			this.renderer = new CameraFxRenderer(width, height);
			this.reset();
		}
		return this.renderer;
	}

	dispose() {
		this.renderer?.dispose();
		this.renderer = null;
	}

	private analyze(detection: VisionDetection, width: number, height: number, timeMs: number) {
		this.lastTimeMs = timeMs;

		if (detection.landmarks) {
			const raw: number[] = [];
			for (const index of GAZE_LANDMARK_INDICES) {
				const point = detection.landmarks[index];
				raw.push(point.x * width, point.y * height);
			}
			const smoothed = this.landmarkFilter.filter(raw, timeMs);
			const lookup = new Map<number, Point>();
			GAZE_LANDMARK_INDICES.forEach((index, position) => {
				lookup.set(index, { x: smoothed[position * 2], y: smoothed[position * 2 + 1] });
			});
			this.lastEyes = extractEyes((index) => lookup.get(index) ?? { x: 0, y: 0 });
			this.lastFade = this.fadeFilter.filter(gazeCorrectionFade(this.lastEyes), timeMs);
		} else {
			// Face lost: let the correction fade out instead of popping.
			this.lastFade = this.fadeFilter.filter(0, timeMs);
			if (this.lastFade < 0.02) {
				this.lastEyes = [];
				this.landmarkFilter.reset();
			}
		}

		if (detection.personMask) {
			const { data, width: maskWidth, height: maskHeight } = detection.personMask;
			if (!this.smoothedMask || this.smoothedMask.length !== data.length) {
				this.smoothedMask = data.slice();
			} else {
				// Adaptive temporal smoothing: calm edges stay stable, real motion
				// follows immediately so there is no ghosting.
				for (let index = 0; index < data.length; index += 1) {
					const previous = this.smoothedMask[index];
					const delta = data[index] - previous;
					const response = Math.min(1, 0.45 + Math.abs(delta) * 1.5);
					this.smoothedMask[index] = previous + delta * response;
				}
			}
			const bytes = new Uint8Array(data.length);
			for (let index = 0; index < data.length; index += 1) {
				bytes[index] = Math.round(Math.min(1, Math.max(0, this.smoothedMask[index])) * 255);
			}
			this.lastMask = { data: bytes, width: maskWidth, height: maskHeight };
		}
	}
}
