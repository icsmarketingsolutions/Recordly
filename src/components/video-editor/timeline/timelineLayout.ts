export const TIMELINE_AXIS_HEIGHT_PX = 20;
export const TIMELINE_ROW_MIN_HEIGHT_PX = 32;
export const TIMELINE_CLIP_ROW_HEIGHT_PX = TIMELINE_ROW_MIN_HEIGHT_PX * 2;

// The user can make every track taller (see timelineRowScale); the clip row and
// the effect rows scale together so the layout math stays consistent.
export function getTimelineRowHeightPx(scale = 1) {
	return Math.round(TIMELINE_ROW_MIN_HEIGHT_PX * scale);
}

export function getTimelineClipRowHeightPx(scale = 1) {
	return getTimelineRowHeightPx(scale) * 2;
}

function normalizeRowCount(rowCount: number) {
	if (!Number.isFinite(rowCount)) {
		return 0;
	}

	return Math.max(0, Math.floor(rowCount));
}

export function getTimelineRowsMinHeightPx(rowCount: number, scale = 1) {
	const count = normalizeRowCount(rowCount);
	// Clip stays full height. Zoom shares its space only when another lane exists.
	return count
		? getTimelineClipRowHeightPx(scale) +
				(count === 2 ? 2 : count - 1) * getTimelineRowHeightPx(scale) +
				count * 2
		: 0;
}

export function getTimelineContentMinHeightPx(rowCount: number, scale = 1) {
	return TIMELINE_AXIS_HEIGHT_PX + getTimelineRowsMinHeightPx(rowCount, scale);
}
