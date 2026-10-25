/**
 * Mirrors MediaRecorder chunks to `<recordings>/<fileName>.part` as they arrive, so a
 * crash or power cut keeps what was recorded (Recordly recovers it on the next launch).
 * The in-memory chunks stay the source of the normal save; this copy is only a safety net.
 */
export interface RecordingPartWriter {
	append: (chunk: Blob) => void;
	/** Resolves once every queued chunk has reached the disk. */
	flush: () => Promise<void>;
	discard: () => Promise<void>;
}

export function createRecordingPartWriter(fileName: string): RecordingPartWriter {
	const api = window.electronAPI;
	let queue = Promise.resolve();
	let failed = false;

	return {
		append(chunk) {
			if (failed || typeof api?.appendRecordingPart !== "function") return;
			queue = queue
				.then(async () => {
					const result = await api.appendRecordingPart(
						fileName,
						await chunk.arrayBuffer(),
					);
					if (!result.success) throw new Error(result.error);
				})
				.catch((error) => {
					failed = true;
					console.warn(`Crash copy of ${fileName} stopped:`, error);
				});
		},
		flush() {
			return queue;
		},
		async discard() {
			failed = true;
			await queue;
			await api?.discardRecordingPart?.(fileName);
		},
	};
}
