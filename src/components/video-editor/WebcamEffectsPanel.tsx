import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bakeCameraFx, CameraFxBakeCancelledError } from "@/lib/cameraFx/bake";
import { CameraFxEngine } from "@/lib/cameraFx/engine";
import {
	areCameraFxEqual,
	type CameraFxSettings,
	DEFAULT_CAMERA_FX,
	isCameraFxActive,
	normalizeCameraFxSettings,
	SUBTLE_CAMERA_FX,
} from "@/lib/cameraFx/settings";
import { resolveMediaResourceUrl } from "@/lib/exporter/localMediaSource";
import { cn } from "@/lib/utils";
import { SliderControl } from "./SliderControl";
import type { WebcamEffectsBake, WebcamOverlaySettings } from "./types";
import { getWebcamPreviewTargetTimeSeconds } from "./videoPlayback/webcamSync";
import { getActiveWebcamEffectsBake } from "./webcamOverlay";

interface WebcamEffectsPanelProps {
	webcam: WebcamOverlaySettings;
	currentTime: number;
	playing: boolean;
	onChange: (patch: Partial<WebcamOverlaySettings>) => void;
	onBaked?: (bake: WebcamEffectsBake) => Promise<void>;
	onRestoreOriginal?: () => Promise<void>;
}

type EngineState = "idle" | "loading" | "ready" | "error";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const parsePercent = (text: string) => {
	const value = Number.parseFloat(text.replace(/%$/, ""));
	return Number.isFinite(value) ? value / 100 : null;
};

/**
 * Camera effects for the webcam layer: live preview on the current frame and
 * a one-shot "apply" that writes a processed copy (the original is kept and can
 * be restored or re-processed with other settings at any time).
 */
export function WebcamEffectsPanel({
	webcam,
	currentTime,
	playing,
	onChange,
	onBaked,
	onRestoreOriginal,
}: WebcamEffectsPanelProps) {
	const fx = normalizeCameraFxSettings(webcam.effects);
	const activeBake = getActiveWebcamEffectsBake(webcam);
	const rawPath = activeBake?.originalPath ?? webcam.sourcePath;
	const active = isCameraFxActive(fx);
	const upToDate = activeBake ? areCameraFxEqual(activeBake.effects, fx) : !active;

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const engineRef = useRef<CameraFxEngine | null>(null);
	const fxRef = useRef(fx);
	const compareRef = useRef(false);
	const abortRef = useRef<AbortController | null>(null);
	const [rawUrl, setRawUrl] = useState<string | null>(null);
	const [engineState, setEngineState] = useState<EngineState>("idle");
	const [comparing, setComparing] = useState(false);
	const [bakeProgress, setBakeProgress] = useState<number | null>(null);
	fxRef.current = fx;
	compareRef.current = comparing;

	useEffect(() => {
		let cancelled = false;
		setRawUrl(null);
		if (!rawPath) return;
		void resolveMediaResourceUrl(rawPath).then((url) => {
			if (!cancelled) setRawUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [rawPath]);

	// Models load on first use only; most sessions never touch this panel.
	useEffect(() => {
		if (!active || engineRef.current || engineState === "loading" || engineState === "error") {
			return;
		}
		const engine = new CameraFxEngine();
		setEngineState("loading");
		engine
			.init()
			.then(() => {
				engineRef.current = engine;
				setEngineState("ready");
			})
			.catch((error) => {
				console.error("[camera-fx] Failed to load models:", error);
				engine.dispose();
				setEngineState("error");
			});
	}, [active, engineState]);

	useEffect(
		() => () => {
			abortRef.current?.abort();
			engineRef.current?.dispose();
			engineRef.current = null;
		},
		[],
	);

	const draw = useCallback((reuseDetection: boolean) => {
		const video = videoRef.current;
		const canvas = canvasRef.current;
		if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) return;
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		}
		const context = canvas.getContext("2d");
		if (!context) return;
		const engine = engineRef.current;
		const settings = fxRef.current;
		if (compareRef.current || !engine || !isCameraFxActive(settings)) {
			context.drawImage(video, 0, 0, width, height);
			return;
		}
		try {
			const output = engine.process(
				video,
				width,
				height,
				video.currentTime * 1000,
				settings,
				{
					reuseDetection,
				},
			);
			context.drawImage(output, 0, 0, width, height);
		} catch (error) {
			console.error("[camera-fx] Preview frame failed:", error);
			context.drawImage(video, 0, 0, width, height);
		}
	}, []);

	// Follow the editor: play along while it plays, otherwise seek to its frame.
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !rawUrl) return;
		const target = getWebcamPreviewTargetTimeSeconds({
			currentTime,
			webcamDuration: Number.isFinite(video.duration) ? video.duration : null,
			timeOffsetMs: webcam.timeOffsetMs,
		});
		if (playing) {
			if (Math.abs(video.currentTime - target) > 0.35) video.currentTime = target;
			void video.play().catch(() => undefined);
			return;
		}
		video.pause();
		if (Math.abs(video.currentTime - target) > 0.01) {
			engineRef.current?.reset();
			video.currentTime = target;
		} else {
			draw(true);
		}
	}, [currentTime, playing, rawUrl, webcam.timeOffsetMs, draw]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !playing || !("requestVideoFrameCallback" in video)) return;
		let handle = 0;
		const onFrame = () => {
			draw(false);
			handle = video.requestVideoFrameCallback(onFrame);
		};
		handle = video.requestVideoFrameCallback(onFrame);
		return () => video.cancelVideoFrameCallback(handle);
	}, [playing, draw]);

	// Slider moves re-render the cached analysis; no new detection needed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: redraw whenever the settings, comparison or engine change.
	useEffect(() => {
		if (!playing) draw(true);
	}, [
		fx.backgroundBlur,
		fx.backgroundVeil,
		fx.backgroundVeilTone,
		fx.ambientDarken,
		fx.gazeCorrection,
		fx.eyeRedness,
		comparing,
		engineState,
	]);

	const setFx = (patch: Partial<CameraFxSettings>) => onChange({ effects: { ...fx, ...patch } });

	const applyToRecording = async () => {
		if (!rawPath || !rawUrl || bakeProgress !== null) return;
		if (!active) {
			await onRestoreOriginal?.();
			return;
		}
		const controller = new AbortController();
		abortRef.current = controller;
		setBakeProgress(0);
		try {
			const buffer = await bakeCameraFx({
				sourceUrl: rawUrl,
				fx,
				signal: controller.signal,
				onProgress: setBakeProgress,
			});
			const stored = await window.electronAPI.storeCameraFxVideo(buffer);
			if (!stored.success || !stored.path) {
				throw new Error(stored.error ?? "No se pudo guardar el video procesado");
			}
			await onBaked?.({ originalPath: rawPath, outputPath: stored.path, effects: fx });
			toast.success("Efectos aplicados a la cámara");
		} catch (error) {
			if (error instanceof CameraFxBakeCancelledError) {
				toast("Procesamiento cancelado");
			} else {
				console.error("[camera-fx] Bake failed:", error);
				toast.error("No se pudieron aplicar los efectos de cámara");
			}
		} finally {
			abortRef.current = null;
			setBakeProgress(null);
		}
	};

	const restoreOriginal = async () => {
		await onRestoreOriginal?.();
		toast.success("Cámara original restaurada");
	};

	if (!webcam.sourcePath) return null;

	const busy = bakeProgress !== null;
	const status = busy
		? `Procesando… ${percent(bakeProgress)}`
		: activeBake
			? upToDate
				? "Aplicados a la grabación"
				: "Cambios sin aplicar"
			: active
				? "Vista previa — falta aplicar"
				: "Sin efectos";

	return (
		<div className="rounded-lg bg-foreground/[0.03] px-2.5 py-2">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="text-[10px] text-muted-foreground">Efectos de cámara (IA)</div>
				<div className="flex gap-2">
					<button
						type="button"
						disabled={busy}
						onClick={() => onChange({ effects: { ...SUBTLE_CAMERA_FX } })}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80 disabled:opacity-40"
					>
						Sutil
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => onChange({ effects: { ...DEFAULT_CAMERA_FX } })}
						className="text-[10px] text-[#2563EB] transition-opacity hover:opacity-80 disabled:opacity-40"
					>
						Quitar
					</button>
				</div>
			</div>

			<div className="relative mb-2 overflow-hidden rounded-md bg-black/40">
				<canvas
					ref={canvasRef}
					className="block aspect-video w-full object-contain"
					style={webcam.mirror ? { transform: "scaleX(-1)" } : undefined}
				/>
				{rawUrl ? (
					<video
						ref={videoRef}
						src={rawUrl}
						crossOrigin="anonymous"
						muted
						playsInline
						preload="auto"
						className="hidden"
						onLoadedData={() => draw(false)}
						onSeeked={() => draw(false)}
					/>
				) : null}
				{engineState === "loading" ? (
					<div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] text-white">
						Cargando modelos de IA…
					</div>
				) : null}
				{engineState === "error" ? (
					<div className="absolute inset-x-0 bottom-0 bg-red-900/80 px-2 py-1 text-[10px] text-white">
						No se pudieron cargar los modelos de IA
					</div>
				) : null}
				<button
					type="button"
					onPointerDown={() => setComparing(true)}
					onPointerUp={() => setComparing(false)}
					onPointerLeave={() => setComparing(false)}
					className={cn(
						"absolute right-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-white",
						comparing && "bg-[#2563EB]",
					)}
				>
					{comparing ? "Original" : "Mantener: antes"}
				</button>
			</div>

			<div className="flex flex-col gap-1.5">
				<SliderControl
					label="Fondo translúcido"
					value={fx.backgroundBlur}
					defaultValue={DEFAULT_CAMERA_FX.backgroundBlur}
					min={0}
					max={1}
					step={0.01}
					onChange={(backgroundBlur) => setFx({ backgroundBlur })}
					formatValue={percent}
					parseInput={parsePercent}
				/>
				<SliderControl
					label="Opacidad del fondo"
					value={fx.backgroundVeil}
					defaultValue={DEFAULT_CAMERA_FX.backgroundVeil}
					min={0}
					max={1}
					step={0.01}
					onChange={(backgroundVeil) => setFx({ backgroundVeil })}
					formatValue={percent}
					parseInput={parsePercent}
				/>
				<div className="flex items-center justify-between rounded-lg bg-black/10 px-2.5 py-1.5">
					<span className="text-[10px] text-muted-foreground">Tono del velo</span>
					<div className="flex gap-1">
						{(["dark", "light"] as const).map((tone) => (
							<button
								key={tone}
								type="button"
								onClick={() => setFx({ backgroundVeilTone: tone })}
								className={cn(
									"rounded px-2 py-0.5 text-[10px]",
									fx.backgroundVeilTone === tone
										? "bg-[#2563EB] text-white"
										: "bg-foreground/5 text-muted-foreground hover:bg-foreground/10",
								)}
							>
								{tone === "dark" ? "Oscuro" : "Claro"}
							</button>
						))}
					</div>
				</div>
				<SliderControl
					label="Oscurecer ambiente"
					value={fx.ambientDarken}
					defaultValue={DEFAULT_CAMERA_FX.ambientDarken}
					min={0}
					max={1}
					step={0.01}
					onChange={(ambientDarken) => setFx({ ambientDarken })}
					formatValue={percent}
					parseInput={parsePercent}
				/>
				<SliderControl
					label="Corregir mirada"
					value={fx.gazeCorrection}
					defaultValue={DEFAULT_CAMERA_FX.gazeCorrection}
					min={0}
					max={1}
					step={0.01}
					onChange={(gazeCorrection) => setFx({ gazeCorrection })}
					formatValue={percent}
					parseInput={parsePercent}
				/>
				<SliderControl
					label="Ojos sin rojez"
					value={fx.eyeRedness}
					defaultValue={DEFAULT_CAMERA_FX.eyeRedness}
					min={0}
					max={1}
					step={0.01}
					onChange={(eyeRedness) => setFx({ eyeRedness })}
					formatValue={percent}
					parseInput={parsePercent}
				/>
			</div>

			<div className="mt-2 text-[10px] text-muted-foreground/80">{status}</div>
			<div className="mt-1.5 grid grid-cols-1 gap-1.5">
				{busy ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => abortRef.current?.abort()}
						className="h-7 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10"
					>
						Cancelar ({percent(bakeProgress)})
					</Button>
				) : (
					<Button
						type="button"
						disabled={upToDate || !rawUrl}
						onClick={() => void applyToRecording()}
						className="h-7 bg-[#2563EB] px-2 text-[10px] text-white hover:bg-[#1d4ed8]"
					>
						{activeBake && !active
							? "Quitar efectos de la grabación"
							: "Aplicar a la grabación"}
					</Button>
				)}
				{activeBake && !busy ? (
					<Button
						type="button"
						variant="outline"
						onClick={() => void restoreOriginal()}
						className="h-7 border-foreground/10 bg-foreground/5 px-2 text-[10px] text-foreground hover:bg-foreground/10"
					>
						Restaurar cámara original
					</Button>
				) : null}
			</div>
		</div>
	);
}
