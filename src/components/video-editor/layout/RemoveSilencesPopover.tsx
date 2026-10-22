import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowsMerge } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import { SliderControl } from "../SliderControl";
import {
	DEFAULT_FILLER_WORDS,
	findFillerWordSpans,
	planSilenceRemoval,
	type SilenceRemovalPlan,
	type SourceSilence,
} from "../silenceRemoval";
import type { CaptionCue, ClipRegion } from "../types";
import { Switch } from "@/components/ui/switch";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	videoSourcePath: string | null;
	clipRegions: ClipRegion[];
	sourceDurationMs: number;
	/** Caption cues with word timings, used to find filler words. */
	autoCaptions: CaptionCue[];
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
	autoCaptions,
	onRemoveSilences,
}: Props) {
	const [open, setOpen] = useState(false);
	const [minPauseS, setMinPauseS] = useState(DEFAULT_MIN_PAUSE_S);
	const [padMs, setPadMs] = useState(DEFAULT_PAD_MS);
	const [noiseDb, setNoiseDb] = useState(DEFAULT_NOISE_DB);
	const [cutFillers, setCutFillers] = useState(false);
	const [extraFillers, setExtraFillers] = useState("");
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

	const hasWordTimings = useMemo(
		() => autoCaptions.some((cue) => cue.words && cue.words.length > 0),
		[autoCaptions],
	);
	const fillerSpans = useMemo(() => {
		if (!cutFillers || !hasWordTimings) return [];
		const extra = extraFillers
			.split(/[,\s]+/)
			.map((word) => word.trim())
			.filter(Boolean);
		return findFillerWordSpans(autoCaptions, [...DEFAULT_FILLER_WORDS, ...extra]);
	}, [cutFillers, hasWordTimings, extraFillers, autoCaptions]);
	const cuts = useMemo(
		() => (silences ? [...silences, ...fillerSpans] : null),
		[silences, fillerSpans],
	);

	const preview = useMemo(() => {
		if (!cuts) return null;
		let next = 0;
		return planSilenceRemoval(clipRegions, cuts, {
			minSilenceMs: Math.round(minPauseS * 1000),
			padMs,
			sourceDurationMs,
			createId: () => `preview-${next++}`,
		});
	}, [cuts, clipRegions, minPauseS, padMs, sourceDurationMs]);

	const handleApply = () => {
		if (!cuts || !preview || preview.removedCount === 0) return;
		const plan = onRemoveSilences(cuts, {
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
					<div className="flex flex-col gap-1.5">
						<label className="flex items-center justify-between gap-2 text-xs">
							<span className={hasWordTimings ? "" : "text-muted-foreground"}>
								{t("editor.silence.fillers", "Also cut filler words (eh, um…)")}
							</span>
							<Switch
								checked={cutFillers && hasWordTimings}
								onCheckedChange={setCutFillers}
								disabled={!hasWordTimings}
								aria-label={t("editor.silence.fillers", "Also cut filler words (eh, um…)")}
								data-testid="remove-fillers-switch"
							/>
						</label>
						{hasWordTimings ? (
							cutFillers ? (
								<input
									type="text"
									value={extraFillers}
									onChange={(event) => setExtraFillers(event.target.value)}
									placeholder={t(
										"editor.silence.fillersExtra",
										"More words, separated by commas",
									)}
									aria-label={t("editor.silence.fillersExtra", "More words, separated by commas")}
									className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
								/>
							) : null
						) : (
							<p className="text-[11px] text-muted-foreground">
								{t(
									"editor.silence.fillersHint",
									"Generate captions first: filler words come from their word timings.",
								)}
							</p>
						)}
					</div>
					<p className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
						{analyzing
							? t("editor.silence.analyzing", "Analyzing audio…")
							: preview
								? preview.removedCount > 0
									? `${t("editor.silence.found", "{{count}} pauses · saves {{seconds}} s", {
											count: preview.removedCount - fillerSpans.length,
											seconds: formatSeconds(preview.removedMs),
										})}${
											fillerSpans.length > 0
												? ` · ${t("editor.silence.fillersFound", "{{count}} filler words", { count: fillerSpans.length })}`
												: ""
										}`
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
