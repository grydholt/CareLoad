# CareLoad — Family Caregiving Task Tracker
### Project Specification v1.0

## 1. Purpose

CareLoad is a private, self-hosted web application that helps a family track and fairly divide the responsibilities involved in caring for a family member. It captures not just appointments, but the full "mental load": one-off errands, recurring duties, and things that simply need to be remembered or monitored.

Every responsibility is assigned to a specific family member. The division of labor is negotiated by the family up front, outside the app — the app's job is to record who owns what, make the current workload visible, and make sure nothing silently falls through the cracks.

The app deliberately does **not** live in the shared family calendar. Instead, it uses a **hidden Google Calendar** (owned by one admin account) as its storage backend, so care tasks never clutter anyone's personal or family calendar.

## 2. Key Decisions (agreed)

| Topic | Decision |
|---|---|
| Storage backend | One hidden Google Calendar on the admin's Google account |
| Google auth | Only the backend holds the admin's OAuth refresh token; no family member ever logs into Google |
| Family member auth | One hardcoded API key per person, configured in the backend |
| Task types | One-off tasks, recurring tasks, appointments, and "watch" items (remember/monitor, no fixed time) |
| Mental-load weighting | Out of scope — tasks are split fairly by the family up front; the app only tracks assignment |
| Completion | Explicit mark-as-done required; a task whose time has passed without being marked done becomes **missed** |
| Primary non-calendar view | "Who's doing what this week" per-person workload view |
| Notifications | Custom: daily email digest + immediate email when a task becomes missed |
| Backend hosting | Docker containers on a Hetzner virtual server, behind a reverse proxy (Caddy recommended) |
| Frontend hosting | Existing PHP-capable webserver; PHP acts as server-side proxy + templating (API keys never reach the browser) |

## 3. Architecture Overview

```
Browser ──(session cookie)──> PHP frontend ──(X-API-Key, server-side)──> Backend API ──(OAuth)──> Google Calendar (hidden)
                                                                              │
                                                        Scheduler container ──┤ (status engine + notifications)
                                                                              │
                                                                        SMTP relay (email)
```

Components:

1. **Backend API container** — REST API; sole holder of the Google OAuth refresh token; translates all app actions into Google Calendar API calls.
2. **Scheduler container** — runs periodic jobs: flips overdue `pending` tasks to `missed`, sends the daily digest and missed-task alert emails. Same codebase as the API, separate process.
3. **Reverse proxy container** (Caddy) — TLS termination for the backend on the Hetzner box.
4. **PHP frontend** — session-based login per family member; renders all views server-side; proxies every data call to the backend using that member's API key, stored only in PHP config.

## 4. Data Model

All data lives as events on the hidden Google Calendar. Application fields are stored in `extendedProperties.private`:

```json
{
  "assignee": "alice",
  "taskType": "oneoff | recurring | appointment | watch",
  "status": "pending | done | missed",
  "completedAt": "ISO-8601 timestamp or empty",
  "completedBy": "member id or empty",
  "notes": "free text (optional)"
}
```

Mapping rules:

- **Title** → event `summary`; **description** → event `description`; **location** (appointments) → event `location`.
- **Recurring tasks** use Google's native `recurrence` (RRULE). Each *instance* carries its own status: when marked done/missed, the backend materializes that instance (Google single-instance override) and sets status on it, leaving the series intact.
- **Watch items** ("remember to check on X") are all-day events. They may have a due date (all-day event on that date) or none (all-day event pinned to creation date, `taskType: watch` distinguishes them). Watch items with no due date never become `missed`.
- **Status is independent of time.** An event whose end time passes while `status = pending` is flipped to `missed` by the scheduler — never auto-completed.
- The `assignee` value must always be set at creation time. The backend rejects creation without an assignee (the family splits tasks up front).

## 5. Backend API

Authentication: every request carries `X-API-Key`. The backend maps key → member from configuration and rejects unknown keys (401). All members have equal permissions (any member may create, reassign, complete any task — trust-based family tool).

| Method & path | Purpose |
|---|---|
| `GET /api/tasks?from=&to=&assignee=&status=&type=` | List tasks in a date range with optional filters. Expands recurring instances within the range. |
| `POST /api/tasks` | Create a task. Body: title, description?, taskType, assignee, start?, end?, recurrence (RRULE)?, location? |
| `GET /api/tasks/{id}` | Fetch one task (or one instance via `?instance=<start>`). |
| `PATCH /api/tasks/{id}` | Update fields: reassign, reschedule, edit title/notes. For recurring: `scope=instance\|series`. |
| `POST /api/tasks/{id}/done` | Mark done (records completedAt/completedBy from the API key). `?instance=` for recurring. |
| `POST /api/tasks/{id}/reopen` | Revert done/missed to pending. |
| `DELETE /api/tasks/{id}` | Delete task (`scope=instance\|series` for recurring). |
| `GET /api/workload?from=&to=` | Aggregated per-person counts: pending / done / missed per member for the range. Powers the "this week by person" view. |
| `GET /api/overdue` | All tasks currently `missed`. |
| `GET /api/members` | List of configured member ids + display names (for assignment dropdowns). |
| `GET /api/health` | Liveness check for Docker. |

Notes for implementation:

- Google's API cannot filter by extended properties with full flexibility; fetch events for the requested time window and filter in the backend.
- Cache the calendar responses briefly (e.g., 30–60 s) to stay well within Google API quotas; invalidate on any write.
- Use exponential backoff on Google API 403/429 responses.

## 6. Scheduler Jobs

Runs in its own container (same image, different entrypoint).

1. **Status engine** — every 15 minutes: find events with `status = pending` whose end time (or all-day date, for watch items *with* a due date) has passed → set `status = missed`. Record which tasks newly flipped.
2. **Missed alert** — immediately after the status engine run: for each newly missed task, email the assignee.
3. **Daily digest** — once per day at a configurable time (default 07:00 server time): one email per member containing (a) their tasks due today, (b) their currently missed tasks, (c) a one-line family summary (e.g., "12 tasks this week: Alice 5, Ben 4, Chris 3").

Email via SMTP relay (configurable host/credentials — e.g., Mailgun/Postmark free tier or any SMTP provider). Member → email address mapping lives in backend configuration.

## 7. PHP Frontend

Auth: simple login page (member picks their name + enters a shared or per-person passphrase — implementer's choice, minimum viable is a per-person passphrase in PHP config). On success, PHP session stores the member id. PHP config maps member id → backend API key. **The API key is never sent to the browser.**

All interactive actions (mark done, reassign, create) post to PHP endpoints, which call the backend server-side and redirect/re-render.

### Views

1. **Week calendar (default)** — 7-day grid, events color-coded per assignee; watch items in a separate strip at the top. Click → task detail with Done / Reassign / Edit / Delete.
2. **This week by person** — one column or card per member: their pending, done, and missed tasks for the week, with counts. This is the fairness-visibility view and the most important screen after the calendar.
3. **Overdue / missed list** — everything currently missed, oldest first, with one-click Done or Reassign.
4. **New task form** — title, type (one-off / recurring / appointment / watch), assignee (required), date/time or RRULE picker (simple presets: daily, weekly on chosen days, monthly), optional location/notes.
5. **Month calendar** — read-mostly overview.

Design notes: mobile-first (family members will use phones), no JS framework required — server-rendered pages with small fetch() calls for done/reopen toggles are sufficient.

## 8. Configuration

Backend (`.env` / Docker secrets — never committed):

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=        # admin account, obtained once via a setup script
CALENDAR_ID=                 # the hidden calendar's id
MEMBERS=alice:APIKEY1:alice@example.com,ben:APIKEY2:ben@example.com,...
SMTP_HOST= / SMTP_USER= / SMTP_PASS= / SMTP_FROM=
DIGEST_HOUR=7
TZ=Europe/Berlin             # or appropriate timezone
```

PHP frontend config (outside webroot):

```
BACKEND_URL=https://careload-api.example.com
MEMBER_KEYS = [ 'alice' => 'APIKEY1', 'ben' => 'APIKEY2', ... ]
MEMBER_PASSPHRASES = [ 'alice' => '...', ... ]
```

Include a one-time **setup script** in the repo that walks the admin through the Google OAuth consent flow, creates the hidden calendar, and prints the refresh token + calendar id for the `.env`.

## 9. Deployment

`docker-compose.yml` on the Hetzner VM with three services:

- `api` — backend, internal port only
- `scheduler` — same image, cron/loop entrypoint
- `caddy` — ports 80/443, auto-TLS, reverse-proxies to `api`

Backend firewall / Caddy config should restrict the API to HTTPS; optionally restrict by source IP to the PHP webserver. Logs to stdout (Docker native). `GET /api/health` used as the compose healthcheck.

## 10. Out of Scope (v1)

- Mental-load weighting/scoring of tasks (division is negotiated by the family up front)
- Google login for family members
- Push notifications or SMS (email only; in-app "missed" badge comes free from the overdue view)
- Multi-family / multi-care-recipient support
- Editing from within Google Calendar itself (the hidden calendar is app-managed; manual edits there are unsupported)

## 11. Suggested Milestones for Implementation

1. Setup script + backend skeleton: auth middleware, Google Calendar client, `GET/POST /api/tasks`, health check, Dockerfile + compose.
2. Full task lifecycle: done/reopen/patch/delete, recurring-instance handling, workload + overdue endpoints.
3. Scheduler: status engine + missed alerts + daily digest emails.
4. PHP frontend: login/session, week calendar, task detail + done action.
5. Remaining views: by-person workload, overdue list, new-task form, month view.
6. Hardening: caching, backoff, IP restriction, mobile polish.
