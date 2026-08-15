# CareLoad — prototype

CareLoad is a private family caregiving task tracker: it records who owns which care task (medication, ointment, hospital appointments, errands, and "keep in mind" items for the care recipient **E**), makes the weekly workload per person visible, and makes sure nothing silently falls through the cracks. This repository contains a **static, front-end-only prototype** of the intended screens, built so the family can click through and react to the visuals before real engineering starts. The full product specification (data model, real backend, deployment) is in [`spec/care-load-spec.md`](spec/care-load-spec.md).

The UI language is Danish (the family's language); code, comments, and this README are in English.

## Running it

No build step, no dependencies. Either:

- open `index.html` directly in a browser, or
- serve the folder with any static file server, or
- use the GitHub Pages deployment (see below).

## What's fake

Everything except the pixels:

- **No persistence** — all actions (done, reopen, reassign, delete, new task) work in-memory only; reloading the page resets to the mock data.
- **No backend** — there is no API; `mock-data.js` is the only data source and the only file meant to be replaced by real API calls later.
- **No notifications** — no emails, no digests.
- **No login** — the carer selector under Indstillinger (bottom nav) stands in for login: pick a carer to filter every view to that person's tasks, or "Alle" to see everything.
- **Recurrence is pre-generated** — no RRULE expansion; recurring tasks are generated as concrete daily instances for the ~5 weeks around today (and new recurring tasks are generated the same way).
- **Mock family** — two carers, J and S, with fictional tasks; the current week is deliberately assigned unevenly (~70/30) so the by-person view has something to show.

## Files

```
index.html      — app shell (header, tabs, sheets, new-task form)
styles.css      — all styling, mobile-first
app.js          — views, state, rendering (vanilla JS, no framework)
mock-data.js    — members + generated tasks; replace with real API calls later
spec/care-load-spec.md — full product spec (v1.0)
```

## GitHub Pages

Deployment is automatic: every push to `main` runs the
[`deploy-pages` workflow](.github/workflows/deploy-pages.yml), which uploads
the repository root to GitHub Pages. The first run also creates the Pages
site, so no manual setup is needed. The prototype is served at
`https://<owner>.github.io/<repo>/`.

If the first workflow run fails on the "Configure Pages" step, enable Pages
once by hand (**Settings → Pages → Source: GitHub Actions**) and re-run it.

The prototype uses only relative paths and no build step, so it works from a
project subpath out of the box.
