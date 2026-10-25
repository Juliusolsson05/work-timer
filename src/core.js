export const STORAGE_KEY = "adhd-work-timer:v1";
export const STATE_VERSION = 1;

export const SCHEDULE_TEMPLATE = Object.freeze({
  startTime: "09:00",
  blocks: [
    { title: "Writing", durationMinutes: 150 },
    { title: "Hackathon outreach", durationMinutes: 60 },
  ],
});

export const SCHEDULE_TEMPLATE_TEXT = JSON.stringify(SCHEDULE_TEMPLATE, null, 2);

export function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseScheduleJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON. Check commas and quotation marks.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Schedule must be one JSON object.");
  }
  if (typeof parsed.startTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(parsed.startTime)) {
    throw new Error("startTime must use HH:MM in 24-hour time, for example 09:00.");
  }
  if (!Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
    throw new Error("blocks must contain at least one work block.");
  }
  if (parsed.blocks.length > 50) {
    throw new Error("A schedule can contain at most 50 work blocks.");
  }

  const blocks = parsed.blocks.map((block, index) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error(`Block ${index + 1} must be an object.`);
    }
    const title = typeof block.title === "string" ? block.title.trim() : "";
    if (!title) throw new Error(`Block ${index + 1} needs a title.`);
    if (title.length > 120) throw new Error(`Block ${index + 1} title is too long.`);

    const durationMinutes = block.durationMinutes;
    if (typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440) {
      throw new Error(`Block ${index + 1} durationMinutes must be a whole number from 1 to 1440.`);
    }

    return { id: makeId(), title, durationMinutes, status: "pending" };
  });

  return { startTime: parsed.startTime, blocks };
}

export function buildTimeline(blocks, startAt) {
  let cursor = startAt;
  return blocks.map((block) => {
    const durationMs = block.durationMinutes * 60_000;
    const item = { ...block, startAt: cursor, endAt: cursor + durationMs, durationMs };
    cursor = item.endAt;
    return item;
  });
}

// One-off "Start Focus" sessions borrow the plan's session machinery (phases,
// timestamp countdown, restore-after-sleep) without touching state.blocks:
// picking a 25 min preset must never wipe the day the user planned. The
// session carries quickMinutes and every consumer asks sessionBlocks() which
// list is running instead of reading state.blocks directly.
export const QUICK_PRESETS = Object.freeze([15, 25, 30, 45, 60, 90, 120]);
export const QUICK_BLOCK_ID = "quick-focus";

export function isValidMinutes(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_440;
}

export function sessionBlocks(state) {
  const minutes = state.session?.quickMinutes;
  if (isValidMinutes(minutes)) {
    return [{ id: QUICK_BLOCK_ID, title: "Focus", durationMinutes: minutes, status: state.session.phase === "completed" ? "complete" : "pending" }];
  }
  return state.blocks;
}

// Every place that drops back to setup used to hand-roll this object; one
// constructor keeps the reminder/quick fields from leaking between sessions.
export function draftSession() {
  return {
    phase: "draft",
    currentIndex: 0,
    endAt: null,
    remainingMs: null,
    soundPlayed: false,
    quickMinutes: null,
    focusedBeforeMs: 0,
    reminderCheckedMs: 0,
    activeReminderId: null,
  };
}

// Focused time across the WHOLE session, not the current block. Reminders like
// "stretch every 30 min" are about how long you have been sitting, and a plan
// of 25 min blocks would never reach 30 on a per-block clock. Paused time is
// excluded because remainingTime() freezes while paused.
export function focusedTime(session, blockDurationMs, now = Date.now()) {
  if (["draft", "completed"].includes(session.phase)) return session.focusedBeforeMs ?? 0;
  const spent = Math.max(0, blockDurationMs - remainingTime(session, now));
  return (session.focusedBeforeMs ?? 0) + spent;
}

// Window check instead of Focus Flow's `elapsed % interval === 0`: a laptop
// asleep across the 30:00 mark wakes at 41:12 and that exact second never
// happens, so the reminder silently vanished. Anything due in (fromMs, toMs]
// fires once; when several are due, the one that came due first wins.
export function dueReminder(reminders, fromMs, toMs) {
  let due = null;
  let dueAt = Infinity;
  for (const reminder of reminders ?? []) {
    const intervalMs = reminder.intervalMinutes * 60_000;
    if (!(intervalMs > 0)) continue;
    const next = (Math.floor(fromMs / intervalMs) + 1) * intervalMs;
    if (next <= toMs && next < dueAt) {
      due = reminder;
      dueAt = next;
    }
  }
  return due;
}

export function parseReminders(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" &&
      typeof item.label === "string" && item.label.trim() &&
      isValidMinutes(item.intervalMinutes))
    .slice(0, 20)
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : makeId(),
      label: item.label.trim().slice(0, 80),
      intervalMinutes: item.intervalMinutes,
    }));
}

export function startTimer(durationMs, now = Date.now()) {
  const safeDuration = Math.max(0, Number(durationMs) || 0);
  return { phase: "running", endAt: now + safeDuration, remainingMs: safeDuration };
}

export function remainingTime(timer, now = Date.now()) {
  if (timer.phase === "running") return Math.max(0, timer.endAt - now);
  return Math.max(0, timer.remainingMs ?? 0);
}

export function pauseTimer(timer, now = Date.now()) {
  return { phase: "paused", endAt: null, remainingMs: remainingTime(timer, now) };
}

export function resumeTimer(timer, now = Date.now()) {
  return startTimer(remainingTime(timer, now), now);
}

export function reconcileTimer(timer, now = Date.now()) {
  if (timer.phase !== "running") return timer;
  const remainingMs = remainingTime(timer, now);
  if (remainingMs === 0) return { phase: "expired", endAt: null, remainingMs: 0 };
  return { ...timer, remainingMs };
}

export function roundToNextFiveMinutes(timestamp = Date.now()) {
  const fiveMinutes = 5 * 60_000;
  return Math.ceil(timestamp / fiveMinutes) * fiveMinutes;
}

export function localTimeValue(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function startTimeToTimestamp(value, now = Date.now()) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

export function formatClock(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

export function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

// Focus Flow's display rule: MM:SS under an hour so the digits stay as big as
// possible, HH:MM:SS only when the hours carry information.
export function formatTimerDisplay(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  const parts = hours ? [hours, minutes, remainder] : [minutes, remainder];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export function defaultState(now = Date.now()) {
  const schedule = parseScheduleJSON(JSON.stringify({
    ...SCHEDULE_TEMPLATE,
    startTime: localTimeValue(roundToNextFiveMinutes(now)),
  }));
  return {
    version: STATE_VERSION,
    planStartTime: schedule.startTime,
    blocks: schedule.blocks,
    session: draftSession(),
    reminders: [],
    soundEnabled: true,
  };
}

export function loadState(storage = localStorage, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY));
    if (parsed?.version !== STATE_VERSION || !parsed.session) throw new Error("Invalid state version");

    const schedule = parseScheduleJSON(JSON.stringify({
      startTime: parsed.planStartTime,
      blocks: parsed.blocks,
    }));
    const phases = new Set(["draft", "ready", "running", "paused", "expired", "completed"]);
    const phase = parsed.session.phase;
    if (!phases.has(phase)) throw new Error("Invalid timer phase");

    // Everything below quickMinutes is optional on purpose: state saved by the
    // PR #1 release has none of these fields and must keep loading as version
    // 1 instead of being discarded by a version bump.
    const quickMinutes = phase !== "draft" && isValidMinutes(parsed.session.quickMinutes)
      ? parsed.session.quickMinutes
      : null;
    const runningCount = quickMinutes ? 1 : schedule.blocks.length;
    const nonNegative = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
    const reminders = parseReminders(parsed.reminders);

    let currentIndex = parsed.session.currentIndex;
    if (phase === "draft") currentIndex = 0;
    else if (phase === "completed") currentIndex = runningCount;
    else if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= runningCount) {
      throw new Error("Invalid current block");
    }

    const rawRemaining = parsed.session.remainingMs;
    if (!["draft", "completed"].includes(phase) &&
        (typeof rawRemaining !== "number" || !Number.isFinite(rawRemaining) || rawRemaining < 0)) {
      throw new Error("Invalid remaining time");
    }
    if (phase === "running" &&
        (typeof parsed.session.endAt !== "number" || !Number.isFinite(parsed.session.endAt))) {
      throw new Error("Invalid timer deadline");
    }

    const blocks = schedule.blocks.map((block, index) => ({
      ...block,
      id: typeof parsed.blocks[index]?.id === "string" && parsed.blocks[index].id
        ? parsed.blocks[index].id
        : block.id,
      // A quick session never touches the plan, so its blocks stay pending.
      status: !quickMinutes && (phase === "completed" || (phase !== "draft" && index < currentIndex))
        ? "complete"
        : "pending",
    }));

    return {
      version: STATE_VERSION,
      planStartTime: schedule.startTime,
      blocks,
      session: {
        phase,
        currentIndex,
        endAt: phase === "running" ? parsed.session.endAt : null,
        remainingMs: phase === "draft" ? null : phase === "completed" || phase === "expired" ? 0 : rawRemaining,
        soundPlayed: parsed.session.soundPlayed === true,
        quickMinutes,
        focusedBeforeMs: phase === "draft" ? 0 : nonNegative(parsed.session.focusedBeforeMs),
        reminderCheckedMs: phase === "draft" ? 0 : nonNegative(parsed.session.reminderCheckedMs),
        // Only a paused session can be waiting on a reminder (firing pauses
        // the timer), and the reminder must still exist after edits.
        activeReminderId: phase === "paused" && reminders.some((item) => item.id === parsed.session.activeReminderId)
          ? parsed.session.activeReminderId
          : null,
      },
      reminders,
      soundEnabled: parsed.soundEnabled !== false,
    };
  } catch {
    return defaultState(now);
  }
}

export function saveState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
