/* biome-ignore-all lint/correctness/useExhaustiveDependencies: editor state setters are stable and initial source loading intentionally runs once per launch configuration. */
import { type MutableRefObject, useEffect, useRef } from "react";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";

type RecordingSessionChange = RendererRecordingSessionData;

/** Windows paths may differ in slashes and drive-letter case between main and renderer. */
function isSameMediaPath(left: string | null, right: string | null): boolean {
	if (!left || !right) return false;
	const comparable = (value: string) => {
		const slashes = value.replace(/\\/g, "/");
		return /^[a-z]:\//i.test(slashes) ? slashes.toLowerCase() : slashes;
	};
	return comparable(left) === comparable(right);
}

type SessionPresentation = {
	hideOverlayCursorByDefault?: boolean;
	nativeCaptureUnavailable?: boolean;
};

type Input = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	videoSourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: SessionPresentation | null | undefined) => void;
};

export function useInitialEditorSource({
	project,
	appearance,
	timeline,
	smokeConfig,
	devConfig,
	videoSourcePath,
	pendingFreshRecordingAutoZoomPathRef,
	applyLoadedProject,
	resetSourceScopedEditorState,
	applySessionPresentation,
}: Input) {
	const initialLoadStartedRef = useRef(false);

	useEffect(() => {
		// This effect owns launch-time hydration. Several of the callbacks it uses
		// intentionally close over live editor state, so their identities may change
		// after hydration updates that state. Never interpret that as a request to
		// reload the source and reset the editor again.
		if (initialLoadStartedRef.current) return;
		initialLoadStartedRef.current = true;

		async function loadInitialData() {
			try {
				if (smokeConfig.enabled && smokeConfig.projectPath) {
					const result = await window.electronAPI.openProjectFileAtPath(
						smokeConfig.projectPath,
					);
					if (!result.success || !result.project) {
						project.setError(
							`Smoke export failed to load project ${smokeConfig.projectPath}: ${result.error || result.message || "unknown error"}`,
						);
						return;
					}
					if (
						!(await applyLoadedProject(
							result.project,
							result.path ?? smokeConfig.projectPath,
						))
					) {
						project.setError(
							`Smoke export could not apply project ${smokeConfig.projectPath}`,
						);
						return;
					}
					project.setError(null);
					return;
				}

				if (!smokeConfig.enabled && devConfig.inputPath) {
					const sourcePath = fromFileUrl(devConfig.inputPath);
					const webcamPath = devConfig.webcamInputPath
						? fromFileUrl(devConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
					}));
					project.setError(null);
					return;
				}

				if (smokeConfig.enabled) {
					if (!smokeConfig.inputPath) {
						project.setError("Smoke export input path is missing.");
						return;
					}
					const sourcePath = fromFileUrl(smokeConfig.inputPath);
					const webcamPath = smokeConfig.webcamInputPath
						? fromFileUrl(smokeConfig.webcamInputPath)
						: null;
					if (webcamPath) {
						await window.electronAPI.setCurrentRecordingSession?.({
							videoPath: sourcePath,
							webcamPath,
							timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						});
					} else {
						await window.electronAPI.setCurrentVideoPath(sourcePath);
					}
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current = null;
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(webcamPath),
						sourcePath: webcamPath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						shadow: smokeConfig.webcamShadow ?? previous.shadow,
						size: smokeConfig.webcamSize ?? previous.size,
						width: smokeConfig.webcamSize ?? previous.width ?? previous.size,
						height: smokeConfig.webcamSize ?? previous.height ?? previous.size,
					}));
					project.setError(null);
					return;
				}

				const currentProject = await window.electronAPI.loadCurrentProjectFile();
				if (
					currentProject.success &&
					currentProject.project &&
					(await applyLoadedProject(currentProject.project, currentProject.path ?? null))
				) {
					return;
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceUrl = await resolveVideoUrl(sourcePath);
					project.setVideoSourcePath(sourcePath);
					project.setVideoPath(sourceUrl);
					project.setCurrentProjectPath(null);
					project.setLastSavedSnapshot(null);
					resetSourceScopedEditorState();
					pendingFreshRecordingAutoZoomPathRef.current =
						appearance.autoApplyFreshRecordingAutoZooms ? sourceUrl : null;
					applySessionPresentation(sessionResult.session);
					appearance.setWebcam((previous) => ({
						...previous,
						visibleRanges: undefined,
						enabled: Boolean(sessionResult.session?.webcamPath),
						sourcePath: sessionResult.session?.webcamPath ?? null,
						timeOffsetMs:
							sessionResult.session?.timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS,
					}));
					return;
				}

				const currentVideo = await window.electronAPI.getCurrentVideoPath();
				if (!currentVideo.success || !currentVideo.path) {
					// An empty session is the normal dashboard launch, not a load failure.
					project.setProjectBrowserOpen(true);
					return;
				}
				const sourcePath = fromFileUrl(currentVideo.path);
				project.setVideoSourcePath(sourcePath);
				project.setVideoPath(await resolveVideoUrl(sourcePath));
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
				resetSourceScopedEditorState();
				pendingFreshRecordingAutoZoomPathRef.current = null;
				applySessionPresentation(null);
				appearance.setWebcam((previous) => ({
					...previous,
					visibleRanges: undefined,
					enabled: false,
					sourcePath: null,
					timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
				}));
			} catch (error) {
				project.setError(`Error loading video: ${String(error)}`);
			} finally {
				project.setLoading(false);
			}
		}
		void loadInitialData();
	}, [
		applyLoadedProject,
		applySessionPresentation,
		devConfig,
		resetSourceScopedEditorState,
		smokeConfig,
	]);

	// A fresh recording opens the editor before its webcam file is written; the webcam
	// arrives later as a session change. That event can land while the editor is still
	// loading the video (no source path yet), so the last one is kept and applied once
	// the source matches instead of being dropped — otherwise the camera never shows
	// and saving then stores the project without it.
	const lastSessionRef = useRef<RecordingSessionChange | null>(null);
	const applySessionWebcam = (session: RecordingSessionChange, sourcePath: string | null) => {
		const sessionSourcePath = session.videoPath ? fromFileUrl(session.videoPath) : null;
		if (!isSameMediaPath(sessionSourcePath, sourcePath)) return false;
		const webcamPath = session.webcamPath ? fromFileUrl(session.webcamPath) : null;
		appearance.setWebcam((previous) => ({
			...previous,
			visibleRanges: undefined,
			enabled: Boolean(webcamPath),
			sourcePath: webcamPath,
			timeOffsetMs: webcamPath
				? (session.timeOffsetMs ?? previous.timeOffsetMs)
				: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));
		timeline.setSourceAudioFallbackRefreshKey((key) => key + 1);
		return true;
	};

	useEffect(() => {
		if (!window.electronAPI.onRecordingSessionChanged) return;
		return window.electronAPI.onRecordingSessionChanged((session) => {
			if (!session) return;
			lastSessionRef.current = session;
			if (applySessionWebcam(session, videoSourcePath)) lastSessionRef.current = null;
		});
	}, [videoSourcePath, appearance.setWebcam, timeline.setSourceAudioFallbackRefreshKey]);

	useEffect(() => {
		const pending = lastSessionRef.current;
		if (!pending?.webcamPath || appearance.webcam.sourcePath) return;
		if (applySessionWebcam(pending, videoSourcePath)) lastSessionRef.current = null;
	}, [videoSourcePath]);

	useEffect(() => {
		let cancelled = false;
		if (!appearance.webcam.sourcePath) {
			appearance.setResolvedWebcamVideoUrl(null);
			return;
		}
		void resolveVideoUrl(appearance.webcam.sourcePath).then((url) => {
			if (!cancelled) appearance.setResolvedWebcamVideoUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [appearance.webcam.sourcePath, appearance.setResolvedWebcamVideoUrl]);

	useEffect(() => {
		if (!appearance.autoApplyFreshRecordingAutoZooms) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [appearance.autoApplyFreshRecordingAutoZooms, pendingFreshRecordingAutoZoomPathRef]);
}
