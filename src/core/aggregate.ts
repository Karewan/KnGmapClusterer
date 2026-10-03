/**
 * Declarative cluster aggregates.
 *
 * Closures cannot be sent to a worker, so aggregates are described with plain objects:
 *   { alerts: { sum: 'alert' }, speed: { max: 'speed' }, types: { countBy: 'type' } }
 *
 * Each aggregate is stored as one or more float64 "columns" in the cluster rows,
 * merged with a per column operation (sum, min or max).
 */

/** Keys of T whose value is a number */
export type KnNumericKey<T> = {
	[K in keyof T]-?: T[K] extends number | undefined ? K : never;
}[keyof T] &
	string;

/** Keys of T whose value can be used as a category */
export type KnCategoryKey<T> = {
	[K in keyof T]-?: T[K] extends string | number | boolean | undefined | null ? K : never;
}[keyof T] &
	string;

export type KnAggregate<T> =
	| {
			readonly sum: KnNumericKey<T>;
	  }
	| {
			readonly min: KnNumericKey<T>;
	  }
	| {
			readonly max: KnNumericKey<T>;
	  }
	| {
			readonly avg: KnNumericKey<T>;
	  }
	| {
			readonly countBy: KnCategoryKey<T>;
	  };

export type KnAggregates<T> = Readonly<Record<string, KnAggregate<T>>>;

/** Value of an aggregate once computed on a cluster */
export type KnAggregateValue<A> = A extends {
	readonly countBy: string;
}
	? Readonly<Record<string, number>>
	: number;

/** Computed aggregates of a cluster */
export type KnAggregateValues<A> = {
	readonly [K in keyof A]: KnAggregateValue<A[K]>;
};

export const OP_SUM = 0;
export const OP_MIN = 1;
export const OP_MAX = 2;

type AggKind = "sum" | "min" | "max" | "avg" | "countBy";

export interface AggEntry {
	readonly name: string;
	readonly kind: AggKind;
	readonly field: string;
	/** first column of the aggregate */
	readonly col: number;
	/** categories, for countBy */
	readonly categories: string[];
}

export interface AggPlan {
	readonly entries: readonly AggEntry[];
	/** number of columns */
	readonly cols: number;
	/** merge operation of each column */
	readonly ops: Uint8Array;
}

export const EMPTY_PLAN: AggPlan = {
	entries: [],
	cols: 0,
	ops: new Uint8Array(0),
};

/** Untyped form of an aggregate */
type RawAggregate =
	| {
			readonly sum: string;
	  }
	| {
			readonly min: string;
	  }
	| {
			readonly max: string;
	  }
	| {
			readonly avg: string;
	  }
	| {
			readonly countBy: string;
	  };

function kindOf(spec: RawAggregate): {
	kind: AggKind;
	field: string;
} {
	if ("sum" in spec) {
		return {
			kind: "sum",
			field: spec.sum,
		};
	}
	if ("min" in spec) {
		return {
			kind: "min",
			field: spec.min,
		};
	}
	if ("max" in spec) {
		return {
			kind: "max",
			field: spec.max,
		};
	}
	if ("avg" in spec) {
		return {
			kind: "avg",
			field: spec.avg,
		};
	}
	return {
		kind: "countBy",
		field: spec.countBy,
	};
}

function readField(p: unknown, field: string): unknown {
	return (p as Record<string, unknown>)[field];
}

function toNumber(v: unknown): number {
	return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Build the aggregation plan and extract the columns of every point.
 * Runs on the main thread (needs the user objects), the result is transferable.
 */
export function extractAggregates<T>(
	points: readonly T[],
	rows: ArrayLike<number>,
	spec: KnAggregates<T> | undefined,
): {
	plan: AggPlan;
	values: Float64Array;
} {
	if (!spec) {
		return {
			plan: EMPTY_PLAN,
			values: new Float64Array(0),
		};
	}

	const entries: AggEntry[] = [];
	const ops: number[] = [];
	const n = rows.length;

	for (const name of Object.keys(spec)) {
		const s = spec[name];
		if (!s) {
			continue;
		}
		const { kind, field } = kindOf(s as RawAggregate);
		const categories: string[] = [];

		if (kind === "countBy") {
			const seen = new Set<string>();
			for (let i = 0; i < n; i++) {
				const v = readField(points[rows[i] as number], field);
				if (v !== undefined && v !== null) {
					seen.add(String(v));
				}
			}
			categories.push(...seen);
		}

		entries.push({
			name,
			kind,
			field,
			col: ops.length,
			categories,
		});

		if (kind === "countBy") {
			for (let c = 0; c < categories.length; c++) {
				ops.push(OP_SUM);
			}
		} else {
			ops.push(kind === "min" ? OP_MIN : kind === "max" ? OP_MAX : OP_SUM);
		}
	}

	const cols = ops.length;
	const values = new Float64Array(n * cols);

	for (const e of entries) {
		const catIndex =
			e.kind === "countBy"
				? new Map(
						e.categories.map(
							(c, i) =>
								[
									c,
									i,
								] as const,
						),
					)
				: null;

		for (let i = 0; i < n; i++) {
			const v = readField(points[rows[i] as number], e.field);
			if (catIndex) {
				if (v !== undefined && v !== null) {
					const c = catIndex.get(String(v));
					if (c !== undefined) {
						values[i * cols + e.col + c] = 1;
					}
				}
			} else {
				values[i * cols + e.col] = toNumber(v);
			}
		}
	}

	return {
		plan: {
			entries,
			cols,
			ops: Uint8Array.from(ops),
		},
		values,
	};
}

/**
 * Merge the aggregate columns of row b into row a (both in the same array)
 */
export function mergeColumns(
	ops: Uint8Array,
	dst: Float64Array,
	dstOffset: number,
	src: Float64Array,
	srcOffset: number,
): void {
	for (let c = 0; c < ops.length; c++) {
		const a = dst[dstOffset + c] as number;
		const b = src[srcOffset + c] as number;
		const op = ops[c];
		dst[dstOffset + c] =
			op === OP_MIN ? Math.min(a, b) : op === OP_MAX ? Math.max(a, b) : a + b;
	}
}

/**
 * Read the computed aggregates of a row
 * @param data the level data
 * @param offset offset of the first aggregate column in data
 * @param count number of points of the row (for avg)
 */
export function readAggregates(
	plan: AggPlan,
	data: Float64Array,
	offset: number,
	count: number,
): Record<string, number | Record<string, number>> {
	const out: Record<string, number | Record<string, number>> = {};

	for (const e of plan.entries) {
		if (e.kind === "countBy") {
			const counts: Record<string, number> = {};
			for (let c = 0; c < e.categories.length; c++) {
				const v = data[offset + e.col + c] as number;
				if (v > 0) {
					counts[e.categories[c] as string] = v;
				}
			}
			out[e.name] = counts;
		} else {
			const v = data[offset + e.col] as number;
			out[e.name] = e.kind === "avg" ? (count > 0 ? v / count : 0) : v;
		}
	}

	return out;
}
