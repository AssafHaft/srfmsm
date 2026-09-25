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
- `src/components/` — UI (Schedule, Workers, Rules)
- `tests/` — Vitest suites

Saved data from earlier versions of the app (browser storage and JSON backups) loads
without any conversion step.

## Deployment

Pushing to `main` builds the app and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). Pull requests run type-checks, tests and a build
(`.github/workflows/ci.yml`).
