import type { PointerEvent } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import { TIMELINE_ROW_SCALE_STEPS, type TimelineRowScale } from "../timeline/timelineRowScale";

interface Props {
	t: ReturnType<typeof useI18n>["t"];
	rowScale: TimelineRowScale;
	onPointerDown: (event: PointerEvent<HTMLElement>) => void;
	onPointerMove: (event: PointerEvent<HTMLElement>) => void;
	onPointerUp: (event: PointerEvent<HTMLElement>) => void;
	onReset: () => void;
	onStepRowScale: (direction: 1 | -1) => void;
}

// A thin grab bar between the preview and the timeline: drag it to give the
// tracks more room, double-click to go back, and use the +/− at the right end to
// make every track taller or shorter.
export function TimelineResizeHandle({
	t,
	rowScale,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onReset,
	onStepRowScale,
}: Props) {
	const resizeLabel = t(
		"editor.timelinePanel.resizeHandle",
		"Drag to resize the timeline; double-click to reset",
	);
	const smallerLabel = t("editor.timelinePanel.smallerTracks", "Smaller tracks");
	const tallerLabel = t("editor.timelinePanel.tallerTracks", "Taller tracks");
	const canShrink = rowScale > TIMELINE_ROW_SCALE_STEPS[0];
	const canGrow = rowScale < TIMELINE_ROW_SCALE_STEPS[TIMELINE_ROW_SCALE_STEPS.length - 1];
	const stepButtonClass =
		"flex size-5 items-center justify-center rounded-md text-xs leading-none text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent";

	return (
		<div className="relative mx-4 flex h-3 flex-shrink-0 items-center" data-timeline-resize>
			<div
				role="separator"
				aria-orientation="horizontal"
				aria-label={resizeLabel}
				title={resizeLabel}
				tabIndex={0}
				className="group flex h-3 flex-1 cursor-row-resize touch-none items-center justify-center outline-none"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={onReset}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onReset();
					}
				}}
			>
				<span className="h-1 w-12 rounded-full bg-foreground/15 transition-colors group-hover:bg-foreground/35 group-focus-visible:bg-accent" />
			</div>
			<div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
				<button
					type="button"
					className={stepButtonClass}
					aria-label={smallerLabel}
					title={smallerLabel}
					disabled={!canShrink}
					onClick={() => onStepRowScale(-1)}
				>
					−
				</button>
				<button
					type="button"
					className={stepButtonClass}
					aria-label={tallerLabel}
					title={tallerLabel}
					disabled={!canGrow}
					onClick={() => onStepRowScale(1)}
				>
					+
				</button>
			</div>
		</div>
	);
}
