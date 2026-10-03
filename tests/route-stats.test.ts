import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { haversine, routeStats } from "../src/core/route-stats.ts";

const close = (a: number | null, b: number, eps: number): void => {
	assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} != ${b}`);
};

describe("haversine", () => {
	test("Paris - Lyon", () => {
		// ~392 km as the crow flies
		close(haversine(2.3522, 48.8566, 4.8357, 45.764), 391_500, 2000);
	});

	test("one degree of longitude at the equator", () => {
		close(haversine(0, 0, 1, 0), 111_195, 5);
	});
});

describe("routeStats", () => {
	// 3 points on the equator, 1 degree apart (~111.2 km each)
	const points = [
		{
			x: 0,
			y: 0,
			t: "2026-01-01T10:00:00Z",
			speed: 90,
		},
		{
			x: 1,
			y: 0,
			t: "2026-01-01T11:00:00Z",
			speed: 120,
		},
		// one hour stopped at the same place
		{
			x: 1,
			y: 0,
			t: "2026-01-01T12:00:00Z",
			speed: 0,
		},
		{
			x: 2,
			y: 0,
			t: "2026-01-01T14:00:00Z",
			speed: 60,
		},
	];

	test("distance only, without times", () => {
		const s = routeStats(points);
		assert.equal(s.points, 4);
		close(s.distance, 222_390, 10);
		assert.equal(s.duration, null);
		assert.equal(s.averageSpeed, null);
		assert.equal(s.maxSpeed, null);
	});

	test("durations and speeds from the times", () => {
		const s = routeStats(points, {
			time: (p) => p.t,
		});
		assert.equal(s.duration, 4 * 3_600_000);
		// the stop is excluded from the moving duration
		assert.equal(s.movingDuration, 3 * 3_600_000);
		close(s.averageSpeed, 222.39 / 4, 0.01);
		close(s.averageMovingSpeed, 222.39 / 3, 0.01);
		// fastest segment: 111.2 km in 1 h
		close(s.maxSpeed, 111.19, 0.01);
		assert.equal(s.start, Date.parse("2026-01-01T10:00:00Z"));
		assert.equal(s.end, Date.parse("2026-01-01T14:00:00Z"));
	});

	test("max speed from the GPS speeds when given", () => {
		const s = routeStats(points, {
			time: (p) => new Date(p.t),
			speed: (p) => p.speed,
		});
		assert.equal(s.maxSpeed, 120);
	});

	test("missing times disable the durations", () => {
		const s = routeStats(
			points.map((p, i) => ({
				...p,
				t: i === 2 ? null : p.t,
			})),
			{
				time: (p) => p.t,
			},
		);
		assert.equal(s.duration, null);
		assert.equal(s.averageSpeed, null);
	});

	test("empty route", () => {
		const s = routeStats([]);
		assert.equal(s.distance, 0);
		assert.equal(s.duration, null);
	});
});
