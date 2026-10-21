# Now, Not Later

A tiny pressure timer for ADHD workdays. Build a sequence of work blocks, see when each one must end, and focus on one countdown at a time.

## What it does

- Plans sequential work blocks with automatic start and finish times.
- Runs an accurate countdown that survives refreshes and sleeping tabs.
- Pauses, resumes, finishes early, and waits for you before starting the next block.
- Saves the plan and active timer in this browser only.
- Imports an AI-generated schedule through the collapsed **Schedule JSON** tool in the footer.

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

The deliberately small test suite covers schedule import/timeline calculation and timestamp-based timer restoration.

## Schedule JSON

Open **Schedule JSON** in the page footer, paste an object in this format, and choose **Import schedule**:

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

> Return only valid schedule JSON for the Now, Not Later timer. Use `{ "startTime": "HH:MM", "blocks": [{ "title": "...", "durationMinutes": 30 }] }`. Do not wrap it in Markdown.

## Privacy

All state is stored under `adhd-work-timer:v1` in browser `localStorage`. The application makes no network requests after its static files load.
