import { describe, expect, it } from "vitest";
import {
	clampTimelinePanelHeight,
	TIMELINE_PANEL_DEFAULT_HEIGHT_PX,
	TIMELINE_PANEL_MIN_HEIGHT_PX,
} from "./useTimelinePanelLayout";
import { stepTimelineRowScale, normalizeTimelineRowScale } from "../timeline/timelineRowScale";

describe("timeline panel layout", () => {
	it("clamps the panel height between the minimum and a share of the viewport", () => {
		expect(clampTimelinePanelHeight(50, 1000)).toBe(TIMELINE_PANEL_MIN_HEIGHT_PX);
		expect(clampTimelinePanelHeight(400, 1000)).toBe(400);
		expect(clampTimelinePanelHeight(900, 1000)).toBe(650);
		expect(clampTimelinePanelHeight(Number.NaN, 1000)).toBe(TIMELINE_PANEL_DEFAULT_HEIGHT_PX);
	});

	it("steps the row scale through the fixed sizes without leaving them", () => {
		expect(stepTimelineRowScale(1, 1)).toBe(1.5);
		expect(stepTimelineRowScale(1.5, 1)).toBe(2);
		expect(stepTimelineRowScale(2, 1)).toBe(2);
		expect(stepTimelineRowScale(1, -1)).toBe(1);
		expect(normalizeTimelineRowScale(3)).toBe(1);
		expect(normalizeTimelineRowScale(1.5)).toBe(1.5);
	});
});
