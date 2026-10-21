import { createContext, useContext } from "react";

export const TIMELINE_ROW_SCALE_STEPS = [1, 1.5, 2] as const;
export type TimelineRowScale = (typeof TIMELINE_ROW_SCALE_STEPS)[number];
export const DEFAULT_TIMELINE_ROW_SCALE: TimelineRowScale = 1;

// Lets the user make every track taller without touching the fixed pixel
// layout the rows and the canvas share; both read the same factor from here.
const TimelineRowScaleContext = createContext<TimelineRowScale>(DEFAULT_TIMELINE_ROW_SCALE);

export const TimelineRowScaleProvider = TimelineRowScaleContext.Provider;

export function useTimelineRowScale(): TimelineRowScale {
	return useContext(TimelineRowScaleContext);
}

export function normalizeTimelineRowScale(value: unknown): TimelineRowScale {
	const match = TIMELINE_ROW_SCALE_STEPS.find((step) => step === value);
	return match ?? DEFAULT_TIMELINE_ROW_SCALE;
}

export function stepTimelineRowScale(current: TimelineRowScale, direction: 1 | -1) {
	const index = TIMELINE_ROW_SCALE_STEPS.indexOf(current);
	const next = Math.min(
		TIMELINE_ROW_SCALE_STEPS.length - 1,
		Math.max(0, (index < 0 ? 0 : index) + direction),
	);
	return TIMELINE_ROW_SCALE_STEPS[next];
}
