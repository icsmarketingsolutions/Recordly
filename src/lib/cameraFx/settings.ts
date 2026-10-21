/**
 * Camera effects applied to the webcam layer. Every value is a 0..1 strength so
 * the UI, presets and the GPU renderer share the same scale.
 */
export type CameraFxVeilTone = "dark" | "light";

export interface CameraFxSettings {
	/** Frosted background: how much the background behind the person is blurred. */
	backgroundBlur: number;
	/** Frosted background: opacity of the tinted veil laid over the background. */
	backgroundVeil: number;
	backgroundVeilTone: CameraFxVeilTone;
	/** Darkens the room around the person and adds a soft vignette. */
	ambientDarken: number;
	/** Redirects the gaze toward the camera; fades out on blinks and look-aways. */
	gazeCorrection: number;
	/** Removes redness from the whites of the eyes (and red pupils). */
	eyeRedness: number;
}

export const DEFAULT_CAMERA_FX: CameraFxSettings = {
	backgroundBlur: 0,
	backgroundVeil: 0,
	backgroundVeilTone: "dark",
	ambientDarken: 0,
	gazeCorrection: 0,
	eyeRedness: 0,
};

/** One-click starting point: noticeable but still natural. */
export const SUBTLE_CAMERA_FX: CameraFxSettings = {
	backgroundBlur: 0.55,
	backgroundVeil: 0.2,
	backgroundVeilTone: "dark",
	ambientDarken: 0.25,
	gazeCorrection: 0.6,
	eyeRedness: 0.5,
};

function unit(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(1, Math.max(0, value))
		: fallback;
}

export function normalizeCameraFxSettings(value: unknown): CameraFxSettings {
	const candidate = (value && typeof value === "object" ? value : {}) as Partial<
		Record<keyof CameraFxSettings, unknown>
	>;
	return {
		backgroundBlur: unit(candidate.backgroundBlur, DEFAULT_CAMERA_FX.backgroundBlur),
		backgroundVeil: unit(candidate.backgroundVeil, DEFAULT_CAMERA_FX.backgroundVeil),
		backgroundVeilTone: candidate.backgroundVeilTone === "light" ? "light" : "dark",
		ambientDarken: unit(candidate.ambientDarken, DEFAULT_CAMERA_FX.ambientDarken),
		gazeCorrection: unit(candidate.gazeCorrection, DEFAULT_CAMERA_FX.gazeCorrection),
		eyeRedness: unit(candidate.eyeRedness, DEFAULT_CAMERA_FX.eyeRedness),
	};
}

export function cameraFxNeedsSegmentation(fx: CameraFxSettings): boolean {
	return fx.backgroundBlur > 0 || fx.backgroundVeil > 0 || fx.ambientDarken > 0;
}

export function cameraFxNeedsFace(fx: CameraFxSettings): boolean {
	return fx.gazeCorrection > 0 || fx.eyeRedness > 0;
}

export function isCameraFxActive(fx: CameraFxSettings): boolean {
	return cameraFxNeedsSegmentation(fx) || cameraFxNeedsFace(fx);
}

export function areCameraFxEqual(a: CameraFxSettings, b: CameraFxSettings): boolean {
	return (
		a.backgroundBlur === b.backgroundBlur &&
		a.backgroundVeil === b.backgroundVeil &&
		a.backgroundVeilTone === b.backgroundVeilTone &&
		a.ambientDarken === b.ambientDarken &&
		a.gazeCorrection === b.gazeCorrection &&
		a.eyeRedness === b.eyeRedness
	);
}
