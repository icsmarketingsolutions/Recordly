export interface GpuFeatureSnapshot {
	webgl?: string | null;
	webgpu?: string | null;
	videoEncode?: string | null;
	videoDecode?: string | null;
}

// Chromium reports a feature as "*_software" once the GPU process has given up on
// hardware acceleration (driver reset, sleep/resume, a crashed GPU process). The
// renderer keeps working, but every export frame is then drawn on the CPU and a
// 1080p export crawls at one or two frames per second. Restarting Recordly fixes it.
export function isGpuRunningInSoftware(features: GpuFeatureSnapshot | null | undefined) {
	if (!features) return false;
	const webgl = features.webgl ?? "";
	return /software/i.test(webgl) || webgl === "disabled_off" || webgl === "unavailable_off";
}

export async function readGpuRunsInSoftware(): Promise<boolean> {
	try {
		if (typeof window === "undefined" || !window.electronAPI?.getExportHardwareInfo)
			return false;
		const result = await window.electronAPI.getExportHardwareInfo();
		return result.success ? isGpuRunningInSoftware(result.hardware?.gpuFeatures) : false;
	} catch {
		return false;
	}
}
