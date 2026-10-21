import { describe, expect, it } from "vitest";
import { isGpuRunningInSoftware } from "./gpuHealth";

describe("isGpuRunningInSoftware", () => {
	it("flags software and disabled WebGL", () => {
		expect(isGpuRunningInSoftware({ webgl: "disabled_software" })).toBe(true);
		expect(isGpuRunningInSoftware({ webgl: "unavailable_software" })).toBe(true);
		expect(isGpuRunningInSoftware({ webgl: "disabled_off" })).toBe(true);
	});

	it("accepts hardware WebGL and missing data", () => {
		expect(isGpuRunningInSoftware({ webgl: "enabled" })).toBe(false);
		expect(isGpuRunningInSoftware({ webgl: null })).toBe(false);
		expect(isGpuRunningInSoftware(null)).toBe(false);
	});
});
