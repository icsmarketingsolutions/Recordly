import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowsMerge } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import { SliderControl } from "../SliderControl";
import { planSilenceRemoval, type SilenceRemovalPlan, type SourceSilence } from "../silenceRemoval";
import type { ClipRegion } from "../types";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	videoSourcePath: string | null;
	clipRegions: ClipRegion[];
	sourceDurationMs: number;
	onRemoveSilences: (
		silences: SourceSilence[],
		options: { minSilenceMs: number; padMs: number },
	) => SilenceRemovalPlan;
};

/** ffmpeg reports pauses at least this long; the slider filters further locally. */
const DETECT_MIN_S = 0.3;
const DEFAULT_MIN_PAUSE_S = 1;
const DEFAULT_PAD_MS = 150;
const DEFAULT_NOISE_DB = -30;

function formatSeconds(ms: number) {
	return (ms / 1000).toFixed(1);
}

/**
 * Toolbar button + popover that detects pauses in the recording's speech audio
 * and removes them from the timeline in one ripple edit (undoable).
 */
export function RemoveSilencesPopover({
	t,
	videoSourcePath,
	clipRegions,
	sourceDurationMs,
	onRemoveSilences,
}: Props) {
	const [open, setOpen] = useState(false);
	const [minPauseS, setMinPauseS] = useState(DEFAULT_MIN_PAUSE_S);
	const [padMs, setPadMs] = useState(DEFAULT_PAD_MS);
	const [noiseDb, setNoiseDb] = useState(DEFAULT_NOISE_DB);
	const [analyzing, setAnalyzing] = useState(false);
	const [silences, setSilences] = useState<SourceSilence[] | null>(null);
	const [analyzedKey, setAnalyzedKey] = useState<string | null>(null);
	const requestRef = useRef(0);

	const analyze = useCallback(async () => {
		const request = ++requestRef.current;
		setAnalyzing(true);
		try {
			let sourcePath = videoSourcePath;
			if (!sourcePath) {
				const current = await window.electronAPI.getCurrentVideoPath();
				sourcePath = current.success ? (current.path ?? null) : null;
			}
			if (!sourcePath) {
				toast.error(t("editor.silence.noSource", "No source video is loaded"));
				return;
			}
			const result = await window.electronAPI.detectRecordingSilences?.({
				videoPath: sourcePath,
				noiseDb,
				minSilenceS: DETECT_MIN_S,
			});
			if (request !== requestRef.current) return;
			if (!result?.success || !result.silences) {
				toast.error(
					result?.message ?? t("editor.silence.failed", "Could not analyze the audio"),
				);
				return;
			}
			setSilences(result.silences);
			setAnalyzedKey(`${sourcePath}|${noiseDb}`);
		} finally {
			if (request === requestRef.current) setAnalyzing(false);
		}
	}, [videoSourcePath, noiseDb, t]);

	// Analyze when the popover opens and whenever the sensitivity changes (debounced).
	useEffect(() => {
		if (!open) return;
		if (analyzedKey === `${videoSourcePath}|${noiseDb}`) return;
		const timer = window.setTimeout(() => void analyze(), analyzedKey ? 400 : 0);
		return () => window.clearTimeout(timer);
	}, [open, analyzedKey, videoSourcePath, noiseDb, analyze]);

	const preview = useMemo(() => {
		if (!silences) return null;
		let next = 0;
		return planSilenceRemoval(clipRegions, silences, {
			minSilenceMs: Math.round(minPauseS * 1000),
			padMs,
			sourceDurationMs,
			createId: () => `preview-${next++}`,
		});
	}, [silences, clipRegions, minPauseS, padMs, sourceDurationMs]);

	const handleApply = () => {
		if (!silences || !preview || preview.removedCount === 0) return;
		const plan = onRemoveSilences(silences, {
			minSilenceMs: Math.round(minPauseS * 1000),
			padMs,
		});
		toast.success(
			t("editor.silence.applied", "Removed {{count}} pauses ({{seconds}} s)", {
				count: plan.removedCount,
				seconds: formatSeconds(plan.removedMs),
			}),
		);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-9 w-9"
					title={t("editor.silence.button", "Remove pauses")}
					aria-label={t("editor.silence.button", "Remove pauses")}
				>
					<ArrowsMerge className="h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-4" data-testid="remove-silences-popover">
				<div className="flex flex-col gap-3">
					<div>
						<p className="text-sm font-medium">{t("editor.silence.title", "Remove pauses")}</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{t(
								"editor.silence.description",
								"Cuts the silent gaps out of the timeline. Undo brings them back.",
							)}
						</p>
					</div>
					<SliderControl
						label={t("editor.silence.minPause", "Minimum pause")}
						value={minPauseS}
						min={0.3}
						max={3}
						step={0.1}
						onChange={setMinPauseS}
						formatValue={(value) => `${value.toFixed(1)} s`}
					/>
					<SliderControl
						label={t("editor.silence.padding", "Keep around speech")}
						value={padMs}
						min={0}
						max={500}
						step={10}
						onChange={setPadMs}
						formatValue={(value) => `${Math.round(value)} ms`}
					/>
					<SliderControl
						label={t("editor.silence.sensitivity", "Silence threshold")}
						value={noiseDb}
						min={-50}
						max={-15}
						step={1}
						onChange={setNoiseDb}
						formatValue={(value) => `${Math.round(value)} dB`}
					/>
					<p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
						{analyzing
							? t("editor.silence.analyzing", "Analyzing audio…")
							: preview
								? preview.removedCount > 0
									? t("editor.silence.found", "{{count}} pauses · saves {{seconds}} s", {
											count: preview.removedCount,
											seconds: formatSeconds(preview.removedMs),
										})
									: t("editor.silence.none", "No pauses that long were found.")
								: ""}
					</p>
					<Button
						variant="default"
						size="sm"
						isDisabled={analyzing || !preview || preview.removedCount === 0}
						onClick={handleApply}
						data-testid="remove-silences-apply"
					>
						{t("editor.silence.apply", "Remove {{count}} pauses", {
							count: preview?.removedCount ?? 0,
						})}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
