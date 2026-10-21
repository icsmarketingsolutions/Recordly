import type { BrowserWindow } from "electron";

// Video files the user picked through a dialog to append to the timeline. The
// import pipeline only trusts recordings from the recordings folder; a path in
// this set was chosen explicitly, so it may be imported too (never modified).
const externalImportPaths = new Set<string>();

export function approveExternalImport(filePath: string) {
	externalImportPaths.add(filePath);
}

export function isApprovedExternalImport(filePath: string) {
	return externalImportPaths.has(filePath);
}

// "Record a take" from an open editor: the HUD records as usual and, once the
// recording is fully finalized (mux, webcam, sidecars), the editor that asked
// receives it to append instead of being reloaded onto the new recording.
let pendingAppendWindow: BrowserWindow | null = null;

export function setPendingAppendTake(window: BrowserWindow | null) {
	pendingAppendWindow = window;
}

export function clearPendingAppendTake() {
	pendingAppendWindow = null;
}

export function hasPendingAppendTake() {
	return Boolean(pendingAppendWindow && !pendingAppendWindow.isDestroyed());
}

export function resolvePendingAppendTake(session: {
	videoPath: string;
	webcamPath?: string | null;
}) {
	const target = pendingAppendWindow;
	pendingAppendWindow = null;
	if (!target || target.isDestroyed()) return false;
	target.webContents.send("append-take-ready", session);
	if (target.isMinimized()) target.restore();
	target.show();
	target.focus();
	return true;
}
