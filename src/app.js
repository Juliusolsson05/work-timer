import {
  SCHEDULE_TEMPLATE_TEXT,
  buildTimeline,
  defaultState,
  formatClock,
  formatCountdown,
  formatDuration,
  loadState,
  parseScheduleJSON,
  pauseTimer,
  reconcileTimer,
  remainingTime,
  resumeTimer,
  saveState,
  startTimeToTimestamp,
  startTimer,
} from "./core.js";

const byId = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
};

const elements = {
  plannerView: byId("planner-view"),
  plannerHeading: byId("planner-heading"),
  focusView: byId("focus-view"),
  planStart: byId("plan-start"),
  blockList: byId("block-list"),
  blockTemplate: byId("block-row-template"),
  addBlock: byId("add-block"),
  planTimeline: byId("plan-timeline"),
  planTotal: byId("plan-total"),
  startDay: byId("start-day"),
  plannerError: byId("planner-error"),
  soundToggle: byId("sound-toggle"),
  backToPlan: byId("back-to-plan"),
  focusCard: document.querySelector(".focus-card"),
  focusStatus: byId("focus-status"),
  focusPosition: byId("focus-position"),
  currentTitle: byId("current-title"),
  countdown: byId("countdown"),
  timeNote: byId("time-note"),
  progressBar: byId("progress-bar"),
  timerToggle: byId("timer-toggle"),
  finishBlock: byId("finish-block"),
  focusControls: byId("focus-controls"),
  completeActions: byId("complete-actions"),
  focusTimeline: byId("focus-timeline"),
  resetDay: byId("reset-day"),
  newDay: byId("new-day"),
  jsonInput: byId("json-input"),
  loadTemplate: byId("load-template"),
  copyTemplate: byId("copy-template"),
  importJson: byId("import-json"),
  jsonMessage: byId("json-message"),
};

let state = loadState(localStorage);
let ticker = null;
let audioContext = null;
let actionLockedUntil = 0;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function persist() {
  try {
    saveState(state, localStorage);
  } catch {
    elements.plannerError.textContent = "Could not save in this browser. The timer still works for this tab.";
  }
}

function isValidBlock(block) {
  return Boolean(
    block.title?.trim() &&
      Number.isInteger(Number(block.durationMinutes)) &&
      Number(block.durationMinutes) >= 1 &&
      Number(block.durationMinutes) <= 1_440,
  );
}

function validPlan() {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(state.planStartTime) &&
    state.blocks.length > 0 &&
    state.blocks.every(isValidBlock);
}

function getTimeline() {
  if (!validPlan()) return [];
  return buildTimeline(state.blocks, startTimeToTimestamp(state.planStartTime));
}

function showPlanner({ focusHeading = false } = {}) {
  elements.focusView.hidden = true;
  elements.plannerView.hidden = false;
  stopTicker();
  renderPlanner();
  document.title = "Plan the day — Work Timer";
  if (focusHeading) elements.plannerHeading.focus();
}

function showFocus({ focusHeading = false } = {}) {
  elements.plannerView.hidden = true;
  elements.focusView.hidden = false;
  renderFocus();
  if (focusHeading) elements.currentTitle.focus();
}

function renderPlanner() {
  elements.planStart.value = state.planStartTime;
  elements.soundToggle.checked = state.soundEnabled;
  elements.blockList.replaceChildren();

  state.blocks.forEach((block, index) => {
    const fragment = elements.blockTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".block-row");
    const title = fragment.querySelector(".block-title");
    const duration = fragment.querySelector(".block-duration");
    const up = fragment.querySelector(".move-up");
    const down = fragment.querySelector(".move-down");

    row.dataset.id = block.id;
    fragment.querySelector(".block-number").textContent = String(index + 1).padStart(2, "0");
    title.value = block.title;
    title.setAttribute("aria-label", `Work block ${index + 1} title`);
    title.setAttribute("aria-invalid", block.title?.trim() ? "false" : "true");
    duration.value = block.durationMinutes || "";
    duration.setAttribute("aria-label", `Work block ${index + 1} duration in minutes`);
    duration.setAttribute("aria-invalid", isValidBlock({ ...block, title: "valid" }) ? "false" : "true");
    up.disabled = index === 0;
    down.disabled = index === state.blocks.length - 1;

    elements.blockList.append(fragment);
  });

  renderPlanTimeline();
  elements.startDay.disabled = !validPlan();
  elements.plannerError.textContent = validPlan() ? "" : "Every block needs a title and 1–1440 minutes.";
}

function renderPlanTimeline() {
  elements.planTimeline.replaceChildren();
  const timeline = getTimeline();

  if (!timeline.length) {
    const empty = document.createElement("li");
    empty.className = "timeline-item";
    empty.textContent = "Add a valid block to see the timeline.";
    elements.planTimeline.append(empty);
    elements.planTotal.textContent = "";
    return;
  }

  timeline.forEach((item) => {
    const row = document.createElement("li");
    row.className = "timeline-item";

    const time = document.createElement("span");
    time.className = "timeline-time";
    time.textContent = `${formatClock(item.startAt)}–${formatClock(item.endAt)}`;

    const dot = document.createElement("span");
    dot.className = "timeline-dot";
    dot.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "timeline-title";
    title.textContent = item.title;

    const duration = document.createElement("span");
    duration.className = "timeline-duration";
    duration.textContent = formatDuration(item.durationMinutes);

    row.append(time, dot, title, duration);
    elements.planTimeline.append(row);
  });

  const totalMinutes = state.blocks.reduce((sum, block) => sum + Number(block.durationMinutes), 0);
  elements.planTotal.textContent = `${formatDuration(totalMinutes)} · ends ${formatClock(timeline.at(-1).endAt)}`;
}

function updateBlockFromInput(target) {
  const row = target.closest(".block-row");
  const block = state.blocks.find((item) => item.id === row?.dataset.id);
  if (!block) return;

  if (target.matches(".block-title")) block.title = target.value;
  if (target.matches(".block-duration")) block.durationMinutes = Number(target.value);
  persist();
  renderPlanTimeline();
  elements.startDay.disabled = !validPlan();
  elements.plannerError.textContent = validPlan() ? "" : "Every block needs a title and 1–1440 minutes.";
  target.setAttribute("aria-invalid", target.matches(".block-title")
    ? String(!target.value.trim())
    : String(!isValidBlock({ title: "valid", durationMinutes: Number(target.value) })));
}

function handleBlockAction(target) {
  const action = target.closest(".remove-block, .move-up, .move-down");
  if (!action) return;
  const row = target.closest(".block-row");
  const index = state.blocks.findIndex((item) => item.id === row?.dataset.id);
  if (index < 0) return;

  const originalId = state.blocks[index].id;
  const actionClass = action.classList.contains("move-up") ? "move-up" : "move-down";
  const removing = action.matches(".remove-block");

  if (removing) state.blocks.splice(index, 1);
  if (action.matches(".move-up") && index > 0) {
    [state.blocks[index - 1], state.blocks[index]] = [state.blocks[index], state.blocks[index - 1]];
  }
  if (action.matches(".move-down") && index < state.blocks.length - 1) {
    [state.blocks[index + 1], state.blocks[index]] = [state.blocks[index], state.blocks[index + 1]];
  }
  persist();
  renderPlanner();

  const focusId = removing ? state.blocks[Math.min(index, state.blocks.length - 1)]?.id : originalId;
  const focusRow = [...elements.blockList.querySelectorAll(".block-row")]
    .find((candidate) => candidate.dataset.id === focusId);
  const matchingAction = focusRow?.querySelector(`.${actionClass}`);
  if (!removing && matchingAction && !matchingAction.disabled) matchingAction.focus();
  else if (focusRow) focusRow.querySelector(".block-title")?.focus();
  else elements.addBlock.focus();
}

function currentBlock() {
  return state.blocks[state.session.currentIndex];
}

function startDay() {
  if (!validPlan()) {
    elements.plannerError.textContent = "Fix the invalid work blocks before starting.";
    return;
  }
  state.blocks = state.blocks.map((block) => ({ ...block, title: block.title.trim(), status: "pending" }));
  state.session = {
    phase: "ready",
    currentIndex: 0,
    endAt: null,
    remainingMs: state.blocks[0].durationMinutes * 60_000,
    soundPlayed: false,
  };
  persist();
  showFocus({ focusHeading: true });
}

function timerStatusLabel(phase) {
  return {
    ready: "READY",
    paused: "PAUSED",
    running: "FOCUSING",
    expired: "TIME’S UP",
    completed: "COMPLETE",
  }[phase] ?? "READY";
}

function renderFocus() {
  const session = state.session;
  const completed = session.phase === "completed";
  elements.soundToggle.checked = state.soundEnabled;
  elements.focusCard.classList.toggle("is-expired", session.phase === "expired");
  elements.focusCard.classList.toggle("is-complete", completed);
  elements.focusStatus.className = `status-pill is-${session.phase}`;
  const statusLabel = timerStatusLabel(session.phase);
  if (elements.focusStatus.textContent !== statusLabel) elements.focusStatus.textContent = statusLabel;
  elements.focusControls.hidden = completed;
  elements.completeActions.hidden = !completed;

  if (completed) {
    elements.focusPosition.textContent = `${state.blocks.length} / ${state.blocks.length}`;
    elements.currentTitle.textContent = "Day complete.";
    elements.countdown.textContent = "DONE";
    elements.timeNote.textContent = `${state.blocks.length} work block${state.blocks.length === 1 ? "" : "s"} finished.`;
    elements.progressBar.style.width = "100%";
    document.title = "Done — Work Timer";
  } else {
    const block = currentBlock();
    if (!block) {
      state.session.phase = "completed";
      persist();
      renderFocus();
      return;
    }

    const remaining = remainingTime(session);
    const total = block.durationMinutes * 60_000;
    const progress = Math.min(100, Math.max(0, ((total - remaining) / total) * 100));
    elements.focusPosition.textContent = `${session.currentIndex + 1} / ${state.blocks.length}`;
    elements.currentTitle.textContent = block.title;
    elements.countdown.textContent = formatCountdown(remaining);
    elements.progressBar.style.width = `${progress}%`;

    if (session.phase === "running") {
      elements.timeNote.textContent = `Ends at ${formatClock(session.endAt)}. Stay on this until then.`;
      elements.timerToggle.textContent = "Pause";
      elements.finishBlock.textContent = "Done early";
      elements.finishBlock.hidden = false;
      document.title = `${formatCountdown(remaining)} · ${block.title}`;
    } else if (session.phase === "expired") {
      const isLast = session.currentIndex === state.blocks.length - 1;
      elements.timeNote.textContent = "The deadline arrived. Close this block and move.";
      elements.timerToggle.textContent = isLast ? "Finish the day" : "Start next block";
      elements.finishBlock.hidden = true;
      document.title = `Time’s up · ${block.title}`;
    } else {
      elements.timeNote.textContent = `${formatDuration(block.durationMinutes)} committed to this block.`;
      elements.timerToggle.textContent = session.phase === "paused" ? "Resume" : "Start timer";
      elements.finishBlock.textContent = "Done early";
      elements.finishBlock.hidden = false;
      document.title = `${block.title} — Work Timer`;
    }
  }

  renderFocusTimeline();
  if (session.phase === "running") ensureTicker();
  else stopTicker();
}

function renderFocusTimeline() {
  elements.focusTimeline.replaceChildren();
  state.blocks.forEach((block, index) => {
    const row = document.createElement("li");
    row.className = "focus-timeline-item";
    if (index === state.session.currentIndex && state.session.phase !== "completed") row.classList.add("is-current");
    if (block.status === "complete") row.classList.add("is-done");

    const marker = document.createElement("span");
    marker.className = "focus-item-marker";
    marker.textContent = block.status === "complete" ? "✓" : String(index + 1).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "focus-item-title";
    title.textContent = block.title;

    const duration = document.createElement("span");
    duration.className = "focus-item-duration";
    duration.textContent = formatDuration(block.durationMinutes);

    row.append(marker, title, duration);
    elements.focusTimeline.append(row);
  });
}

function toggleTimer() {
  if (state.session.phase === "running") {
    state.session = { ...state.session, ...pauseTimer(state.session), soundPlayed: false };
  } else if (state.session.phase === "expired") {
    advanceBlock(true);
    return;
  } else {
    const timer = state.session.phase === "paused"
      ? resumeTimer(state.session)
      : startTimer(state.session.remainingMs ?? currentBlock().durationMinutes * 60_000);
    state.session = { ...state.session, ...timer, soundPlayed: false };
    unlockAudio();
  }
  persist();
  renderFocus();
}

function advanceBlock(startNext = false) {
  const index = state.session.currentIndex;
  if (state.blocks[index]) state.blocks[index].status = "complete";
  const nextIndex = state.blocks.findIndex((block, candidateIndex) => candidateIndex > index && block.status !== "complete");

  if (nextIndex === -1) {
    state.session = {
      phase: "completed",
      currentIndex: state.blocks.length,
      endAt: null,
      remainingMs: 0,
      soundPlayed: true,
    };
  } else {
    const remainingMs = state.blocks[nextIndex].durationMinutes * 60_000;
    state.session = {
      phase: "ready",
      currentIndex: nextIndex,
      endAt: null,
      remainingMs,
      soundPlayed: false,
    };
    if (startNext) {
      state.session = { ...state.session, ...startTimer(remainingMs), soundPlayed: false };
      unlockAudio();
    }
  }

  persist();
  renderFocus();
  if (state.session.phase === "completed") elements.currentTitle.focus();
}

function runGuardedAction(action) {
  const now = Date.now();
  if (now < actionLockedUntil) return;
  actionLockedUntil = now + 350;
  action();
}

function tick() {
  if (state.session.phase !== "running") return;
  const reconciled = reconcileTimer(state.session);
  const expiredNow = reconciled.phase === "expired";
  state.session = { ...state.session, ...reconciled };

  if (expiredNow) {
    if (!state.session.soundPlayed) playChime();
    state.session.soundPlayed = true;
    persist();
  }
  renderFocus();
}

function ensureTicker() {
  if (ticker) return;
  ticker = window.setInterval(tick, 250);
}

function stopTicker() {
  if (!ticker) return;
  window.clearInterval(ticker);
  ticker = null;
}

function unlockAudio() {
  if (!state.soundEnabled || audioContext) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    audioContext = new AudioContext();
  } catch {
    audioContext = null;
  }
}

function playChime() {
  if (!state.soundEnabled) return;
  unlockAudio();
  if (!audioContext) return;

  try {
    const start = audioContext.currentTime;
    [440, 660].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.18, start + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.18 + 0.35);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(start + index * 0.18);
      oscillator.stop(start + index * 0.18 + 0.38);
    });
  } catch {
    // Visual expiry state remains the source of truth when audio is unavailable.
  }
}

function returnToPlan() {
  const active = ["running", "paused", "expired"].includes(state.session.phase);
  if (active && !window.confirm("Stop this focus session and return to the plan?")) return;
  state.blocks = state.blocks.map((block) => ({ ...block, status: "pending" }));
  state.session = { phase: "draft", currentIndex: 0, endAt: null, remainingMs: null, soundPlayed: false };
  persist();
  showPlanner({ focusHeading: true });
}

function resetEverything() {
  if (!window.confirm("Reset the whole schedule and timer?")) return;
  state = defaultState();
  persist();
  showPlanner({ focusHeading: true });
}

function importSchedule() {
  elements.jsonMessage.classList.remove("is-error");
  try {
    const imported = parseScheduleJSON(elements.jsonInput.value);
    const active = state.session.phase !== "draft";
    if (active && !window.confirm("Replace the current plan and stop its timer?")) return;

    state.planStartTime = imported.startTime;
    state.blocks = imported.blocks;
    state.session = { phase: "draft", currentIndex: 0, endAt: null, remainingMs: null, soundPlayed: false };
    persist();
    showPlanner();
    elements.jsonMessage.textContent = `Imported ${imported.blocks.length} work block${imported.blocks.length === 1 ? "" : "s"}.`;
  } catch (error) {
    elements.jsonMessage.classList.add("is-error");
    elements.jsonMessage.textContent = error instanceof Error ? error.message : "Could not import that schedule.";
  }
}

async function copyTemplate() {
  try {
    await navigator.clipboard.writeText(SCHEDULE_TEMPLATE_TEXT);
    elements.jsonMessage.classList.remove("is-error");
    elements.jsonMessage.textContent = "Template copied.";
  } catch {
    elements.jsonInput.value = SCHEDULE_TEMPLATE_TEXT;
    elements.jsonInput.focus();
    elements.jsonInput.select();
    elements.jsonMessage.classList.add("is-error");
    elements.jsonMessage.textContent = "Clipboard access was blocked. The template is selected for manual copying.";
  }
}

elements.planStart.addEventListener("input", () => {
  state.planStartTime = elements.planStart.value;
  persist();
  renderPlanTimeline();
  elements.startDay.disabled = !validPlan();
});

elements.blockList.addEventListener("input", (event) => updateBlockFromInput(event.target));
elements.blockList.addEventListener("click", (event) => handleBlockAction(event.target));
elements.addBlock.addEventListener("click", () => {
  state.blocks.push({ id: makeId(), title: "", durationMinutes: 30, status: "pending" });
  persist();
  renderPlanner();
  elements.blockList.querySelector(".block-row:last-child .block-title")?.focus();
});
elements.startDay.addEventListener("click", startDay);
elements.timerToggle.addEventListener("click", () => runGuardedAction(toggleTimer));
elements.finishBlock.addEventListener("click", () => runGuardedAction(() => advanceBlock(false)));
elements.backToPlan.addEventListener("click", returnToPlan);
elements.newDay.addEventListener("click", returnToPlan);
elements.resetDay.addEventListener("click", resetEverything);
elements.soundToggle.addEventListener("change", () => {
  state.soundEnabled = elements.soundToggle.checked;
  if (state.soundEnabled) unlockAudio();
  persist();
});
elements.loadTemplate.addEventListener("click", () => {
  elements.jsonInput.value = SCHEDULE_TEMPLATE_TEXT;
  elements.jsonMessage.textContent = "Template loaded. Edit it, then import.";
});
elements.copyTemplate.addEventListener("click", copyTemplate);
elements.importJson.addEventListener("click", importSchedule);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
window.addEventListener("beforeunload", persist);

if (state.session.phase === "running") {
  state.session = { ...state.session, ...reconcileTimer(state.session) };
  persist();
}

if (state.session.phase === "draft") showPlanner();
else showFocus();
