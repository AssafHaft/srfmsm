# ShiftMaster — surf park shift scheduler

A web app for planning the monthly day/night shift schedule of the maintenance team.
One manager enters the team and the rules, presses **Generate**, reviews and adjusts,
marks a version as final, and shares it. Everything is stored in the browser
(with JSON backup/restore); there is no server.

## How scheduling works

**Hard rules, never broken by the generator.** If nobody can legally fill a slot it stays
empty and is flagged, instead of overloading someone.

- availability: weekly days off, vacations and other dates off
- Day only / Night only workers only get their shift type
- no day shift the morning after a night shift, and no full-day shift either
- max work days in a row, min days off between runs (defaults 5 and 1)
- max shifts per month: per worker, and optionally for everyone
- optional "same shift type for a whole run"
- locked days, pinned shifts and the week carried over from last month stay as they are

**Fairness.** Each worker gets a *fair share*: the month's shifts divided in proportion to
the days they are available. Time off lowers the share and is not made up later. A
max-shifts limit caps the share, and the rest is spread over everyone else. The generator
then balances, in order of the manager's priorities:

- equal workload (shifts and hours compared with fair share)
- fair weekends (premium days shared evenly)
- day/night balance for "Either" workers
- steady routine (even weeks, runs of days instead of scattered single days)
- worker wishes ("prefers day/night", "prefers off" days)

Rounding leftovers (the one extra shift or weekend) are carried into the next month, so
they even out over time.

**Search.** A greedy pass builds a legal schedule; a local search (simulated annealing)
then improves it by handing shifts or runs of shifts between workers and swapping days,
rejecting any change that would break a rule. A month takes a fraction of a second.

## Month to month

The calendar always shows full weeks. When the previous month has a schedule in the app
(preferably marked **final**), the overlapping week is kept exactly as published and the
days before it are used for the rest/streak rules. Alternatives: import a CSV exported
from this app, type in how last month ended, or start fresh.

## Working with a schedule

- Tap a name to replace or remove it; tap an unfilled slot to assign someone. The picker
  ranks people by fit and shows which rules a choice would break.
- Manual choices are pinned; lock a whole day to keep it. Both survive **Generate new version**.
- Each generation is a new version with a quick quality line (unfilled slots, rule issues,
  distance from fair share). Mark the one you publish as final.
- Views: calendar (month grid or list), fairness table, payroll estimate (regular up to
  8h/day, 125% for hours 8–10, 150% beyond).
- Export to Excel (with a summary) or CSV, copy as text for WhatsApp, or print / save as PDF.
- Special days (holidays, events, closures) can change staffing and hours for a date.

## Language

The header has a language button (עברית / English). Hebrew switches the whole app,
including rule messages and exports, to right-to-left. The choice is remembered per
device; the first visit follows the browser's language.

## Where data is stored

Everything is saved in the browser of the device you use (and survives reloads).
Other devices and browsers do not see it unless you use one of these:

- **GitHub sync** (drive icon → GitHub sync settings): saves all data as one JSON file
  in a GitHub repository and loads it on your other devices. Use a **private**
  repository (for example `shiftmaster-data`): this app's own repository is public.
  Create a fine-grained personal access token with access to that repository only and
  the permission *Contents: Read and write*, and paste it in the settings on each
  device (the token stays in that browser only). The drive icon shows a dot when there
  are unsaved changes; the app offers to load newer data saved from another device and
  warns before overwriting someone else's newer save.
- **Backup file**: download a JSON backup and restore it elsewhere.

## Development

Requires Node.js 20+.

```bash
npm install
npm run dev        # local dev server
npm test           # engine, validator, import/export and migration tests
npm run build      # type-check and production build into dist/
```

Code layout:

- `src/lib/engine/` — scheduling engine (`model.ts` problem setup, `targets.ts` fair shares,
  `solver.ts` construction + local search)
- `src/lib/` — validation, stats, payroll, month continuity, import/export, storage
- `src/components/` — UI (Schedule, Workers, Rules, GitHub sync dialog)
- `src/i18n/` — English and Hebrew strings
- `tests/` — Vitest suites

Saved data from earlier versions of the app (browser storage and JSON backups) loads
without any conversion step.

## Deployment

Pushing to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). Pull requests run type-checks, tests and a build
(`.github/workflows/ci.yml`).
