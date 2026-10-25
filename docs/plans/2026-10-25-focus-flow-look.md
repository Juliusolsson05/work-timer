# Bring back the Focus Flow look, with work blocks built in

Issue: #2

## Why

PR #1 built the work-block planner and gave it a new dark, dense design
("NOW, NOT LATER", lime accent, bordered panels, monospace step labels). The
owner's earlier timer, Juliusolsson05/focus-flow-timer (a Lovable React +
shadcn app, July 2026), had a calm white page where a giant, thin countdown
*is* the screen. That calm look is the point of the tool, and losing it was
the regression. The aim is to get Focus Flow's look and features back and to
fit the new features into them, not the other way round.

## What "the Focus Flow look" means (source: focus-flow-timer/src)

- `index.css`: white `--background`, near-black text, `--secondary` 96% grey,
  `--muted-foreground` 55% grey, `--border` 92%, 1rem radius, system SF font
  stack. The `.dark` palette exists there but is never applied, so the page
  stays light only.
- `.timer-digit`: weight 200, tabular-nums, -0.05em tracking, line-height 1,
  `clamp(6rem, 42vw, 28rem)`; MM:SS under an hour, HH:MM:SS above it.
- `Index.tsx`: one centred column (max-w-lg, gap-12) holding a small muted
  title, the digits, then either the setup controls or the running controls.
- Round 56px `bg-secondary` icon buttons (lucide Pause/Play/RotateCcw);
  rounded-full pills, where the selected pill is black with white text.
- `CurrentTime`: a top-left `HH:MM` clock in font-light text-2xl that drops
  to 15% opacity when clicked.
- `ReminderManager`: an uppercase muted label with an icon, a "+ Add" link,
  `bg-secondary rounded-2xl` rows, and an inline add form.
- `ReminderAlert`: a full-screen blurred overlay with a card, a pulsing black
  ⏰ circle and a "Done" button; the timer pauses and a repeating tri-tone
  (880/1046/1174 Hz) plays until it is dismissed.
- framer-motion fades and rises with ease `[0.16, 1, 0.3, 1]`.

## Decisions

1. **Stay vanilla in work-timer and do not move into the React repo.**
   work-timer is the deployed one (GitHub Pages, live link in the README),
   has the tested timestamp-based core, and has no build step. Focus Flow
   pulls in ~49 shadcn components and framer-motion to draw about 6 widgets.
   The look is CSS, so it ports cleanly; framer-motion becomes CSS keyframes
   with the same easing.
2. **Keep `core.js` as the logic source of truth** and add the new pure bits
   there so `node --test` covers them: quick sessions, reminder timing,
   focused-time accounting, and the adaptive digit format.
3. **Quick focus (presets) is a session flag, not a plan rewrite.** "Start
   Focus" with 25 min must not wipe the user's day plan, so
   `session.quickMinutes` makes the session run a single synthetic "Focus"
   block while `state.blocks` stays untouched.
4. **Reminders count focused time across the whole session, not per block.**
   Focus Flow reminded on session elapsed time. With 25-minute blocks, a
   per-block clock would never reach a 30-minute "stretch" reminder. Paused
   time does not count. A window `(reminderCheckedMs, focusedMs]` makes a
   reminder that came due during sleep fire once on wake instead of being
   skipped. Focus Flow's `elapsed % interval === 0` check missed exactly
   that case.
5. **State stays version 1 with optional new fields** (`reminders`,
   `session.quickMinutes`, `session.focusedBeforeMs`,
   `session.reminderCheckedMs`, `session.activeReminderId`). Saved state from
   PR #1 has none of them and must load as-is rather than be thrown away by a
   version bump.
6. **Digits shrink with character count.** At 42vw, `02:30:00` is about 185vw
   wide, so Focus Flow overflowed for plans of an hour or more. Font size
   becomes `min(42vw, 210vw / chars, 28rem)` so MM:SS keeps the old size and
   HH:MM:SS fits.
7. **Keep the PR #1 behaviours that matter:** expiry chime, sound toggle,
   double-click guard, confirm before abandoning a running session, and the
   JSON template/copy/import with its validation messages.
8. **Keyboard:** Space pauses or resumes (from the very first Feb 2025
   `timer.html`), but not while typing in an input.

## Layout

Setup (phase `draft`):
- clock at the top left, sound toggle at the top right (muted text button)
- muted "Focus" title, digits showing the selected quick duration
- FOCUS DURATION presets + custom minutes + black "Start Focus" pill
- PLAN section: start time, block rows (title, minutes, up/down/remove), a
  "+ Add" link, a summary "3h 30m · ends 12:30", a "Start plan" pill, and an
  "Import JSON" link that opens the textarea panel inline
- REMINDERS section: unchanged from Focus Flow

Running (`ready` / `running` / `paused` / `expired` / `completed`):
- the block title as the muted heading, plus "2 / 4" for plans
- the digits (muted once expired or complete)
- round buttons: play/pause, done (check), stop (back to setup, confirmed)
- an expired line ("Time's up") with a black "Start next: X" or "Finish" pill
- small muted text "Ends 11:30 · next: Outreach"
- plan chips (done ones struck through) and reminder chips
- a reminder overlay when one fires

## Verification

- `npm test` (core: quick session, reminders across sleep, focused time,
  format, legacy state load) and `npm run check`
- Owner QA in a browser. The app is not launched from the agent.
