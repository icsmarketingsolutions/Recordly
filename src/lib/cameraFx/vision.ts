import type { FaceLandmarker, ImageSegmenter } from "@mediapipe/tasks-vision";

/**
 * Lazily loaded MediaPipe tasks. The runtime and models are bundled under
 * `camera-fx/` (see scripts/prepare-camera-fx-assets.mjs), so nothing is fetched
 * from the network at run time.
 */
export interface VisionTasks {
	faceLandmarker: FaceLandmarker;
	segmenter: ImageSegmenter;
}

export interface VisionDetection {
	/** Normalised landmarks (x, y in 0..1, y down) of the first face, if any. */
	landmarks: Array<{ x: number; y: number }> | null;
	/** Person confidence (0..1), row-major, top row first. */
	personMask: { data: Float32Array; width: number; height: number } | null;
}

let tasksPromise: Promise<VisionTasks> | null = null;
let lastTimestampMs = 0;

function assetUrl(relativePath: string) {
	return new URL(`./camera-fx/${relativePath}`, window.location.href).href;
}

async function createTasks(delegate: "GPU" | "CPU"): Promise<VisionTasks> {
	const { FaceLandmarker, ImageSegmenter } = await import("@mediapipe/tasks-vision");
	const fileset = {
		wasmLoaderPath: assetUrl("wasm/vision_wasm_internal.js"),
		wasmBinaryPath: assetUrl("wasm/vision_wasm_internal.wasm"),
	};
	const [faceLandmarker, segmenter] = await Promise.all([
		FaceLandmarker.createFromOptions(fileset, {
			baseOptions: { modelAssetPath: assetUrl("models/face_landmarker.task"), delegate },
			runningMode: "VIDEO",
			numFaces: 1,
			minFaceDetectionConfidence: 0.5,
			minFacePresenceConfidence: 0.5,
			minTrackingConfidence: 0.5,
			outputFaceBlendshapes: false,
			outputFacialTransformationMatrixes: false,
		}),
		ImageSegmenter.createFromOptions(fileset, {
			baseOptions: {
				modelAssetPath: assetUrl("models/selfie_multiclass_256x256.tflite"),
				delegate,
			},
			runningMode: "VIDEO",
			outputConfidenceMasks: true,
			outputCategoryMask: false,
		}),
	]);
	return { faceLandmarker, segmenter };
}

export function loadVisionTasks(): Promise<VisionTasks> {
	if (!tasksPromise) {
		tasksPromise = createTasks("GPU").catch((error) => {
			console.warn("[camera-fx] GPU delegate unavailable, using CPU:", error);
			return createTasks("CPU");
		});
		tasksPromise.catch(() => {
			tasksPromise = null;
		});
	}
	return tasksPromise;
}

/** MediaPipe VIDEO mode requires strictly increasing timestamps across calls. */
function nextTimestamp() {
	lastTimestampMs = Math.max(lastTimestampMs + 1, Math.floor(performance.now()));
	return lastTimestampMs;
}

export function detect(
	tasks: VisionTasks,
	frame: TexImageSource,
	options: { face: boolean; segmentation: boolean },
): VisionDetection {
	const timestamp = nextTimestamp();
	let landmarks: VisionDetection["landmarks"] = null;
	let personMask: VisionDetection["personMask"] = null;

	if (options.face) {
		const result = tasks.faceLandmarker.detectForVideo(frame, timestamp);
		const face = result.faceLandmarks[0];
		// Iris refinement adds landmarks 468-477; without them there is no gaze.
		if (face && face.length >= 478) {
			landmarks = face.map((point) => ({ x: point.x, y: point.y }));
		}
	}

	if (options.segmentation) {
		const result = tasks.segmenter.segmentForVideo(frame, timestamp);
		const masks = result.confidenceMasks ?? [];
		const background = masks[0];
		if (background) {
			const values = background.getAsFloat32Array();
			const data = new Float32Array(values.length);
			for (let index = 0; index < values.length; index += 1) {
				data[index] = 1 - values[index];
			}
			personMask = { data, width: background.width, height: background.height };
		}
		for (const mask of masks) mask.close();
	}

	return { landmarks, personMask };
}
