import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTimeline,
  draftSession,
  dueReminder,
  focusedTime,
  formatTimerDisplay,
  sessionBlocks,
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

test("a reminder that came due while the laptop slept fires once on wake", () => {
  const reminders = [{ id: "stretch", label: "Stretch", intervalMinutes: 30 }];
  // Last check at 29:59 focused, wake at 41:12: the exact 30:00 second never
  // ran, which is the case Focus Flow's `elapsed % interval === 0` missed.
  assert.equal(dueReminder(reminders, 29 * 60_000 + 59_000, 41 * 60_000 + 12_000)?.id, "stretch");
  // Once checked up to 41:12, nothing is due again until 60:00.
  assert.equal(dueReminder(reminders, 41 * 60_000 + 12_000, 59 * 60_000), null);
  assert.equal(dueReminder(reminders, 59 * 60_000, 60 * 60_000)?.id, "stretch");
});

test("the reminder that came due first wins when several are due", () => {
  const reminders = [
    { id: "water", label: "Water", intervalMinutes: 45 },
    { id: "stretch", label: "Stretch", intervalMinutes: 20 },
  ];
  assert.equal(dueReminder(reminders, 0, 50 * 60_000)?.id, "stretch");
});

test("focused time spans blocks and excludes paused time", () => {
  const blockMs = 25 * 60_000;
  const running = { ...startTimer(blockMs, 0), focusedBeforeMs: 25 * 60_000 };
  const paused = pauseTimer(running, 10 * 60_000);
  // Ten minutes into block two of a 25-minute plan = 35 focused minutes, and
  // sitting paused for an hour does not add to it.
  assert.equal(focusedTime({ ...paused, focusedBeforeMs: 25 * 60_000 }, blockMs, 70 * 60_000), 35 * 60_000);
});

test("a quick Start Focus session leaves the planned day untouched", () => {
  const state = loadState({ getItem: () => null }, Date.UTC(2026, 9, 25, 8, 0));
  const plan = state.blocks.map((block) => block.title);
  state.session = { ...draftSession(), phase: "running", quickMinutes: 25, ...startTimer(25 * 60_000, 0) };

  const running = sessionBlocks(state);
  assert.equal(running.length, 1);
  assert.equal(running[0].durationMinutes, 25);
  assert.deepEqual(state.blocks.map((block) => block.title), plan);

  const restored = loadState({ getItem: () => JSON.stringify(state) }, 1_000);
  assert.equal(restored.session.quickMinutes, 25);
  assert.ok(restored.blocks.every((block) => block.status === "pending"));
});

test("state saved by the PR #1 release still restores its running block", () => {
  const legacy = {
    version: 1,
    planStartTime: "09:00",
    blocks: [
      { id: "a", title: "Writing", durationMinutes: 150, status: "complete" },
      { id: "b", title: "Outreach", durationMinutes: 60, status: "pending" },
    ],
    session: { phase: "running", currentIndex: 1, endAt: 99_000_000, remainingMs: 3_600_000, soundPlayed: false },
    soundEnabled: false,
  };
  const restored = loadState({ getItem: () => JSON.stringify(legacy) }, 0);
  assert.equal(restored.session.phase, "running");
  assert.equal(restored.session.currentIndex, 1);
  assert.equal(restored.session.quickMinutes, null);
  assert.equal(restored.session.focusedBeforeMs, 0);
  assert.deepEqual(restored.reminders, []);
  assert.equal(restored.soundEnabled, false);
});

test("digits drop the hours under an hour, like Focus Flow", () => {
  assert.equal(formatTimerDisplay(25 * 60_000), "25:00");
  assert.equal(formatTimerDisplay(150 * 60_000), "02:30:00");
});
