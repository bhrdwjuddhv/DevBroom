## What this changes

<!-- One or two sentences. Link the issue it closes, e.g. "Closes #12". -->

## Why

<!-- The problem this solves. -->

## How you tested it

<!-- Be specific. "Ran npm test" is fine for logic changes; for anything touching scanning or
     deletion, describe the folder tree you tried it on. -->

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] Tried it in `npm run dev`

## Safety checklist

Tick only what applies — leave the rest unticked, it isn't a scoreboard.

- [ ] This change touches scanning, sizing, path handling, or deletion
- [ ] If so, I added or updated a test in `electron/scanner.test.js`
- [ ] I did not widen the `preload.js` API beyond what the feature needs
- [ ] Deletion still defaults to the Recycle Bin / Trash
- [ ] No telemetry, analytics, or network calls were added
