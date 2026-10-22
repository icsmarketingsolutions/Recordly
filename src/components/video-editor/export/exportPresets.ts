import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "@/lib/exporter";

export type ExportPresetId = "instagram" | "youtube" | "whatsapp";

export interface ExportPreset {
	id: ExportPresetId;
	aspectRatio: AspectRatio;
	quality: ExportQuality;
	frameRate: ExportMp4FrameRate;
	encodingMode: ExportEncodingMode;
}

/** One-click MP4 setups for the places Isaac publishes to. */
export const EXPORT_PRESETS: readonly ExportPreset[] = [
	{ id: "instagram", aspectRatio: "9:16", quality: "source", frameRate: 30, encodingMode: "balanced" },
	{ id: "youtube", aspectRatio: "16:9", quality: "source", frameRate: 60, encodingMode: "quality" },
	{ id: "whatsapp", aspectRatio: "native", quality: "medium", frameRate: 30, encodingMode: "fast" },
];
