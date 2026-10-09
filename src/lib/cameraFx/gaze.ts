/**
 * Eye geometry from MediaPipe Face Mesh (478 landmarks, iris refined) and the
 * gaze-correction displacement the renderer applies inside each eye opening.
 *
 * All points are in image pixels with y pointing down.
 */
export interface Point {
	x: number;
	y: number;
}

export interface EyeGeometry {
	/** Closed contour of the eye opening, 16 points, starting at a corner. */
	polygon: Point[];
	iris: Point;
	irisRadius: number;
	/** Corner-to-corner distance. */
	width: number;
	/** Lid-to-lid distance divided by width. */
	openness: number;
}

export interface EyeWarp {
	polygon: Point[];
	iris: Point;
	irisRadius: number;
	/** Where the iris content moves to, in pixels. */
	shift: Point;
}

/** Ordered contours: corner → upper lid → other corner → lower lid. */
export const EYE_CONTOURS = [
	[33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
	[263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
] as const;
export const IRIS_LANDMARKS = [
	[468, 469, 470, 471, 472],
	[473, 474, 475, 476, 477],
] as const;
export const EYE_POLYGON_SIZE = 16;
const UPPER_LID_INDEX = 4;
const LOWER_LID_INDEX = 12;
const OPPOSITE_CORNER_INDEX = 8;

/** Landmark indices the engine smooths; everything else is ignored. */
export const GAZE_LANDMARK_INDICES: number[] = [
	...EYE_CONTOURS[0],
	...EYE_CONTOURS[1],
	...IRIS_LANDMARKS[0],
	...IRIS_LANDMARKS[1],
];

/** Full gaze correction up to this horizontal look-away; fades out by 2x. */
const LOOK_AWAY_START = 0.1;
const LOOK_AWAY_END = 0.2;
const BLINK_CLOSED = 0.13;
const BLINK_OPEN = 0.21;
/**
 * Vertical gaze can't be read reliably from 2D landmarks (lids follow the iris),
 * but webcams sit above the screen, so looking at the screen always reads as
 * looking slightly down. The fix is a constant lift, in iris radii.
 */
const LIFT_IRIS_RATIO = 0.4;
const HORIZONTAL_GAIN = 0.85;
/** Never move the iris more than this fraction of its own radius. */
const MAX_SHIFT_IRIS_RATIO = 0.65;

export function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

function distance(a: Point, b: Point) {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: readonly Point[]): Point {
	let x = 0;
	let y = 0;
	for (const point of points) {
		x += point.x;
		y += point.y;
	}
	return { x: x / points.length, y: y / points.length };
}

/**
 * `points` maps a landmark index to a pixel position (only the indices in
 * {@link GAZE_LANDMARK_INDICES} are read). Iris rings are matched to the eye
 * whose opening is closest, so the result never depends on left/right naming.
 */
export function extractEyes(points: (index: number) => Point): EyeGeometry[] {
	const polygons = EYE_CONTOURS.map((contour) => contour.map((index) => points(index)));
	const irises = IRIS_LANDMARKS.map((ring) => {
		const center = points(ring[0]);
		const radius =
			ring.slice(1).reduce((sum, index) => sum + distance(points(index), center), 0) /
			(ring.length - 1);
		return { center, radius };
	});
	const centers = polygons.map(centroid);
	const swap =
		distance(irises[0].center, centers[0]) + distance(irises[1].center, centers[1]) >
		distance(irises[0].center, centers[1]) + distance(irises[1].center, centers[0]);

	return polygons.map((polygon, eyeIndex) => {
		const iris = irises[swap ? 1 - eyeIndex : eyeIndex];
		const width = Math.max(1e-3, distance(polygon[0], polygon[OPPOSITE_CORNER_INDEX]));
		return {
			polygon,
			iris: iris.center,
			irisRadius: Math.max(0.5, iris.radius),
			width,
			openness: distance(polygon[UPPER_LID_INDEX], polygon[LOWER_LID_INDEX]) / width,
		};
	});
}

/** Unit axis along the eye (x > 0) and its normal pointing down the image. */
function eyeAxes(eye: EyeGeometry) {
	const a = eye.polygon[0];
	const b = eye.polygon[OPPOSITE_CORNER_INDEX];
	let ux = (b.x - a.x) / eye.width;
	let uy = (b.y - a.y) / eye.width;
	if (ux < 0) {
		ux = -ux;
		uy = -uy;
	}
	return {
		u: { x: ux, y: uy },
		v: { x: -uy, y: ux },
		mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
	};
}

/** Sideways iris position (−left … +right), averaged over both eyes, in eye widths. */
export function measureHorizontalGaze(eyes: EyeGeometry[]): number {
	let horizontal = 0;
	for (const eye of eyes) {
		const { u, mid } = eyeAxes(eye);
		horizontal += ((eye.iris.x - mid.x) * u.x + (eye.iris.y - mid.y) * u.y) / eye.width;
	}
	return horizontal / eyes.length;
}

/**
 * How much correction is allowed this frame: none during blinks, strong head
 * turns or deliberate look-aways, so the effect never looks like a stare.
 */
export function gazeCorrectionFade(eyes: EyeGeometry[]): number {
	if (eyes.length === 0) return 0;
	const openness = Math.min(...eyes.map((eye) => eye.openness));
	const widths = eyes.map((eye) => eye.width);
	const turnRatio = Math.min(...widths) / Math.max(...widths);
	const horizontal = measureHorizontalGaze(eyes);
	return (
		smoothstep(BLINK_CLOSED, BLINK_OPEN, openness) *
		smoothstep(0.55, 0.72, turnRatio) *
		(1 - smoothstep(LOOK_AWAY_START, LOOK_AWAY_END, Math.abs(horizontal)))
	);
}

/**
 * Both eyes get the same normalised correction so they stay converged: the
 * sideways glance is pulled back toward the centre and the iris is lifted.
 */
export function computeGazeWarps(eyes: EyeGeometry[], strength: number, fade: number): EyeWarp[] {
	const amount = Math.min(1, Math.max(0, strength)) * Math.min(1, Math.max(0, fade));
	const along = -measureHorizontalGaze(eyes) * HORIZONTAL_GAIN;

	return eyes.map((eye) => {
		const { u, v } = eyeAxes(eye);
		const sideways = along * eye.width;
		const lift = -LIFT_IRIS_RATIO * eye.irisRadius;
		let x = (sideways * u.x + lift * v.x) * amount;
		let y = (sideways * u.y + lift * v.y) * amount;
		const length = Math.hypot(x, y);
		const limit = eye.irisRadius * MAX_SHIFT_IRIS_RATIO;
		if (length > limit) {
			x *= limit / length;
			y *= limit / length;
		}
		return {
			polygon: eye.polygon,
			iris: eye.iris,
			irisRadius: eye.irisRadius,
			shift: { x, y },
		};
	});
}
