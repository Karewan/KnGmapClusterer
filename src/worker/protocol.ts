/**
 * Messages exchanged with the index worker.
 * handleRequest() is pure: the same code runs in the worker or on the main thread (fallback).
 */

import {
	buildClusterIndex,
	type ClusterIndexData,
	type ClusterIndexInput,
	type ClusterIndexOptions,
	clusterIndexTransferables,
} from "../core/cluster-index.ts";
import { simplifyImportance } from "../core/simplify.ts";
import { buildZones, type PackedZones, type ZoneHullOptions } from "../core/zones.ts";

export type WorkerTask =
	| {
			readonly type: "cluster";
			readonly input: ClusterIndexInput;
			readonly options: ClusterIndexOptions;
	  }
	| {
			readonly type: "simplify";
			readonly xs: Float64Array;
			readonly ys: Float64Array;
	  }
	| {
			readonly type: "zones";
			readonly xs: Float64Array;
			readonly ys: Float64Array;
			/** group index of each point (-1: none) */
			readonly groups: Int32Array;
			readonly count: number;
			readonly options: ZoneHullOptions;
	  };

export type WorkerResult =
	| {
			readonly type: "cluster";
			readonly data: ClusterIndexData;
	  }
	| {
			readonly type: "simplify";
			readonly importance: Float64Array;
	  }
	| {
			readonly type: "zones";
			readonly zones: PackedZones;
	  };

export interface WorkerRequest {
	readonly id: number;
	readonly task: WorkerTask;
}

export type WorkerResponse =
	| {
			readonly id: number;
			readonly ok: true;
			readonly result: WorkerResult;
	  }
	| {
			readonly id: number;
			readonly ok: false;
			readonly error: string;
	  };

/** Buffers of a task to transfer to the worker */
export function taskTransferables(task: WorkerTask): ArrayBuffer[] {
	if (task.type === "cluster") {
		return [
			task.input.xs.buffer as ArrayBuffer,
			task.input.ys.buffer as ArrayBuffer,
			task.input.agg.buffer as ArrayBuffer,
		];
	}
	if (task.type === "zones") {
		return [
			task.xs.buffer as ArrayBuffer,
			task.ys.buffer as ArrayBuffer,
			task.groups.buffer as ArrayBuffer,
		];
	}
	return [
		task.xs.buffer as ArrayBuffer,
		task.ys.buffer as ArrayBuffer,
	];
}

/** Buffers of a result to transfer back to the main thread */
export function resultTransferables(result: WorkerResult): ArrayBuffer[] {
	if (result.type === "cluster") {
		return clusterIndexTransferables(result.data);
	}
	if (result.type === "zones") {
		return [
			result.zones.rings.buffer as ArrayBuffer,
			result.zones.offsets.buffer as ArrayBuffer,
			result.zones.labels.buffer as ArrayBuffer,
		];
	}
	return [
		result.importance.buffer as ArrayBuffer,
	];
}

/** Run a task */
export function runTask(task: WorkerTask): WorkerResult {
	if (task.type === "cluster") {
		return {
			type: "cluster",
			data: buildClusterIndex(task.input, task.options),
		};
	}
	if (task.type === "zones") {
		return {
			type: "zones",
			zones: buildZones(task.xs, task.ys, task.groups, task.count, task.options),
		};
	}
	return {
		type: "simplify",
		importance: simplifyImportance(task.xs, task.ys),
	};
}

/** Handle a request and build the response */
export function handleRequest(req: WorkerRequest): WorkerResponse {
	try {
		return {
			id: req.id,
			ok: true,
			result: runTask(req.task),
		};
	} catch (e: unknown) {
		return {
			id: req.id,
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
