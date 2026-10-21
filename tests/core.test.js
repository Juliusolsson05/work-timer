import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTimeline,
  loadState,
  parseScheduleJSON,
  pauseTimer,
  reconcileTimer,
  resumeTimer,
  startTimer,
} from "../src/core.js";

test("JSON schedule becomes the expected 3.5 hour timeline", () => {
  const schedule = parseScheduleJSON(JSON.stringify({
    startTime: "09:00",
    blocks: [
      { title: "Writing", durationMinutes: 150 },
      { title: "Hackathon outreach", durationMinutes: 60 },
    ],
  }));

  const timeline = buildTimeline(schedule.blocks, Date.UTC(2026, 9, 21, 9, 0));
  assert.equal(timeline[0].endAt, Date.UTC(2026, 9, 21, 11, 30));
  assert.equal(timeline[1].endAt, Date.UTC(2026, 9, 21, 12, 30));
});

test("JSON schedule rejects unusable input with a useful message", () => {
  assert.throws(
    () => parseScheduleJSON('{"startTime":"9am","blocks":[]}'),
    /startTime must use HH:MM/,
  );
});

test("JSON types cannot poison imported or restored browser state", () => {
  assert.throws(
    () => parseScheduleJSON('{"startTime":["09:00"],"blocks":[{"title":"Writing","durationMinutes":30}]}'),
    /startTime must use HH:MM/,
  );

  const storage = {
    getItem: () => '{"version":1,"planStartTime":["09:00"],"blocks":[],"session":{}}',
  };
  const restored = loadState(storage, Date.UTC(2026, 9, 21, 8, 0));
  assert.equal(typeof restored.planStartTime, "string");
  assert.equal(restored.session.phase, "draft");
});

test("timer pause and resume preserve the exact remaining duration", () => {
  const running = startTimer(10_000, 1_000);
  const paused = pauseTimer(running, 4_000);
  assert.equal(paused.remainingMs, 7_000);

  const resumed = resumeTimer(paused, 20_000);
  assert.equal(resumed.endAt, 27_000);
});

test("an overdue running timer restores as expired rather than drifting", () => {
  const running = startTimer(5_000, 1_000);
  const restored = reconcileTimer(running, 8_000);
  assert.equal(restored.phase, "expired");
  assert.equal(restored.remainingMs, 0);
});
