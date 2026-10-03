import { handleRequest, resultTransferables, type WorkerRequest } from "./protocol.ts";

interface WorkerScope {
	onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
	postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
	const res = handleRequest(e.data);
	scope.postMessage(res, res.ok ? resultTransferables(res.result) : []);
};
