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

function makeId() {
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
    session: {
      phase: "draft",
      currentIndex: 0,
      endAt: null,
      remainingMs: null,
      soundPlayed: false,
    },
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

    let currentIndex = parsed.session.currentIndex;
    if (phase === "draft") currentIndex = 0;
    else if (phase === "completed") currentIndex = schedule.blocks.length;
    else if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= schedule.blocks.length) {
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
      status: phase === "completed" || (phase !== "draft" && index < currentIndex)
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
      },
      soundEnabled: parsed.soundEnabled !== false,
    };
  } catch {
    return defaultState(now);
  }
}

export function saveState(state, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}
