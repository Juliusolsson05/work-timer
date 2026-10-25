# Focus

A calm focus timer for ADHD workdays: a white page where a giant countdown is the whole screen. Pick a duration and go, or plan the day as a list of work blocks and let the timer walk you through them.

**Live app:** <https://juliusolsson05.github.io/work-timer/>

## What it does

- **Start Focus:** pick a preset (15 min to 2 hr) or type custom minutes, and the countdown starts.
- **Plan:** list your work blocks, set the start time, and see when each one ends. Start the plan and the blocks run one after another; done-early waits for you before the next one.
- **Reminders:** "Stretch every 30 min" style reminders. They pause the timer behind a full-screen alert with a tri-tone until you press Done, and they still fire if the laptop slept past them.
- The countdown is timestamp-based, so it survives refreshes and sleeping tabs. Space pauses or resumes; click the clock to dim it.
- **Import JSON:** paste an AI-generated schedule into the plan (see below).

There is no account, backend, analytics, or cloud sync.

## Run locally

```bash
npm start
```

Open <http://localhost:4173>.

## Essential checks

```bash
npm test
npm run check
```

The test suite covers schedule import and the timeline, timestamp-based timer restoration, quick sessions, reminder timing across sleep, and loading state saved by older versions.

## Schedule JSON

Choose **Import JSON** in the Plan section, paste an object in this format, and choose **Import**:

```json
{
  "startTime": "09:00",
  "blocks": [
    {
      "title": "Writing",
      "durationMinutes": 150
    },
    {
      "title": "Hackathon outreach",
      "durationMinutes": 60
    }
  ]
}
```

Rules:

- `startTime` uses 24-hour `HH:MM` time.
- `blocks` must contain at least one item and at most 50.
- `title` must be non-empty text up to 120 characters.
- `durationMinutes` must be a whole number from 1 to 1440.

A useful request to give an AI:

> Return only valid schedule JSON for the Focus timer. Use `{ "startTime": "HH:MM", "blocks": [{ "title": "...", "durationMinutes": 30 }] }`. Do not wrap it in Markdown.

## Privacy

All state is stored under `adhd-work-timer:v1` in browser `localStorage`. The application makes no network requests after its static files load.
