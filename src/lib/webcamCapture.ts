/**
 * Webcam capture settings shared by the live preview and the recorder.
 *
 * Chromium keeps one capture session per camera: whoever opens it first picks the
 * camera's mode and later streams get frames scaled from it. When the preview asked for
 * 320×320 the recording came out 640×360 even though it asked for 720p, so both must ask
 * for the same full-size mode and the preview just shows it small.
 */
export const WEBCAM_WIDTH = 1920;
export const WEBCAM_HEIGHT = 1080;
export const WEBCAM_FRAME_RATE = 30;
export const WEBCAM_BITRATE = 12_000_000;

export function webcamVideoConstraints(deviceId?: string | null): MediaTrackConstraints {
	return {
		...(deviceId ? { deviceId: { exact: deviceId } } : {}),
		width: { ideal: WEBCAM_WIDTH },
		height: { ideal: WEBCAM_HEIGHT },
		frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
	};
}
