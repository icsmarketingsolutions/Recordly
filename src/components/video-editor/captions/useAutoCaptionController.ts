import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { resolveAutoCaptionSourcePath } from "../autoCaptionSource";
import { type CaptionEditTarget, updateCaptionCuesForEditedTarget } from "../captionEditing";
import { resolveVideoUrl } from "../projectPersistence";
import type { AutoCaptionSettings, CaptionCue } from "../types";
import { getErrorMessage } from "../videoEditorUtils";
import { RAPID_CAPTION_STYLE, splitRapidCaptions } from "../rapidCaptions";

type DownloadStatus = "idle" | "downloading" | "downloaded" | "error";
type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseAutoCaptionControllerParams {
	t: Translator;
	videoPath: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	webcamSourcePath: string | null;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: DownloadStatus;
	setWhisperModelDownloadStatus: Dispatch<SetStateAction<DownloadStatus>>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	autoCaptionSettings: AutoCaptionSettings;
	autoCaptions: CaptionCue[];
	setAutoCaptionSettings: Dispatch<SetStateAction<AutoCaptionSettings>>;
	setAutoCaptions: Dispatch<SetStateAction<CaptionCue[]>>;
	syncActiveVideoSource: (sourcePath: string, webcamPath?: string | null) => Promise<void>;
}

export const WHISPER_MODEL_OPTIONS = ["small", "medium", "large-v3-turbo"] as const;
export type WhisperModelOption = (typeof WHISPER_MODEL_OPTIONS)[number];
const WHISPER_MODEL_STORAGE_KEY = "recordly.captions.whisperModel";

function readStoredWhisperModel(): WhisperModelOption {
	try {
		const stored = window.localStorage.getItem(WHISPER_MODEL_STORAGE_KEY);
		return (WHISPER_MODEL_OPTIONS as readonly string[]).includes(stored ?? "")
			? (stored as WhisperModelOption)
			: "small";
	} catch {
		return "small";
	}
}

export function useAutoCaptionController({
	t,
	videoPath,
	setVideoPath,
	videoSourcePath,
	setVideoSourcePath,
	webcamSourcePath,
	whisperExecutablePath,
	setWhisperExecutablePath,
	whisperModelPath,
	setWhisperModelPath,
	downloadedWhisperModelPath,
	setDownloadedWhisperModelPath,
	whisperModelDownloadStatus,
	setWhisperModelDownloadStatus,
	setWhisperModelDownloadProgress,
	isGeneratingCaptions,
	setIsGeneratingCaptions,
	autoCaptionSettings,
	autoCaptions,
	setAutoCaptionSettings,
	setAutoCaptions,
	syncActiveVideoSource,
}: UseAutoCaptionControllerParams) {
	const captionGenerationInFlightRef = useRef(false);
	const activeSourceRef = useRef({ videoSourcePath, videoPath });
	activeSourceRef.current = { videoSourcePath, videoPath };
	const [whisperModel, setWhisperModel] = useState<WhisperModelOption>(readStoredWhisperModel);
	const whisperModelChangedRef = useRef(false);
	const handleWhisperModelChange = useCallback((model: WhisperModelOption) => {
		whisperModelChangedRef.current = true;
		try {
			window.localStorage.setItem(WHISPER_MODEL_STORAGE_KEY, model);
		} catch {
			/* Preference only. */
		}
		setWhisperModel(model);
	}, []);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress((state) => {
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedWhisperModelPath(state.path ?? null);
				setWhisperModelPath((current) => current ?? state.path ?? null);
			} else if (state.status === "idle") {
				setDownloadedWhisperModelPath(null);
			} else if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		// Switching models in the panel points generation at that model's file (or
		// at nothing until it is downloaded); the first query keeps a custom path.
		const switched = whisperModelChangedRef.current;
		void window.electronAPI.getWhisperSmallModelStatus(whisperModel).then((result) => {
			if (!result.success) return;
			if (result.exists && result.path) {
				setDownloadedWhisperModelPath(result.path);
				setWhisperModelPath((current) => (switched ? result.path! : (current ?? result.path!)));
				setWhisperModelDownloadStatus("downloaded");
				setWhisperModelDownloadProgress(100);
			} else {
				setDownloadedWhisperModelPath(null);
				if (switched) setWhisperModelPath(null);
				setWhisperModelDownloadStatus("idle");
				setWhisperModelDownloadProgress(0);
			}
		});

		return () => unsubscribe?.();
	}, [
		whisperModel,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) return;
		setWhisperExecutablePath(result.path);
		toast.success("Whisper executable selected");
	}, [setWhisperExecutablePath]);

	const handleDownloadWhisperSmallModel = useCallback(async () => {
		if (whisperModelDownloadStatus === "downloading") return;
		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		const result = await window.electronAPI.downloadWhisperSmallModel(whisperModel);
		if (!result.success) {
			setWhisperModelDownloadStatus("error");
			toast.error(result.error || "Failed to download Whisper small model");
			return;
		}
		if (result.path) {
			setDownloadedWhisperModelPath(result.path);
			setWhisperModelPath(result.path);
		}
	}, [
		whisperModel,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
		whisperModelDownloadStatus,
	]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) return;
		setWhisperModelPath(result.path);
		toast.success("Whisper model selected");
	}, [setWhisperModelPath]);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperSmallModel(whisperModel);
		if (!result.success) {
			toast.error(result.error || "Failed to delete Whisper small model");
			return;
		}
		setWhisperModelPath((current) => (current === downloadedWhisperModelPath ? null : current));
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		toast.success("Whisper small model deleted");
	}, [
		whisperModel,
		downloadedWhisperModelPath,
		setDownloadedWhisperModelPath,
		setWhisperModelDownloadProgress,
		setWhisperModelDownloadStatus,
		setWhisperModelPath,
	]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (captionGenerationInFlightRef.current || isGeneratingCaptions) return;
		captionGenerationInFlightRef.current = true;
		setIsGeneratingCaptions(true);
		try {
			if (!whisperModelPath) {
				toast.error("Select a Whisper model or download the small model first");
				return;
			}
			let sourcePath = resolveAutoCaptionSourcePath({ videoSourcePath, videoPath });
			if (!sourcePath) {
				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
				sourcePath = resolveAutoCaptionSourcePath({
					recordingSessionVideoPath:
						sessionResult?.success && sessionResult.session?.videoPath
							? sessionResult.session.videoPath
							: null,
					currentVideoPath: currentVideoResult.success
						? (currentVideoResult.path ?? null)
						: null,
				});
			}
			if (!sourcePath) {
				toast.error("No source video is loaded");
				return;
			}
			// Refreshing an unchanged session revokes active companion-audio URLs.
			if (sourcePath !== videoSourcePath) {
				await syncActiveVideoSource(sourcePath, webcamSourcePath);
				setVideoSourcePath(sourcePath);
				setVideoPath(await resolveVideoUrl(sourcePath));
			}
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath,
				language: autoCaptionSettings.language,
				prompt: autoCaptionSettings.glossary,
			});
			if (resolveAutoCaptionSourcePath(activeSourceRef.current) !== sourcePath) {
				toast.info("Recording changed; generated captions were not applied.");
				return;
			}
			if (!result.success || !result.cues) {
				const errorMessage = result.error ? getErrorMessage(result.error) : result.message;
				toast.error(errorMessage || "Failed to generate captions");
				return;
			}
			const rapid = autoCaptionSettings.segmentationMode === "rapid";
			const cues = rapid
				? splitRapidCaptions(result.cues, autoCaptionSettings.wordsPerCaption, true)
				: result.cues;
			setAutoCaptions(cues);
			if (cues.length > 0) {
				setAutoCaptionSettings((current) => ({
					...current,
					...(rapid ? RAPID_CAPTION_STYLE : {}),
					enabled: true,
				}));
			}
			toast.success(
				rapid
					? `${cues.length} subtítulos rápidos listos`
					: result.message || `Generated ${cues.length} captions`,
			);
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			captionGenerationInFlightRef.current = false;
			setIsGeneratingCaptions(false);
		}
	}, [
		autoCaptionSettings.language,
		autoCaptionSettings.glossary,
		autoCaptionSettings.segmentationMode,
		autoCaptionSettings.wordsPerCaption,
		isGeneratingCaptions,
		setAutoCaptionSettings,
		setAutoCaptions,
		setIsGeneratingCaptions,
		setVideoPath,
		setVideoSourcePath,
		syncActiveVideoSource,
		videoPath,
		videoSourcePath,
		webcamSourcePath,
		whisperExecutablePath,
		whisperModelPath,
	]);

	const handleSplitRapidCaptions = useCallback(() => {
		try {
			splitRapidCaptions(autoCaptions, autoCaptionSettings.wordsPerCaption, true);
		} catch (error) {
			toast.error(getErrorMessage(error));
			return;
		}
		setAutoCaptions((current) =>
			splitRapidCaptions(current, autoCaptionSettings.wordsPerCaption, true),
		);
		setAutoCaptionSettings((current) => ({
			...current,
			...RAPID_CAPTION_STYLE,
			segmentationMode: "rapid",
			enabled: true,
		}));
		toast.success("Subtítulos divididos automáticamente");
	}, [
		autoCaptions,
		autoCaptionSettings.wordsPerCaption,
		setAutoCaptions,
		setAutoCaptionSettings,
	]);

	const handleSaveAutoCaptionEdit = useCallback(
		(target: CaptionEditTarget, text: string) => {
			setAutoCaptions((captions) => updateCaptionCuesForEditedTarget(captions, target, text));
			toast.success(t("settings.captions.editSaved", "Caption updated"));
		},
		[setAutoCaptions, t],
	);

	return {
		handlePickWhisperExecutable,
		handleDownloadWhisperSmallModel,
		whisperModel,
		handleWhisperModelChange,
		handlePickWhisperModel,
		handleDeleteWhisperSmallModel,
		handleGenerateAutoCaptions,
		handleSplitRapidCaptions,
		handleSaveAutoCaptionEdit,
	};
}
