import {
	ALL_FORMATS,
	BufferTarget,
	CanvasSource,
	canEncodeVideo,
	Input,
	Mp4OutputFormat,
	Output,
	UrlSource,
	VideoSampleSink,
} from "mediabunny";
import { CameraFxEngine } from "./engine";
import type { CameraFxSettings } from "./settings";

const OUTPUT_BITRATE = 8_000_000;
/** Frequent keyframes keep scrubbing the webcam layer in the editor snappy. */
const KEYFRAME_INTERVAL_SECONDS = 1;

export class CameraFxBakeCancelledError extends Error {
	constructor() {
		super("Camera effects processing was cancelled");
		this.name = "CameraFxBakeCancelledError";
	}
}

/**
 * Re-encodes a webcam clip with the effects burned in, frame by frame, keeping
 * every source timestamp so the layer stays in sync with the screen recording.
 * Runs faster than real time and never touches the source file.
 */
export async function bakeCameraFx(options: {
	sourceUrl: string;
	fx: CameraFxSettings;
	signal?: AbortSignal;
	onProgress?: (progress: number) => void;
}): Promise<ArrayBuffer> {
	const input = new Input({ source: new UrlSource(options.sourceUrl), formats: ALL_FORMATS });
	const engine = new CameraFxEngine();
	let output: Output | null = null;

	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error("The webcam file has no video track");
		const width = track.displayWidth;
		const height = track.displayHeight;
		const duration = Math.max(0.001, await track.computeDuration());

		await engine.init();
		const canvas = engine.prepare(width, height).canvas;
		const codec = (await canEncodeVideo("avc", { width, height, bitrate: OUTPUT_BITRATE }))
			? "avc"
			: "vp9";
		const target = new BufferTarget();
		output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
		const videoSource = new CanvasSource(canvas, {
			codec,
			bitrate: OUTPUT_BITRATE,
			keyFrameInterval: KEYFRAME_INTERVAL_SECONDS,
		});
		output.addVideoTrack(videoSource);
		await output.start();

		const sink = new VideoSampleSink(track);
		for await (const sample of sink.samples()) {
			try {
				if (options.signal?.aborted) throw new CameraFxBakeCancelledError();
				const frame = sample.toVideoFrame();
				try {
					engine.process(frame, width, height, sample.timestamp * 1000, options.fx);
				} finally {
					frame.close();
				}
				await videoSource.add(Math.max(0, sample.timestamp), sample.duration);
				options.onProgress?.(Math.min(1, sample.timestamp / duration));
			} finally {
				sample.close();
			}
		}

		await output.finalize();
		if (!target.buffer) throw new Error("Processed webcam video is empty");
		options.onProgress?.(1);
		return target.buffer;
	} catch (error) {
		if (output && output.state !== "finalized" && output.state !== "canceled") {
			await output.cancel().catch(() => undefined);
		}
		throw error;
	} finally {
		engine.dispose();
		input.dispose();
	}
}
