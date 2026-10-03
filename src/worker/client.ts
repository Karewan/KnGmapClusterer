/**
 * Run CPU heavy tasks (index build, line simplification) in a shared worker,
 * with an automatic fallback on the main thread (no Worker support, CSP blocking blob: workers...).
 */

import IndexWorker from "./index.worker.ts?worker&inline";
import {
	runTask,
	taskTransferables,
	type WorkerRequest,
	type WorkerResponse,
	type WorkerResult,
	type WorkerTask,
} from "./protocol.ts";

interface Pending {
	readonly task: WorkerTask;
	resolve(result: WorkerResult): void;
	reject(error: Error): void;
}

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function runLocally(p: Pending): void {
	try {
		p.resolve(runTask(p.task));
	} catch (e: unknown) {
		p.reject(e instanceof Error ? e : new Error(String(e)));
	}
}

function fail(): void {
	broken = true;
	worker?.terminate();
	worker = null;
	// the tasks were transferred: their buffers are lost, the callers must retry
	for (const [id, p] of pending) {
		pending.delete(id);
		p.reject(new WorkerUnavailableError());
	}
}

function getWorker(): Worker | null {
	if (worker || broken) {
		return worker;
	}
	if (typeof Worker === "undefined") {
		broken = true;
		return null;
	}
	try {
		worker = new IndexWorker({
			name: "kn-gmap-clusterer",
		});
	} catch {
		broken = true;
		return null;
	}
	worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
		const res = e.data;
		const p = pending.get(res.id);
		if (!p) {
			return;
		}
		pending.delete(res.id);
		if (res.ok) {
			p.resolve(res.result);
		} else {
			p.reject(new Error(res.error));
		}
	};
	worker.onerror = (e) => {
		e.preventDefault();
		fail();
	};
	return worker;
}

/** The worker could not run the task, it must be run again on the main thread */
export class WorkerUnavailableError extends Error {
	constructor() {
		super("Worker unavailable");
		this.name = "WorkerUnavailableError";
	}
}

/**
 * Run a task in the worker if requested and available, else on the main thread.
 * Buffers of the task are transferred (unusable after the call) when using the worker.
 */
export function runInWorker(
	createTask: () => WorkerTask,
	useWorker: boolean,
): Promise<WorkerResult> {
	return new Promise<WorkerResult>((resolve, reject) => {
		const w = useWorker ? getWorker() : null;
		const task = createTask();

		if (!w) {
			// let the browser paint before blocking the main thread
			setTimeout(
				() =>
					runLocally({
						task,
						resolve,
						reject,
					}),
				0,
			);
			return;
		}

		const id = nextId++;
		pending.set(id, {
			task,
			resolve,
			reject: (e) => {
				if (e instanceof WorkerUnavailableError) {
					// fallback: rebuild the task (the transferred buffers are gone)
					runLocally({
						task: createTask(),
						resolve,
						reject,
					});
				} else {
					reject(e);
				}
			},
		});
		const req: WorkerRequest = {
			id,
			task,
		};
		w.postMessage(req, taskTransferables(task));
	});
}
