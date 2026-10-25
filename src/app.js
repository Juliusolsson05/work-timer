import {
  QUICK_PRESETS,
  SCHEDULE_TEMPLATE_TEXT,
  buildTimeline,
  draftSession,
  dueReminder,
  focusedTime,
  formatClock,
  formatDuration,
  formatTimerDisplay,
  isValidMinutes,
  loadState,
  makeId,
  parseScheduleJSON,
  pauseTimer,
  reconcileTimer,
  remainingTime,
  resumeTimer,
  saveState,
  sessionBlocks,
  startTimeToTimestamp,
  startTimer,
} from "./core.js?v=3"; // keep in step with the stamps in index.html

const byId = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element;
};

const elements = {
  clock: byId("clock"),
  soundToggle: byId("sound-toggle"),
  setupView: byId("setup-view"),
  setupTitle: byId("setup-title"),
  setupDigits: byId("setup-digits"),
  presets: byId("presets"),
  customMinutes: byId("custom-minutes"),
  startQuick: byId("start-quick"),
  planButton: byId("plan-button"),
  planCount: byId("plan-count"),
  planPanel: byId("plan-panel"),
  closePlan: byId("close-plan"),
  toggleImport: byId("toggle-import"),
  importPanel: byId("import-panel"),
  jsonInput: byId("json-input"),
  loadTemplate: byId("load-template"),
  copyTemplate: byId("copy-template"),
  importJson: byId("import-json"),
  jsonMessage: byId("json-message"),
  addBlock: byId("add-block"),
  planStart: byId("plan-start"),
  blockList: byId("block-list"),
  blockTemplate: byId("block-row-template"),
  planEmpty: byId("plan-empty"),
  planSummary: byId("plan-summary"),
  plannerError: byId("planner-error"),
  startPlan: byId("start-plan"),
  addReminder: byId("add-reminder"),
  reminderForm: byId("reminder-form"),
  reminderLabel: byId("reminder-label"),
  reminderInterval: byId("reminder-interval"),
  cancelReminder: byId("cancel-reminder"),
  reminderList: byId("reminder-list"),
  remindersEmpty: byId("reminders-empty"),
  focusView: byId("focus-view"),
  currentTitle: byId("current-title"),
  countdown: byId("countdown"),
  statusLine: byId("status-line"),
  timerToggle: byId("timer-toggle"),
  finishBlock: byId("finish-block"),
  stopSession: byId("stop-session"),
  nextAction: byId("next-action"),
  planChips: byId("plan-chips"),
  reminderChips: byId("reminder-chips"),
  reminderAlert: byId("reminder-alert"),
  reminderAlertTitle: byId("reminder-alert-title"),
  dismissReminder: byId("dismiss-reminder"),
};

const PRESET_LABELS = { 60: "1 hr", 90: "1.5 hr", 120: "2 hr" };
const BLOCK_ERROR = "Every block needs a title and 1–1440 minutes.";

let state = loadState(localStorage);
let ticker = null;
let audioContext = null;
// The reminder tone gets its own context so dismissing can close() it and cut
// the queued beeps instantly; the expiry chime context is long-lived.
let reminderToneContext = null;
let actionLockedUntil = 0;
// Not persisted: the preset is a per-visit choice, and Focus Flow also opened
// on 30 every time.
let quickChoice = 30;

function persist() {
  try {
    saveState(state, localStorage);
  } catch {
    elements.plannerError.textContent = "Could not save in this browser. The timer still works for this tab.";
  }
}

function isValidBlock(block) {
  return Boolean(block.title?.trim() && isValidMinutes(Number(block.durationMinutes)));
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

function isQuick() {
  return state.session.quickMinutes != null;
}

function currentBlock() {
  return sessionBlocks(state)[state.session.currentIndex];
}

// One renderer for both digit spans so the setup preview and the live
// countdown can never disagree on format or size class.
function setDigits(element, milliseconds) {
  const text = formatTimerDisplay(milliseconds);
  if (element.textContent !== text) element.textContent = text;
  element.dataset.chars = String(text.length);
}

/* ---------------- Setup view ---------------- */

function showSetup({ focusHeading = false } = {}) {
  elements.focusView.hidden = true;
  elements.setupView.hidden = false;
  elements.planButton.hidden = false;
  elements.reminderAlert.hidden = true;
  stopTicker();
  renderSetup();
  document.title = "Focus";
  if (focusHeading) elements.setupTitle.focus();
}

function renderSetup() {
  renderSoundToggle();
  renderPresets();
  renderPlanner();
  renderReminders();
}

function renderPresets() {
  const customValue = Number(elements.customMinutes.value);
  const customActive = elements.customMinutes.value !== "" && isValidMinutes(customValue);
  // Built once and then only re-classed: rebuilding on every click would
  // throw away the focused button and strand keyboard users on <body>.
  if (!elements.presets.childElementCount) {
    elements.presets.append(...QUICK_PRESETS.map((minutes) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pill";
      button.dataset.minutes = String(minutes);
      button.textContent = PRESET_LABELS[minutes] ?? `${minutes} min`;
      return button;
    }));
  }
  for (const button of elements.presets.children) {
    const selected = !customActive && quickChoice === Number(button.dataset.minutes);
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  setDigits(elements.setupDigits, quickChoice * 60_000);
  elements.startQuick.disabled = !isValidMinutes(quickChoice);
}

function renderPlanner() {
  elements.planStart.value = state.planStartTime;
  elements.blockList.replaceChildren();

  state.blocks.forEach((block, index) => {
    const fragment = elements.blockTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".block-row");
    const title = fragment.querySelector(".block-title");
    const duration = fragment.querySelector(".block-duration");

    row.dataset.id = block.id;
    title.value = block.title;
    title.setAttribute("aria-label", `Block ${index + 1} title`);
    title.setAttribute("aria-invalid", String(!block.title?.trim()));
    duration.value = block.durationMinutes || "";
    duration.setAttribute("aria-label", `Block ${index + 1} minutes`);
    duration.setAttribute("aria-invalid", String(!isValidMinutes(Number(block.durationMinutes))));
    fragment.querySelector(".move-up").disabled = index === 0;
    fragment.querySelector(".move-down").disabled = index === state.blocks.length - 1;

    elements.blockList.append(fragment);
  });

  renderPlanMeta();
}

// Typing in a row must not rebuild the rows (that would steal focus and the
// caret mid-word), so the times and summary that react to every keystroke
// live here, apart from renderPlanner's structural rebuild.
function renderPlanMeta() {
  const timeline = getTimeline();
  const valid = timeline.length > 0;
  const rows = elements.blockList.querySelectorAll(".block-row");

  rows.forEach((row, index) => {
    const meta = row.querySelector(".block-meta");
    const item = timeline[index];
    meta.textContent = item ? `${formatClock(item.startAt)}–${formatClock(item.endAt)}` : "—";
  });

  elements.planEmpty.hidden = state.blocks.length > 0;
  elements.planCount.hidden = state.blocks.length === 0;
  elements.planCount.textContent = String(state.blocks.length);
  elements.planButton.setAttribute("aria-label", state.blocks.length
    ? `Open plan, ${state.blocks.length} block${state.blocks.length === 1 ? "" : "s"}`
    : "Open plan");
  if (valid) {
    const totalMinutes = state.blocks.reduce((sum, block) => sum + Number(block.durationMinutes), 0);
    elements.planSummary.textContent = `${formatDuration(totalMinutes)} · ends ${formatClock(timeline.at(-1).endAt)}`;
  } else {
    elements.planSummary.textContent = "";
  }
  elements.startPlan.disabled = !valid;
  elements.plannerError.textContent = state.blocks.length && !valid ? BLOCK_ERROR : "";
}

function updateBlockFromInput(target) {
  const row = target.closest(".block-row");
  const block = state.blocks.find((item) => item.id === row?.dataset.id);
  if (!block) return;

  if (target.matches(".block-title")) {
    block.title = target.value;
    target.setAttribute("aria-invalid", String(!target.value.trim()));
  }
  if (target.matches(".block-duration")) {
    block.durationMinutes = Number(target.value);
    target.setAttribute("aria-invalid", String(!isValidMinutes(Number(target.value))));
  }
  persist();
  renderPlanMeta();
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

  // Keep keyboard users on the thing they just moved (or its neighbour after
  // a removal) instead of dumping focus to <body> after the rebuild.
  const focusId = removing ? state.blocks[Math.min(index, state.blocks.length - 1)]?.id : originalId;
  const focusRow = [...elements.blockList.querySelectorAll(".block-row")]
    .find((candidate) => candidate.dataset.id === focusId);
  const matchingAction = focusRow?.querySelector(`.${actionClass}`);
  if (!removing && matchingAction && !matchingAction.disabled) matchingAction.focus();
  else if (focusRow) focusRow.querySelector(".block-title")?.focus();
  else elements.addBlock.focus();
}

function renderReminders() {
  elements.reminderList.replaceChildren(...state.reminders.map((reminder) => {
    const row = document.createElement("div");
    row.className = "row-card";
    row.dataset.id = reminder.id;

    const main = document.createElement("div");
    main.className = "row-main";
    const label = document.createElement("span");
    label.className = "row-title";
    label.textContent = reminder.label;
    const meta = document.createElement("span");
    meta.className = "row-meta";
    meta.textContent = `Every ${reminder.intervalMinutes} min`;
    main.append(label, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button remove-reminder";
    remove.setAttribute("aria-label", `Remove reminder ${reminder.label}`);
    remove.innerHTML = '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>';

    row.append(main, remove);
    return row;
  }));
  elements.remindersEmpty.hidden = state.reminders.length > 0 || !elements.reminderForm.hidden;
}

function openReminderForm(open) {
  elements.reminderForm.hidden = !open;
  elements.addReminder.hidden = open;
  if (open) {
    elements.reminderLabel.value = "";
    elements.reminderInterval.value = "30";
    elements.reminderLabel.focus();
  }
  renderReminders();
}

function submitReminder(event) {
  event.preventDefault();
  const label = elements.reminderLabel.value.trim();
  const intervalMinutes = Number(elements.reminderInterval.value);
  if (!label) {
    elements.reminderLabel.focus();
    return;
  }
  if (!isValidMinutes(intervalMinutes)) {
    elements.reminderInterval.setAttribute("aria-invalid", "true");
    elements.reminderInterval.focus();
    return;
  }
  elements.reminderInterval.removeAttribute("aria-invalid");
  state.reminders.push({ id: makeId(), label: label.slice(0, 80), intervalMinutes });
  persist();
  openReminderForm(false);
  elements.addReminder.focus();
}

/* ---------------- Starting sessions ---------------- */

function startQuick() {
  if (!isValidMinutes(quickChoice)) return;
  // Focus Flow's "Start Focus" started counting immediately; no extra
  // "ready" step for a one-off session.
  state.session = {
    ...draftSession(),
    phase: "running",
    quickMinutes: quickChoice,
    ...startTimer(quickChoice * 60_000),
  };
  unlockAudio();
  persist();
  showFocus({ focusHeading: true });
}

function startPlan() {
  if (!validPlan()) {
    elements.plannerError.textContent = BLOCK_ERROR;
    return;
  }
  state.blocks = state.blocks.map((block) => ({ ...block, title: block.title.trim(), status: "pending" }));
  // Pressing "Start plan" is the commitment, so the first block runs right
  // away like Start Focus. Later blocks still wait in "ready" after a
  // done-early, so you choose when the next one starts.
  state.session = {
    ...draftSession(),
    ...startTimer(state.blocks[0].durationMinutes * 60_000),
  };
  unlockAudio();
  persist();
  showFocus({ focusHeading: true });
}

/* ---------------- Focus view ---------------- */

function showFocus({ focusHeading = false } = {}) {
  elements.setupView.hidden = true;
  elements.focusView.hidden = false;
  // The plan is edited before a session, not during one; the running view
  // already shows its chips.
  setPlanOpen(false);
  elements.planButton.hidden = true;
  renderFocus();
  if (focusHeading) elements.currentTitle.focus();
}

function renderFocus() {
  const session = state.session;
  const blocks = sessionBlocks(state);
  const quick = isQuick();
  const completed = session.phase === "completed";
  const expired = session.phase === "expired";
  renderSoundToggle();

  elements.timerToggle.hidden = completed || expired;
  elements.finishBlock.hidden = completed || expired;
  elements.nextAction.hidden = !expired;
  elements.countdown.classList.toggle("is-muted", completed || expired);

  if (completed) {
    elements.currentTitle.textContent = quick ? "Focus" : "Plan done";
    setDigits(elements.countdown, 0);
    elements.statusLine.textContent = quick
      ? "Session complete"
      : `${blocks.length} block${blocks.length === 1 ? "" : "s"} finished`;
    elements.stopSession.setAttribute("aria-label", "Back to start");
    document.title = "Done — Focus";
  } else {
    const block = currentBlock();
    if (!block) {
      state.session.phase = "completed";
      persist();
      renderFocus();
      return;
    }

    const remaining = remainingTime(session);
    const position = quick ? "" : ` · ${session.currentIndex + 1} of ${blocks.length}`;
    elements.currentTitle.textContent = `${block.title}${position}`;
    setDigits(elements.countdown, remaining);
    elements.stopSession.setAttribute("aria-label", "Stop and go back");

    const next = blocks[session.currentIndex + 1];
    const thenNext = next ? ` · then ${next.title}` : "";
    const paused = session.phase !== "running";
    elements.timerToggle.classList.toggle("is-paused", paused);
    elements.timerToggle.setAttribute("aria-label", paused ? (session.phase === "ready" ? "Start" : "Resume") : "Pause");

    if (session.phase === "running") {
      elements.statusLine.textContent = `Ends ${formatClock(session.endAt)}${thenNext}`;
      document.title = `${formatTimerDisplay(remaining)} · ${block.title}`;
    } else if (expired) {
      elements.statusLine.textContent = "Time’s up";
      elements.nextAction.textContent = next ? `Start ${next.title}` : quick ? "Done" : "Finish plan";
      document.title = `Time’s up · ${block.title}`;
    } else if (session.phase === "paused") {
      elements.statusLine.textContent = `Paused${thenNext}`;
      document.title = `Paused · ${block.title}`;
    } else {
      elements.statusLine.textContent = `Ready · ${formatDuration(block.durationMinutes)}`;
      document.title = `${block.title} — Focus`;
    }
  }

  renderChips(blocks, quick, completed);
  renderAlert();
  if (session.phase === "running") ensureTicker();
  else stopTicker();
}

function renderChips(blocks, quick, completed) {
  // Quick sessions are a single block, so a one-chip "plan" would be noise.
  elements.planChips.replaceChildren(...(quick ? [] : blocks.map((block, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (block.status === "complete") chip.classList.add("is-done");
    else if (!completed && index === state.session.currentIndex) chip.classList.add("is-current");
    chip.textContent = `${block.title} · ${formatDuration(block.durationMinutes)}`;
    return chip;
  })));
  elements.reminderChips.replaceChildren(...(completed ? [] : state.reminders.map((reminder) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${reminder.label} · ${reminder.intervalMinutes}m`;
    return chip;
  })));
}

function renderAlert() {
  const reminder = state.reminders.find((item) => item.id === state.session.activeReminderId);
  const wasHidden = elements.reminderAlert.hidden;
  elements.reminderAlert.hidden = !reminder;
  if (!reminder) return;
  elements.reminderAlertTitle.textContent = reminder.label;
  if (wasHidden) elements.dismissReminder.focus();
}

/* ---------------- Timer transitions ---------------- */

function toggleTimer() {
  const session = state.session;
  if (session.activeReminderId) return;
  if (session.phase === "running") {
    state.session = { ...session, ...pauseTimer(session), soundPlayed: false };
  } else if (session.phase === "ready" || session.phase === "paused") {
    const timer = session.phase === "paused"
      ? resumeTimer(session)
      : startTimer(session.remainingMs ?? currentBlock().durationMinutes * 60_000);
    state.session = { ...session, ...timer, soundPlayed: false };
    unlockAudio();
  } else {
    return;
  }
  persist();
  renderFocus();
}

function advanceBlock(startNext = false) {
  const session = state.session;
  const blocks = sessionBlocks(state);
  const index = session.currentIndex;
  const block = blocks[index];
  if (!block) return;

  // Bank what was really focused on this block (less than the full length on
  // done-early) so reminder timing carries across the whole plan.
  const focusedBeforeMs = focusedTime(session, block.durationMinutes * 60_000);
  if (!isQuick()) state.blocks[index].status = "complete";
  const nextIndex = isQuick()
    ? -1
    : state.blocks.findIndex((item, candidateIndex) => candidateIndex > index && item.status !== "complete");

  const base = {
    ...session,
    focusedBeforeMs,
    reminderCheckedMs: Math.max(session.reminderCheckedMs ?? 0, focusedBeforeMs),
    activeReminderId: null,
  };

  if (nextIndex === -1) {
    state.session = { ...base, phase: "completed", currentIndex: blocks.length, endAt: null, remainingMs: 0, soundPlayed: true };
  } else {
    const remainingMs = state.blocks[nextIndex].durationMinutes * 60_000;
    state.session = { ...base, phase: "ready", currentIndex: nextIndex, endAt: null, remainingMs, soundPlayed: false };
    if (startNext) {
      state.session = { ...state.session, ...startTimer(remainingMs) };
      unlockAudio();
    }
  }

  persist();
  renderFocus();
  if (state.session.phase === "completed") elements.stopSession.focus();
}

function stopSession() {
  const session = state.session;
  if (session.phase !== "completed" && !window.confirm("Stop this session and go back?")) return;
  stopReminderTone();
  state.blocks = state.blocks.map((block) => ({ ...block, status: "pending" }));
  state.session = draftSession();
  persist();
  showSetup({ focusHeading: true });
}

function dismissReminder() {
  if (!state.session.activeReminderId) return;
  stopReminderTone();
  // Firing paused the timer, so Done resumes it, as in Focus Flow. Resuming
  // from remainingMs (and not from a stale endAt) means time spent looking at
  // the alert is not charged to the block.
  state.session = { ...state.session, ...resumeTimer(state.session), activeReminderId: null, soundPlayed: false };
  persist();
  renderFocus();
  elements.timerToggle.focus();
}

// Double-clicks on Done/Next used to skip a whole block; a short lock after
// any transition keeps one intent to one transition.
function runGuardedAction(action) {
  const now = Date.now();
  if (now < actionLockedUntil) return;
  actionLockedUntil = now + 350;
  action();
}

function tick() {
  if (state.session.phase !== "running") return;
  const block = currentBlock();
  if (!block) return;
  const reconciled = reconcileTimer(state.session);
  state.session = { ...state.session, ...reconciled };
  const focused = focusedTime(state.session, block.durationMinutes * 60_000);

  if (reconciled.phase === "expired") {
    // Expiry already demands attention; a reminder due in the same instant
    // would stack a second alert on top, so it is consumed silently.
    state.session.reminderCheckedMs = focused;
    if (!state.session.soundPlayed) playChime();
    state.session.soundPlayed = true;
    persist();
  } else {
    const due = dueReminder(state.reminders, state.session.reminderCheckedMs ?? 0, focused);
    state.session.reminderCheckedMs = focused;
    if (due) {
      state.session = { ...state.session, ...pauseTimer(state.session), activeReminderId: due.id };
      playReminderTone();
      persist();
    }
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

/* ---------------- Sound ---------------- */

function renderSoundToggle() {
  elements.soundToggle.textContent = state.soundEnabled ? "Sound on" : "Sound off";
  elements.soundToggle.setAttribute("aria-pressed", String(state.soundEnabled));
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

// Focus Flow's reminder sound: an Apple-like tri-tone repeated every 2s for
// ~40s, cut off by Done. It is deliberately persistent: a reminder you can
// miss by not looking at the tab is not a reminder.
function playReminderTone() {
  if (!state.soundEnabled) return;
  stopReminderTone();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    const context = new AudioContext();
    reminderToneContext = context;
    const beep = (time, frequency) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(time);
      oscillator.stop(time + 0.3);
    };
    const now = context.currentTime;
    for (let index = 0; index < 20; index += 1) {
      const base = now + index * 2;
      beep(base, 880);
      beep(base + 0.35, 1046);
      beep(base + 0.7, 1174);
    }
  } catch {
    reminderToneContext = null;
  }
}

function stopReminderTone() {
  if (!reminderToneContext) return;
  reminderToneContext.close().catch(() => {});
  reminderToneContext = null;
}

/* ---------------- Plan panel ---------------- */

function setPlanOpen(open, { returnFocus = false } = {}) {
  elements.planPanel.hidden = !open;
  elements.planButton.setAttribute("aria-expanded", String(open));
  if (open) {
    (elements.blockList.querySelector(".block-title") ?? elements.addBlock).focus();
  } else if (returnFocus) {
    elements.planButton.focus();
  }
}

/* ---------------- JSON import ---------------- */

function toggleImportPanel() {
  const open = elements.importPanel.hidden;
  elements.importPanel.hidden = !open;
  elements.toggleImport.setAttribute("aria-expanded", String(open));
  if (open) elements.jsonInput.focus();
}

function importSchedule() {
  elements.jsonMessage.classList.remove("is-error");
  try {
    const imported = parseScheduleJSON(elements.jsonInput.value);
    state.planStartTime = imported.startTime;
    state.blocks = imported.blocks;
    state.session = draftSession();
    persist();
    renderPlanner();
    elements.jsonMessage.textContent = `Imported ${imported.blocks.length} block${imported.blocks.length === 1 ? "" : "s"}.`;
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

/* ---------------- Clock ---------------- */

function renderClock() {
  elements.clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ---------------- Wiring ---------------- */

elements.clock.addEventListener("click", () => elements.clock.classList.toggle("is-dimmed"));
elements.soundToggle.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  if (state.soundEnabled) unlockAudio();
  else stopReminderTone();
  persist();
  renderSoundToggle();
});

elements.presets.addEventListener("click", (event) => {
  const button = event.target.closest("[data-minutes]");
  if (!button) return;
  quickChoice = Number(button.dataset.minutes);
  elements.customMinutes.value = "";
  renderPresets();
});
elements.customMinutes.addEventListener("input", () => {
  const minutes = Number(elements.customMinutes.value);
  if (elements.customMinutes.value !== "" && isValidMinutes(minutes)) quickChoice = minutes;
  renderPresets();
});
elements.customMinutes.addEventListener("keydown", (event) => {
  if (event.key === "Enter") startQuick();
});
elements.startQuick.addEventListener("click", startQuick);

elements.planButton.addEventListener("click", () => setPlanOpen(elements.planPanel.hidden));
elements.closePlan.addEventListener("click", () => setPlanOpen(false, { returnFocus: true }));
elements.toggleImport.addEventListener("click", toggleImportPanel);
elements.loadTemplate.addEventListener("click", () => {
  elements.jsonInput.value = SCHEDULE_TEMPLATE_TEXT;
  elements.jsonMessage.classList.remove("is-error");
  elements.jsonMessage.textContent = "Template loaded. Edit it, then import.";
});
elements.copyTemplate.addEventListener("click", copyTemplate);
elements.importJson.addEventListener("click", importSchedule);

elements.planStart.addEventListener("input", () => {
  state.planStartTime = elements.planStart.value;
  persist();
  renderPlanMeta();
});
elements.blockList.addEventListener("input", (event) => updateBlockFromInput(event.target));
elements.blockList.addEventListener("click", (event) => handleBlockAction(event.target));
elements.addBlock.addEventListener("click", () => {
  state.blocks.push({ id: makeId(), title: "", durationMinutes: 30, status: "pending" });
  persist();
  renderPlanner();
  elements.blockList.querySelector(".block-row:last-child .block-title")?.focus();
});
elements.startPlan.addEventListener("click", startPlan);

elements.addReminder.addEventListener("click", () => openReminderForm(true));
elements.cancelReminder.addEventListener("click", () => {
  openReminderForm(false);
  elements.addReminder.focus();
});
elements.reminderForm.addEventListener("submit", submitReminder);
elements.reminderList.addEventListener("click", (event) => {
  const remove = event.target.closest(".remove-reminder");
  if (!remove) return;
  const id = remove.closest(".row-card")?.dataset.id;
  state.reminders = state.reminders.filter((item) => item.id !== id);
  persist();
  renderReminders();
  elements.addReminder.focus();
});

elements.timerToggle.addEventListener("click", () => runGuardedAction(toggleTimer));
elements.finishBlock.addEventListener("click", () => runGuardedAction(() => advanceBlock(false)));
elements.nextAction.addEventListener("click", () => runGuardedAction(() => advanceBlock(true)));
elements.stopSession.addEventListener("click", stopSession);
elements.dismissReminder.addEventListener("click", dismissReminder);

document.addEventListener("keydown", (event) => {
  if (!elements.reminderAlert.hidden) {
    // The alert is modal: Escape or Enter means "Done", and nothing else
    // should reach the timer underneath it.
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      dismissReminder();
    }
    return;
  }
  if (event.key === "Escape" && !elements.planPanel.hidden) {
    setPlanOpen(false, { returnFocus: true });
    return;
  }
  // Space to pause/resume comes from the very first Feb 2025 timer. Skip
  // when typing, and on buttons where Space already means "click this".
  if (event.code !== "Space" || elements.focusView.hidden) return;
  if (event.target.closest?.("input, textarea, button, summary")) return;
  event.preventDefault();
  runGuardedAction(toggleTimer);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});
window.addEventListener("beforeunload", persist);

renderClock();
window.setInterval(renderClock, 1_000);

if (state.session.phase === "running") {
  state.session = { ...state.session, ...reconcileTimer(state.session) };
  persist();
}

if (state.session.phase === "draft") showSetup();
else showFocus();
