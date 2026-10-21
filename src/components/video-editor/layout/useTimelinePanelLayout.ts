import { useCallback, useEffect, useRef, useState } from "react";
import {
	DEFAULT_TIMELINE_ROW_SCALE,
	normalizeTimelineRowScale,
	stepTimelineRowScale,
	type TimelineRowScale,
} from "../timeline/timelineRowScale";

export const TIMELINE_PANEL_DEFAULT_HEIGHT_PX = 220;
export const TIMELINE_PANEL_MIN_HEIGHT_PX = 150;
// Leaves room for the header and a usable preview above the timeline.
const TIMELINE_PANEL_MAX_VIEWPORT_FRACTION = 0.65;
const STORAGE_KEY = "recordly.editor.timeline-layout";

interface StoredTimelineLayout {
	heightPx?: unknown;
	rowScale?: unknown;
}

export function clampTimelinePanelHeight(heightPx: number, viewportHeight: number) {
	const max = Math.max(
		TIMELINE_PANEL_MIN_HEIGHT_PX,
		Math.floor(viewportHeight * TIMELINE_PANEL_MAX_VIEWPORT_FRACTION),
	);
	if (!Number.isFinite(heightPx)) return TIMELINE_PANEL_DEFAULT_HEIGHT_PX;
	return Math.min(max, Math.max(TIMELINE_PANEL_MIN_HEIGHT_PX, Math.round(heightPx)));
}

function readStoredLayout(): { heightPx: number; rowScale: TimelineRowScale } {
	const fallback = {
		heightPx: TIMELINE_PANEL_DEFAULT_HEIGHT_PX,
		rowScale: DEFAULT_TIMELINE_ROW_SCALE,
	};
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as StoredTimelineLayout;
		return {
			heightPx:
				typeof parsed.heightPx === "number"
					? clampTimelinePanelHeight(parsed.heightPx, window.innerHeight)
					: fallback.heightPx,
			rowScale: normalizeTimelineRowScale(parsed.rowScale),
		};
	} catch {
		return fallback;
	}
}

function writeStoredLayout(layout: { heightPx: number; rowScale: TimelineRowScale }) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
	} catch {
		// A blocked storage only loses the remembered size.
	}
}

// Height of the timeline panel and the track scale, resized by dragging the bar
// above the timeline and remembered per machine (not part of the project).
export function useTimelinePanelLayout() {
	const [layout, setLayout] = useState(readStoredLayout);
	const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

	useEffect(() => {
		writeStoredLayout(layout);
	}, [layout]);

	useEffect(() => {
		const onResize = () =>
			setLayout((current) => {
				const heightPx = clampTimelinePanelHeight(current.heightPx, window.innerHeight);
				return heightPx === current.heightPx ? current : { ...current, heightPx };
			});
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const beginResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		dragRef.current = { startY: event.clientY, startHeight: 0 };
		setLayout((current) => {
			if (dragRef.current) dragRef.current.startHeight = current.heightPx;
			return current;
		});
	}, []);

	const moveResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		// The bar sits above the panel: dragging up makes the timeline taller.
		const nextHeight = drag.startHeight + (drag.startY - event.clientY);
		setLayout((current) => {
			const heightPx = clampTimelinePanelHeight(nextHeight, window.innerHeight);
			return heightPx === current.heightPx ? current : { ...current, heightPx };
		});
	}, []);

	const endResize = useCallback((event: React.PointerEvent<HTMLElement>) => {
		if (!dragRef.current) return;
		dragRef.current = null;
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	const resetHeight = useCallback(() => {
		setLayout((current) => ({ ...current, heightPx: TIMELINE_PANEL_DEFAULT_HEIGHT_PX }));
	}, []);

	const stepRowScale = useCallback((direction: 1 | -1) => {
		setLayout((current) => ({
			...current,
			rowScale: stepTimelineRowScale(current.rowScale, direction),
		}));
	}, []);

	return {
		heightPx: layout.heightPx,
		rowScale: layout.rowScale,
		beginResize,
		moveResize,
		endResize,
		resetHeight,
		stepRowScale,
	};
}
