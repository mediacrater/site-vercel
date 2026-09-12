# Mediacrater Environment Drift Monitor — Deployment Index

**Project:** Mediacrater TEST/LIVE Environment Drift Monitor  
**Project path:** `/home/echobeehive223/mediacrater-drift-monitor-live`  
**VPS service:** `mediacrater-drift-monitor.service`  
**Primary implementation window:** 2026-09-10 → 2026-09-11 local time  
**Final validation:** 2026-09-12 UTC  
**Status:** v1 complete and validated

> Security note: this document intentionally does **not** contain database passwords, GitHub tokens, Slack webhook URLs, signing secrets, Basic Auth credentials, Supabase service-role keys, or any other secret values. Environment-variable names are documented, but values must remain in the VPS `.env` or their respective secret stores.

---

## 1. Purpose

The drift monitor exists to detect unintended divergence between Mediacrater's TEST and LIVE environments.

The final v1 compares three surfaces:

1. **VPS filesystem**
   - TEST: `/var/www/mediacrater-api-test`
   - LIVE: `/var/www/mediacrater-api`
2. **Supabase database structure**
   - TEST database
   - LIVE database
   - Structural/schema comparison only; row data is not compared.
3. **GitHub repositories**
   - TEST: `mediacrater/test-site-vercel`
   - LIVE: `mediacrater/site-vercel`
   - Branch: `main`

When drift is found, the monitor reports it to Slack and can suppress an exact known difference either permanently or for seven days.

When no drift is present, it reports:

```text
☑️ No Environment Drifts Detected
```

When a check fails, the error path reports:

```text
❌ Error running environment drift: {responseBody}
```

---

## 2. Runtime / package specification

### Node.js

```text
Node.js >= 20
```

### Project package

```json
{
  "name": "mediacrater-drift-monitor",
  "version": "0.1.0",
  "private": true,
  "description": "Private TEST/LIVE drift monitor for Mediacrater VPS files and Supabase schema.",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "check": "node src/check.js"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### Runtime dependencies

- `diff` `^7.0.0`
- `dotenv` `^16.6.1`
- `express` `^5.1.0`
- `node-cron` `^4.2.1`
- `pg` `^8.16.3`

Equivalent dependency-install command for a rebuild:

```bash
npm install diff@^7.0.0 dotenv@^16.6.1 express@^5.1.0 node-cron@^4.2.1 pg@^8.16.3
```

---

## 3. Final project layout

```text
mediacrater-drift-monitor-live/
├── .env
├── package.json
├── config/
│   └── config.json
├── data/
│   ├── ignores.json
│   └── reports/
├── public/
│   └── codediff.html
└── src/
    ├── check.js
    ├── config.js
    ├── fsScanner.js
    ├── githubScanner.js
    ├── ignoreStore.js
    ├── index.js
    ├── reportStore.js
    ├── slack.js
    └── supabaseScanner.js
```

Development backups were also created during implementation, including versions such as:

```text
src/check.js.backup
src/check.js.backup-before-slack-fix
src/fsScanner.js.backup
```

These are not part of the runtime architecture.

---

# Chronological Deployment / Implementation Record

## Phase 1 — VPS project scaffold

### Goal

Create a standalone private monitoring service instead of adding drift logic directly to the Mediacrater application.

### Project directory

```bash
cd /home/echobeehive223
mkdir -p mediacrater-drift-monitor-live
cd mediacrater-drift-monitor-live
```

Supporting folders:

```bash
mkdir -p src config public data/reports
```

### Important design boundary

The drift monitor is operational tooling. It does not serve customer traffic and does not participate in Mediacrater scan execution.

---

## Phase 2 — Central configuration

### File

`src/config.js`

### Responsibilities

- Resolve the project root.
- Load `config/config.json`.
- Read runtime settings from `.env`.
- Export HTTP port, report TTL, cron schedule, startup-check toggle, Slack webhook, report base URL, Basic Auth credentials, and Supabase TEST/LIVE database URLs.

### Default runtime settings

```text
PORT=3876
REPORT_TTL_HOURS=168
CRON_SCHEDULE=0 2 * * *
RUN_CHECK_ON_START=true
```

The cron default means one scheduled check per day at 02:00 according to the process/server timezone.

### Relevant environment variables

```text
PORT
REPORT_TTL_HOURS
CRON_SCHEDULE
RUN_CHECK_ON_START
TOOLS_USERNAME
TOOLS_PASSWORD
SLACK_WEBHOOK_URL
SLACK_SIGNING_SECRET
REPORT_BASE_URL
SUPABASE_TEST_DATABASE_URL
SUPABASE_LIVE_DATABASE_URL
GH_TEST_ENV
GH_LIVE_ENV
```

Do not put their values in documentation or Git.

---

## Phase 3 — Filesystem drift scanner

### File

`src/fsScanner.js`

### TEST and LIVE roots

```text
TEST: /var/www/mediacrater-api-test
LIVE: /var/www/mediacrater-api
```

### Core behavior

The scanner:

1. Walks configured TEST and LIVE roots.
2. Excludes non-source/generated/private paths.
3. Hashes files.
4. Detects missing files, files added only in LIVE, and modified files.
5. Builds line-level diffs for modified text files.
6. Classifies changes so code and whitespace-only drift can be distinguished.
7. Generates stable fingerprints for exact differences.

### Important exclusions

Generated or irrelevant directories/files are excluded, including categories such as:

```text
node_modules/
.next/
.git/
logs/
tmp/
*.log
```

Most importantly, environment files are permanently excluded:

```text
.env
.env.*
```

### Why `.env` was explicitly excluded

An early report showed that comparing `.env` caused secret-bearing environment contents to enter a generated report. The fix was to make environment files non-comparable.

The design rule is now:

> Drift monitoring may detect source/configuration structure, but must not expose or persist secret contents.

---

## Phase 4 — Report storage and code-diff viewer

### Files

- `src/reportStore.js`
- `public/codediff.html`

### Behavior

When drift exists:

1. A report is generated.
2. It is written to `data/reports/`.
3. Reports have a TTL and old reports are pruned.
4. The Express service exposes the report through the authenticated tool.
5. `/codediff/:id` loads the human-readable diff page.

### Report endpoint

```text
GET /api/reports/:id
```

Missing/expired report behavior:

```json
{
  "error": "Report not found or expired."
}
```

---

## Phase 5 — Express service and Basic Auth

### File

`src/index.js`

### Endpoints

```text
GET  /health
POST /api/check
GET  /api/reports/:id
GET  /codediff/:id
POST /api/slack/actions
```

### Authentication

The general tool UI/API is protected with HTTP Basic Auth.

Credentials come from:

```text
TOOLS_USERNAME
TOOLS_PASSWORD
```

The Slack interaction endpoint is handled before the general Basic Auth middleware because Slack must reach it directly and authenticates using Slack request signing instead.

### Health check

```text
GET /health
```

Successful response:

```json
{
  "ok": true
}
```

---

## Phase 6 — Scheduled and manual checks

### Manual check

```bash
cd ~/mediacrater-drift-monitor-live
npm run check
```

Equivalent direct execution:

```bash
node src/check.js
```

### Syntax validation

```bash
node --check src/index.js
node --check src/check.js
```

### Server execution

```bash
npm start
```

### Scheduling

`node-cron` runs `runCheck()` using `CRON_SCHEDULE`.

With:

```text
RUN_CHECK_ON_START=true
```

the monitor also performs a check when the service starts.

---

## Phase 7 — Slack notification layer

### File

`src/slack.js`

### Functions

`notifySlack()`

- Sends normal webhook notifications.
- Supports plain text and Slack block payloads.

`verifySlackSignature()`

- Verifies Slack interactive requests.
- Uses the signing secret.
- Rejects stale requests outside the allowed timestamp window.
- Uses constant-time signature comparison.

`updateSlackMessage()`

- Uses Slack's `response_url`.
- Replaces the original interactive message after an ignore action is accepted.

### Security model for Slack actions

Slack's `application/x-www-form-urlencoded` body must be signature checked against the **exact raw body**.

The route therefore captures the raw request body before parsing it.

---

## Phase 8 — Fingerprinted ignore system

### File

`src/ignoreStore.js`

### Data file

```text
data/ignores.json
```

### Final storage structure

The file maintains:

```text
ignores
temporaryIgnores
```

### Permanent ignore

An exact difference can be ignored forever.

Stored metadata includes:

```text
fingerprint
path
type
classification
reason
createdAt
```

### Seven-day ignore

Temporary ignores also include:

```text
expiresAt
```

Expired temporary ignores are automatically removed during normal ignore-store processing.

### Important behavior

Ignores are **fingerprint based**.

Therefore:

- The exact ignored difference is suppressed.
- If the file/schema/repository difference changes, its fingerprint changes.
- The changed version alerts again.

This prevents broad path-level ignores from hiding future unrelated drift.

---

## Phase 9 — Slack interactive ignore controls

### Route

```text
POST /api/slack/actions
```

### Final action IDs

```text
ignore_forever
ignore_7_days
```

### Buttons

Each drift alert supports:

```text
Ignore forever
Ignore for 7 days
```

### Supported drift types

```text
filesystem
supabase
github
```

### Payload validation

The handler validates the action ID, Base64URL JSON value, SHA-256 fingerprint format, path/name, and supported difference type.

Slack is acknowledged immediately, then the original message is updated through its `response_url`.

---

## Phase 10 — Supabase structural drift scanner

### File

`src/supabaseScanner.js`

### Scope

The scanner compares database structure rather than application row data.

Configured schema:

```text
public
```

### Structural groups compared

```text
schemas
tables
columns
constraints
indexes
views
materializedViews
functions
triggers
rls
policies
sequences
types
enumValues
extensions
privileges
```

### Snapshot / comparison flow

`src/check.js` performs concurrent TEST/LIVE snapshots:

```js
const [testDatabase, liveDatabase] = await Promise.all([
  snapshotDatabase(supabaseTestUrl, config.supabase.schemas || ["public"]),
  snapshotDatabase(supabaseLiveUrl, config.supabase.schemas || ["public"]),
]);
```

Then:

```js
const rawSupabaseDifferences = compareDatabases(
  testDatabase,
  liveDatabase
);
```

Each result receives a fingerprint and known ignored differences are removed.

---

## Phase 11 — Supabase false-positive normalization

Two important normalizations were added.

### 11.1 Ignore column ordinal position

A column can have the same effective structure in TEST and LIVE while appearing at a different ordinal position because of schema evolution.

For matched columns:

```js
{ ignore: ["ordinal_position"] }
```

This prevents harmless column ordering from producing false drift.

### 11.2 Normalize function definitions

PostgreSQL can represent semantically equivalent functions with formatting differences.

Function definitions are normalized before comparison:

```js
{ normalizeFields: ["definition"] }
```

This removed formatting-only function drift while preserving meaningful function differences.

---

## Phase 12 — Supabase TEST/LIVE reconciliation

During integration, the monitor surfaced real historical differences. These were reviewed rather than blindly ignored.

### Deliberately removed from TEST

`public.profiles.deep_scan_interest`

Reason: it had already been deliberately removed from LIVE, so TEST was aligned with LIVE.

### LIVE columns added to TEST

`public.profiles`:

```text
last_device_id
last_ip
last_seen_at
```

`public.purchases`:

```text
created_at
```

### LIVE indexes added to TEST

```sql
CREATE INDEX IF NOT EXISTS account_devices_created_at_idx
ON public.account_devices USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS account_devices_device_id_idx
ON public.account_devices USING btree (device_id);

CREATE INDEX IF NOT EXISTS account_devices_ip_created_at_idx
ON public.account_devices USING btree (ip, created_at DESC);

CREATE INDEX IF NOT EXISTS account_devices_signup_device_id_idx
ON public.account_devices USING btree (device_id)
WHERE (event = 'signup'::text);

CREATE INDEX IF NOT EXISTS account_devices_user_id_idx
ON public.account_devices USING btree (user_id);
```

### Function alignment

LIVE `public.handle_new_user()` was aligned to include:

```text
SECURITY DEFINER
SET search_path TO 'public'
```

TEST `public.hook_capture_signup_ip(event jsonb)` was aligned to use:

```text
SECURITY DEFINER
```

### Formatting-only case

`public.throttle_extension_version_update()` was identified as formatting-only drift and did not require a database behavior change.

---

## Phase 13 — Supabase verification commands

A direct scanner test was used to inspect the structural difference count:

```bash
node - <<'NODE'
require("dotenv").config();

const { snapshotDatabase, compareDatabases } = require("./src/supabaseScanner");
const { supabaseTestUrl, supabaseLiveUrl } = require("./src/config");

(async () => {
  const test = await snapshotDatabase(supabaseTestUrl, ["public"]);
  const live = await snapshotDatabase(supabaseLiveUrl, ["public"]);
  const diffs = compareDatabases(test, live);

  const counts = {};
  for (const d of diffs) {
    const key = `${d.group} :: ${d.status}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  console.log(JSON.stringify(counts, null, 2));
})();
NODE
```

A detailed version was also used:

```bash
node - <<'NODE'
require("dotenv").config();

const { snapshotDatabase, compareDatabases } = require("./src/supabaseScanner");
const { supabaseTestUrl, supabaseLiveUrl } = require("./src/config");

(async () => {
  const test = await snapshotDatabase(supabaseTestUrl, ["public"]);
  const live = await snapshotDatabase(supabaseLiveUrl, ["public"]);
  const diffs = compareDatabases(test, live);

  for (const d of diffs) {
    const v = d.test || d.live || {};
    console.log(`${d.group}\t${d.status}\t` + JSON.stringify(v));
  }
})();
NODE
```

After reconciliation and normalization, Supabase reached:

```text
0 diffs
```

---

## Phase 14 — GitHub TEST/LIVE integration

### File

`src/githubScanner.js`

### Repositories

```text
TEST: mediacrater/test-site-vercel
LIVE: mediacrater/site-vercel
```

### Branch

```text
main
```

### Token variables

```text
GH_TEST_ENV
GH_LIVE_ENV
```

The variable names are documented; token values must remain secret.

### Configuration

```json
{
  "github": {
    "enabled": true,
    "testRepo": "mediacrater/test-site-vercel",
    "liveRepo": "mediacrater/site-vercel",
    "branch": "main"
  }
}
```

### Generated-path exclusions

GitHub comparison excludes generated/non-source paths such as:

```text
.next/
node_modules/
dist/
build/
coverage/
.vercel/
.turbo/
out/
changelogs/
```

and exact generated/operational files including:

```text
.gitignore
deployment.md
next-env.d.ts
```

where configured.

### GitHub comparison flow

`src/check.js` loads both repository snapshots and compares them:

```js
const [testRepository, liveRepository] = await Promise.all([
  snapshotRepository(
    config.github.testRepo,
    githubBranch,
    process.env.GH_TEST_ENV
  ),
  snapshotRepository(
    config.github.liveRepo,
    githubBranch,
    process.env.GH_LIVE_ENV
  ),
]);
```

Differences are fingerprinted and passed through the same ignore system as filesystem and Supabase drift.

---

## Phase 15 — Accidental `.next` Git tracking cleanup

During GitHub work, generated `.next` files became tracked after an `npm install`/build workflow.

The correction was to remove generated `.next` content from Git tracking and ensure it remained ignored.

Representative commands:

```bash
git rm -r --cached .next
```

Ensure `.gitignore` contains:

```text
.next/
```

Then commit and push:

```bash
git add .gitignore
git commit -m "Stop tracking generated .next files"
git push
```

The GitHub scanner also excludes `.next/`, so generated Next.js build output is not treated as meaningful TEST/LIVE source drift.

---

## Phase 16 — Unified check orchestration

### File

`src/check.js`

### Final result object

```js
const result = {
  filesystem: {
    differences: [],
    filesChecked: 0,
  },
  supabase: {
    enabled: false,
    differences: [],
  },
  github: {
    enabled: false,
    differences: [],
  },
};
```

### Total drift count

```js
const total =
  result.filesystem.differences.length +
  result.supabase.differences.length +
  result.github.differences.length;
```

This ensures a clean result means **all enabled monitoring surfaces are clean**.

---

## Phase 17 — Clean-state reporting

Required final behavior:

```text
☑️ No Environment Drifts Detected
```

Implementation behavior:

1. Log the count.
2. If `total === 0`, log the success message.
3. Send the same success state to Slack.
4. Return `changed: false`.

Final observed clean run:

```text
[drift] 2026-09-12T02:36:23.576Z — 0 new difference(s)
[drift] 2026-09-12T02:36:23.579Z — ☑️ No Environment Drifts Detected
```

---

## Phase 18 — Error reporting

Both the direct check path and long-running server path use explicit error formatting.

Expected format:

```text
❌ Error running environment drift: {responseBody}
```

`responseBody` is preferred when available. Otherwise the stack, message, or string representation is used.

The monitor also attempts to send the error to Slack.

If Slack itself fails, that secondary failure is logged without masking the original drift-monitor failure.

---

## Phase 19 — One Slack message per structural difference

The Slack output was changed so an individual difference owns its own interactive controls instead of sharing an ambiguous button set with several differences.

For each detected item, the flow is conceptually:

```text
Difference message
↓
Actions block
  - Ignore forever
  - Ignore for 7 days
```

This preserves one-to-one correspondence between:

```text
Slack message ↔ difference fingerprint ↔ ignore action
```

This was necessary so clicking Ignore never suppresses the wrong difference.

---

## Phase 20 — Final Slack handler cleanup

During the upgrade from the original permanent-ignore handler to the new two-button handler, an obsolete copy of the old handler remained in `src/index.js`.

That duplicate block redeclared:

```js
let ignore;
```

and caused:

```text
SyntaxError: Identifier 'ignore' has already been declared
```

The obsolete block was removed.

### Validation commands

```bash
node --check src/index.js
node --check src/check.js
npm run check
```

Final result:

```text
[drift] 2026-09-12T02:36:23.576Z — 0 new difference(s)
[drift] 2026-09-12T02:36:23.579Z — ☑️ No Environment Drifts Detected
```

---

## Phase 21 — systemd service validation

The actual installed systemd unit is:

```text
mediacrater-drift-monitor.service
```

A mistaken restart attempt used:

```bash
sudo systemctl restart mediacrater-drift-monitor-live.service
```

which failed because that unit does not exist.

The service was located with:

```bash
systemctl list-units --type=service --all | grep -Ei 'mediacrater|drift'
```

Result:

```text
mediacrater-drift-monitor.service loaded active running Mediacrater Drift Monitor
```

Correct restart command:

```bash
sudo systemctl restart mediacrater-drift-monitor.service
```

---

## Phase 22 — Final end-to-end validation

A deliberate filesystem edit was made to a monitored file.

Expected result:

```text
TEST/LIVE drift detected
```

The monitor detected it and Slack alerted correctly.

The deliberate edit was then removed.

The next check returned:

```text
☑️ No Environment Drifts Detected
```

This confirmed the production v1 detection loop from source comparison through Slack notification and back to a clean state.

---

# Final Runtime Architecture

```text
                    ┌──────────────────────────────┐
                    │     src/check.js             │
                    │     runCheck()               │
                    └──────────────┬───────────────┘
                                   │
           ┌───────────────────────┼─────────────────────────┐
           │                       │                         │
           ▼                       ▼                         ▼
┌───────────────────┐   ┌─────────────────────┐   ┌────────────────────┐
│ Filesystem scanner│   │ Supabase scanner    │   │ GitHub scanner     │
│ TEST vs LIVE      │   │ TEST vs LIVE schema │   │ TEST vs LIVE repo  │
└─────────┬─────────┘   └──────────┬──────────┘   └──────────┬─────────┘
          │                        │                         │
          └────────────────────────┼─────────────────────────┘
                                   ▼
                         fingerprint differences
                                   │
                                   ▼
                         src/ignoreStore.js
                                   │
                       ignored? ───┴─── not ignored
                                       │
                                       ▼
                             report + Slack alert
                                       │
                         ┌─────────────┴─────────────┐
                         ▼                           ▼
                 Ignore 7 days                Ignore forever
                         │                           │
                         └─────────────┬─────────────┘
                                       ▼
                              data/ignores.json
```

---

# Operational Command Reference

## Enter project

```bash
cd ~/mediacrater-drift-monitor-live
```

## Validate JavaScript syntax

```bash
node --check src/index.js
node --check src/check.js
```

## Run a full manual comparison

```bash
npm run check
```

## Start directly

```bash
npm start
```

## Find the installed service

```bash
systemctl list-units --type=service --all | grep -Ei 'mediacrater|drift'
```

## Restart production drift monitor

```bash
sudo systemctl restart mediacrater-drift-monitor.service
```

## Check service status

```bash
systemctl status mediacrater-drift-monitor.service
```

## Inspect recent service logs

```bash
journalctl -u mediacrater-drift-monitor.service -n 100 --no-pager
```

## Follow service logs live

```bash
journalctl -u mediacrater-drift-monitor.service -f
```

## Inspect reports

```bash
ls -lah data/reports
```

## Inspect ignore data

```bash
cat data/ignores.json
```

Be aware that operational data may include internal filenames/metadata. Do not paste secret-bearing files into public channels.

---

# Configuration Checklist

## Filesystem

- [x] TEST root configured
- [x] LIVE root configured
- [x] generated directories excluded
- [x] `.env` and `.env.*` excluded
- [x] line-level diff support
- [x] code/whitespace classification
- [x] exact fingerprinting

## Supabase

- [x] TEST connection configured
- [x] LIVE connection configured
- [x] `public` schema comparison
- [x] tables
- [x] columns
- [x] constraints
- [x] indexes
- [x] views/materialized views
- [x] functions
- [x] triggers
- [x] RLS/policies
- [x] sequences
- [x] custom types/enums
- [x] extensions
- [x] privileges
- [x] column ordinal-position normalization
- [x] function-definition normalization
- [x] TEST/LIVE baseline reconciled to zero drift

## GitHub

- [x] TEST repository
- [x] LIVE repository
- [x] `main` branch
- [x] separate TEST/LIVE credentials
- [x] generated-output exclusions
- [x] `.next/` excluded
- [x] exact difference fingerprints

## Slack

- [x] normal webhook notifications
- [x] signed interactive actions
- [x] raw-body signature verification
- [x] one actionable message per difference
- [x] Ignore forever
- [x] Ignore for 7 days
- [x] confirmation message replacement

## Reliability

- [x] clean-state Slack message
- [x] explicit error-state Slack message
- [x] syntax checked
- [x] full manual check successful
- [x] intentional-drift test successful
- [x] clean state confirmed after reverting test change
- [x] systemd service identified and running

---

# What v1 Intentionally Does Not Do

The monitor is deliberately read-only with respect to environment reconciliation.

It **detects and reports** drift. It does not currently:

- overwrite TEST from LIVE
- overwrite LIVE from TEST
- execute generated database migration SQL
- alter application files automatically
- modify GitHub repositories automatically
- copy row data between Supabase projects
- copy auth users
- copy storage objects
- copy secrets
- copy environment variables

Those capabilities belong to a separately guarded v2 synchronization layer.

---

# Final v1 Acceptance State

The project can be considered complete when all of the following remain true:

```text
node --check src/index.js     → no output / exit 0
node --check src/check.js     → no output / exit 0
npm run check                 → 0 new differences
Slack                         → ☑️ No Environment Drifts Detected
systemd                       → mediacrater-drift-monitor.service active/running
```

The final deliberate-drift test satisfied the detection requirement, and reverting the change returned the monitor to the clean state.

**v1 status: COMPLETE**
