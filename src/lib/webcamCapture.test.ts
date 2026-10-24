import { describe, expect, it } from "vitest";
import {
	WEBCAM_FRAME_RATE,
	WEBCAM_HEIGHT,
	WEBCAM_WIDTH,
	webcamVideoConstraints,
} from "./webcamCapture";

describe("webcamVideoConstraints", () => {
	it("asks for the full recording mode", () => {
		expect(webcamVideoConstraints()).toEqual({
			width: { ideal: WEBCAM_WIDTH },
			height: { ideal: WEBCAM_HEIGHT },
			frameRate: { ideal: WEBCAM_FRAME_RATE, max: WEBCAM_FRAME_RATE },
		});
	});

	it("pins the chosen camera", () => {
		expect(webcamVideoConstraints("cam-1").deviceId).toEqual({ exact: "cam-1" });
	});

	it("is the same for the preview and the recorder of one camera", () => {
		expect(webcamVideoConstraints("cam-1")).toEqual(webcamVideoConstraints("cam-1"));
	});
});
