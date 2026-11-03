# WEB-6859 / WEB-6857: Novu 2.1.0 → 3.19.0

Status: rollout preparation only, evidence refreshed 2026-11-03. This review performs no deployment or migration. The owner schedules each maintenance window. Companion `4e34fb2c1d4869ddba0f8c9a5b72a3e94e957483` pins chart `9a06f336197619d3388ed8ce331bcfa7f8177293`; repin the Application to the helper-committed chart containing this follow-up before rollout. Do not merge either PR as part of this task.

## Release and scope

Server [v3.19.0](https://github.com/novuhq/novu/releases/tag/v3.19.0), commit `fe53c481acb005925b990fe2484fcb6aea396e28`, is the only [3.19 server tag](https://api.github.com/repos/novuhq/novu/git/matching-refs/tags/v3.19.) found on the verification date. SDK versions such as `@novu/js@v3.19.2` are separate releases. Chart 0.2.5 → 0.3.0; all four application image tags inherit appVersion `3.19.0`.

Public GHCR manifest lists were rechecked anonymously on 2026-11-02; all support linux/amd64 and linux/arm64:

| Image under `ghcr.io/novuhq/novu/` | Manifest-list digest |
| --- | --- |
| api | `sha256:5cd2a586888b48885cb9ad91fb3cd25a38e6f70bb99d38d48f4d475b57bf544a` |
| worker | `sha256:2fa72651958986570f3929df0079908a6a4c65f945cf8fa69d973c707ce4ac81` |
| ws | `sha256:00aa8b9f080da2af443269af672c00b7561556d7adb4b097b4e54c2127de61e5` |
| dashboard | `sha256:15a7773e01658f671e56fb9f0ddc8f043008bb0cfea2d6c5d1a0a60c722bf6e1` |

Recheck digests for both architectures before rollout. The inspected amd64 registry configs use `sh -c 'node dist/main.js'` for API/worker/WS, **not** the PM2 `-i max` shown in the tagged Dockerfiles. Keep their image entrypoints; confirm one Node process per Pod on the actual architecture. The dashboard entrypoint and `http-server` CMD are also preserved.

The [tagged community compose](https://github.com/novuhq/novu/blob/v3.19.0/docker/community/docker-compose.yml) still pins 3.18.0; use its wiring, not those versions. CE needs API, worker, WS, dashboard, Mongo and Redis. No extra studio, Novu-hosted bridge, Clerk, ClickHouse or Postgres is required. Keep Activity Centre's external bridge and existing workflow sync Job.

Only `environments/staging/novu.yaml` changes in ArgoCD. US staging and both production pins remain `b6f40fb6ab529119dd34bd47e6acaa16815240d9`. Roll out EU staging → US staging → EU production → US production, each with a separate owner decision and observation period covering representative digests/delays. No automatic promotion.

## Configuration and identity changes

| Component | Image/port | Configuration |
| --- | --- | --- |
| API | `api:3.19.0`, 3000 | Public API_ROOT_URL; FRONT_BASE_URL and DASHBOARD_URL use the new dashboard origin; registration remains disabled in staging; WIDGET_BASE_URL empty; API_CONTEXT_PATH empty. |
| Worker | `worker:3.19.0`, 3004 | Explicit PORT; API_ROOT_URL=`http://novu-api.novu.svc.cluster.local:3000`; broadcast/multicast chunks stay 100. No public Service. |
| WS | `ws:3.19.0`, 3002 | PORT and empty WS_CONTEXT_PATH; retain Socket.IO routing. |
| Dashboard | `dashboard:3.19.0`, 4000 | Only public VITE_API_HOSTNAME and VITE_WEBSOCKET_HOSTNAME from its own ConfigMap. No server credentials or shared server env. |

All servers receive IS_SELF_HOSTED=true, NOVU_ENTERPRISE=false, LOG_LEVEL=info, NEW_RELIC_ENABLED=false and explicit Mongo min/max pools 10/200 per process by default. EU staging explicitly overrides these to 10/50; that trial ceiling is not a production recommendation. API/worker also receive IS_V2_ENABLED=true and NOVU_SAFE_OUTBOUND_ALLOW. API idempotency, rate limiting and the new messages response format default to false. Keeping `api.newMessagesApiResponseEnabled=false` preserves `totalCount` and the prior `hasMore` calculation for `/v1/messages`. The pinned EU staging values explicitly set this flag to true; remove that override or set it to false before rollout unless consumer compatibility with the new response is separately accepted. Preserve NODE_ENV, Redis DB 2, credentials and S3 placeholders. The pinned staging Application sets MONGO_AUTO_CREATE_INDEXES=false and worker.replicaCount=0; keep these barriers through migration/index reconciliation. Auto-indexing may be enabled only after index verification in a separately reviewed values change. The fork's index behavior is application startup auto-indexing; there is no separate index Job in the baseline.

`global.env.safeOutboundAllow` defaults to empty (no SSRF exceptions). Inventory all required private outbound destinations, including private SMTP as well as the bridge, and allow their exact FQDNs. Companion `4e34fb2c1` pins chart `9a06f33` and sets `staging-audit-log-service-service.audit-log-service.svc.cluster.local,mailpit.novu.svc.cluster.local`. Keep both entries: bridge-only guidance would break staging SMTP delivery. Verify that exact list in both API and worker renders and that the configured SMTP host uses the Mailpit FQDN. The broad `.svc.cluster.local` override has been removed. Repin the chart after these fixes are committed and record the replacement companion/chart SHAs; a successful Helm render does not satisfy migration or consumer gates. Entries are comma-separated hosts, suffixes, IPs or CIDRs, not URLs/paths. Never use `*` or allow all private networks. Keep `/audit-log-service-api/novu`, signing keys and NetworkPolicy reachability for API discovery, worker execution and SMTP. See the [parser](https://github.com/novuhq/novu/blob/v3.19.0/packages/shared/src/utils/outbound-ssrf-allow-list.ts).

This implementation follows the requested dashboard rename: Helm `web` → `dashboard`, `ingress.web` → `ingress.dashboard`, Deployment/Service/Ingress `novu-web` → `novu-dashboard`, and EU staging `web.novu-staging.platform-services.proda.dev` → `dashboard.novu-staging.platform-services.proda.dev`. This deliberately differs from the research's proposed retention of the `web` identities. Verify DNS and issue the new `dashboard.novu-tls` certificate before opening traffic. Prune the obsolete web resources and `novu-web-env-config` during the scheduled sync after verifying the new route. The API/WS hosts, aliases, service names, ports and TLS secrets remain unchanged.

The dashboard keeps the existing IP restriction via its separate Ingress. Its CSP uses a separate `novu-dashboard-csp-headers` ConfigMap; API/WS retain their original script policy. The image injects inline `window._env_`; two hashes cover the possible orders of the two VITE variables. Both CORS ingress annotations include the new dashboard origin plus `https://staging.proda.ai` and preserve SDK headers. Never place secrets in VITE values. VITE_SELF_HOSTED=true and VITE_NOVU_ENTERPRISE=false are CE **build-time** flags, not runtime overrides.

Recalculate CSP whenever either VITE value or dashboard image changes. In a disposable local container, preserving the image entrypoint:

```sh
docker run --rm --network none \
  -e VITE_API_HOSTNAME=https://api.novu-staging.platform-services.proda.dev \
  -e VITE_WEBSOCKET_HOSTNAME=https://ws.novu-staging.platform-services.proda.dev \
  ghcr.io/novuhq/novu/dashboard:3.19.0 cat /app/dist/index.html > /tmp/novu-dashboard-index.html
python3 - <<'PY'
import base64, hashlib, re
from pathlib import Path
html = Path('/tmp/novu-dashboard-index.html').read_text()
script = next(s for s in re.findall(r'<script>(.*?)</script>', html, re.S) if 'window._env_' in s)
lines = script.splitlines(keepends=True)
assert len(lines) == 5 and all('VITE_' in s for s in lines[2:4])
for text in (script, ''.join(lines[:2] + lines[2:4][::-1] + lines[4:])):
    print('sha256-' + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode())
PY
```

Expected current hashes: `sha256-79dQgVDi0j05hGoVIjK91yw9jZqg/aIAOBwiHrabRJc=` and `sha256-R5PgAGw+2awOeOkUj4FKLY73UnDDGS/YjVqSabe0YsU=`. Verify the served HTML, browser console, login and SPA navigation in rehearsal; a matching hash alone is not an end-to-end test.

Trial staging budgets, not measured requirements: API requests 500m/512Mi, limits 1000m/1Gi; worker 250m/512Mi → 1000m/1Gi; WS 100m/256Mi → 500m/512Mi; dashboard 100m/128Mi → 500m/512Mi. Mongo remains 500m/2Gi → 2000m/4Gi. Gate promotion on RSS, OOM/restarts, p95 latency and queue lag. Explicitly review Mongo pool sizing before each production promotion: the old maximum was 200, the chart retains 200, and staging overrides it to 50. The newly applied minimum is 10 per process. Record approved min/max values, Pod/process counts, aggregate connections, Mongo connection capacity, pool checkout wait/timeouts and load-test latency; do not copy staging's 10/50 into production without this review. [Novu capacity guidance](https://docs.novu.co/community/self-hosting-novu/overview) is larger than these trial application budgets.

## Preflight and maintenance barrier

1. Assign owner, window, maximum downtime, rollback deadline and evidence location. Record the deployed chart/config snapshot, actual image digests/architectures, live database versions, PVs, credentials' version identifiers and queue metrics. Do not log credentials.
2. Inventory organizations, environments, users, API keys, subscribers, topics/subscriptions, workflows, message templates, layouts, integrations and all preference types. Save counts and index definitions. Inventory v0 UI-created workflows separately; they may not be visible in the new dashboard. Do not recreate code-first workflows or change identifiers.
3. Preserve JWT_SECRET, NOVU_SECRET_KEY, environment API keys, integration IDs/credentials and the **exact 32-character** STORE_ENCRYPTION_KEY. Existing SendGrid credentials must remain decryptable. Preserve existing Secret ownership and Argo ignoreDifferences/RespectIgnoreDifferences. Staging's chart-managed values must not be replaced with newly generated secrets; other regions use ExternalSecret refs and are outside this change.
4. Confirm the actual application database from `novu-mongodb-svcbind-root:uri` without printing the URI. The Bitnami root service binding can select `/admin`; do not assume `/novu` or trust the old unused ConfigMap URL. Preserve the database path for migrations. Confirm collections and `db.getName()` through the injected URI.
5. Keep Mongo chart 16.5.1 and Redis chart 20.13.4/Chart.lock unchanged. Their resolved images are currently `bitnamilegacy/mongodb:8.0.8-debian-12-r0` and `bitnamilegacy/redis:7.4.3-debian-12-r0`; confirm live versions. No database-engine upgrade is included. Mongo is configured standalone; Redis has a single master and no replicas.
6. Preserve staging claims `novu-mongodb-data-hyperdisk-balanced` and `novu-redis-data-hyperdisk-balanced`. Other regions' requested Mongo 20Gi/Redis 10Gi are not changed. Live capacity, snapshots and restore duration require rehearsal.
7. Suspend relevant parent and child Argo reconciliation and workflow sync/provision Jobs. The staging draft removes child automated sync, but parent reconciliation must also be controlled. Pause producers and external traffic, drain active queues and record delayed/repeat/retry jobs. Stop API, worker and WS writers before the coordinated backup. Keep them stopped through migrations. Never let mixed server versions consume one Redis queue.

## Backup and isolated restore rehearsal

Take an encrypted full logical Mongo backup plus consistent Mongo/Redis disk snapshots (and Redis AOF/RDB as appropriate) while all writers are stopped. Save Secret/config exports encrypted outside these PVCs. Label snapshots with the same maintenance barrier and record Redis queue counts. Do not flush Redis.

Run backup commands in an owner-created tools Job with Mongo Database Tools compatible with the live server, credentials injected from the existing Secret and a separate backup volume mounted at `/backup`. Derive `MONGO_BACKUP_URI` from the service-binding root URI by removing its database path and setting `authSource=admin` so the dump includes **all** databases. Keep `MONGO_URL` unchanged for migrations. Do not echo either URI. Do not use `--oplog` on standalone.

```sh
mongodump --uri="$MONGO_BACKUP_URI" --archive=/backup/pre-3.19.archive.gz --gzip
sha256sum /backup/pre-3.19.archive.gz > /backup/pre-3.19.archive.gz.sha256
sha256sum -c /backup/pre-3.19.archive.gz.sha256
```

Restore to a **fresh**, isolated same-version Mongo using a distinct `MONGO_RESTORE_URI`, with an isolated Redis and provider/bridge egress denied except approved test endpoints. Never attach rehearsal workloads to live Redis, email providers or the production bridge. Resolve any application bootstrap dependencies against rehearsal services.

```sh
mongorestore --uri="$MONGO_RESTORE_URI" --archive=/backup/pre-3.19.archive.gz --gzip --drop
```

A restore over an existing database does not remove newly created collections absent from the archive. Use a fresh instance or explicitly reconcile such collections. Verify users/auth, every database/collection count, indexes, representative preferences and encrypted integration credentials before migrations. Record restore time and compare a complete backup/restore manifest; exit code alone is insufficient. Protect rehearsal data as production data.

### Conditional legacy preference centralization

Audit legacy `subscriberpreferences` and workflow preference fields against `preferences`, including values, not just counts. If already centralized, **skip** the historical migration: its upserts can overwrite newer preferences with stale legacy values. If required, use the **v2.1.0** source runner before any 3.19 migrations:

```sh
pnpm exec ts-node --transpileOnly ./migrations/preference-centralization/preference-centralization-migration.ts
```

The [3.19 version](https://github.com/novuhq/novu/blob/v3.19.0/apps/api/migrations/preference-centralization/preference-centralization-migration.ts) intentionally exits and directs operators to 2.1.0. The 2.1.0 script calls `withTransaction`, which cannot run on the configured standalone Mongo. If needed, this is a **rollout blocker** until the owner rehearses restoring the quiesced backup into an isolated temporary replica set, running the 2.1 migration there, verifying all preference values/counts, taking a fresh migrated dump and restoring it into a fresh same-version standalone instance. Preserve database name, auth and credentials throughout. Do not improvise a live topology conversion or run the transaction script on standalone. This conditional restore path has not been executed in this task.

## Migration runner and execution

[Official migration process](https://docs.novu.co/community/self-hosting-novu/data-migrations). The stock runtime images are not supported source migration runners. Build a dedicated, immutable image from the exact tag, including source, development dependencies, built workspace libraries and the API's TS config. For 3.19 use Node 22 compatible with the tagged Dockerfile and pnpm 11.0.9; for the conditional legacy runner use Node 20 and pnpm 9.11.0 from v2.1.0. Use `pnpm install --frozen-lockfile`, `pnpm build:api` at repository root and retain the complete workspace. Build CE without enterprise registry credentials. Resolve any build issues in rehearsal; never change the lockfile or pull floating migration source during the maintenance window.

Apply the bundled [migration runner patch](novu-3.19-migrations.patch) to the exact v3.19.0 source **before** building the runner. Copy it to `/tmp/novu-3.19-migrations.patch` and run from the source repository root:

```sh
patch --dry-run --fuzz=0 -p1 < /tmp/novu-3.19-migrations.patch
patch --fuzz=0 -p1 < /tmp/novu-3.19-migrations.patch
```

Require a clean application with no offsets; record the patch checksum with the runner digest. Never execute the five affected stock scripts. The patched preference migration excludes soft-deleted rows; run the tombstone reconciliation below first. For live duplicates it keeps the latest `updatedAt`, breaking ties by greatest `_id`, and rejects missing/invalid timestamps. Subscriber grouping includes both `contextKeysHash` (missing means `DEFAULT_CONTEXT`) and sorted `contextKeys` (missing means empty), so distinct contexts are not collapsed. Review/export each proposed survivor and its channel opt-outs before execution; reconcile exceptions explicitly rather than silently accepting a timestamp policy. Inconsistent context hashes/keys must be reconciled against the target schema before index creation. `$sortArray` requires MongoDB 5.2+; the scoped deployment uses 8.0.8, and other deployments must verify this prerequisite.

Preference-type failures are collected and then thrown after all types settle. Topic backfill/dedup batch failures, short deletes, invalid source links and remaining missing/duplicate identifiers fail the Job. Layout template update failures and remaining templates matching its migration filter also fail the Job. All five patched entrypoints await Mongo disconnect and explicitly exit 0/1. Rehearse success and injected write/cleanup failures for each, both full/final topic backfill and dedup batch paths, topic cursor/postcondition failures, layout update/postcondition failures, duplicate preferences with different contexts, tied/invalid timestamps and preserved opt-outs. Success must terminate; every injected failure must exit nonzero. The Job deadline below bounds bootstrap/cleanup hangs and must be sized from rehearsal; a deadline failure blocks progression.

Runner build and database execution are **not verified** by Helm validation. Rehearse all applicable commands, module resolution, Nest bootstrap, flags and exit behavior on the restored copy; record the runner digest before approving rollout. `MIGRATION=true` is not proof that bootstrap cannot make external calls; enforce rehearsal isolation.

Use one manually created Job per command, no Helm/Argo migration hooks, no automatic retry. Adapt this template to the rehearsal namespace and isolated Secret/ConfigMap names first; production names below are for the eventual scheduled window. Replace the image digest, Job name and command before applying. The ConfigMap must contain the reviewed 3.19 server settings even if live workloads are still on 2.1; create a separate migration ConfigMap from the reviewed render when necessary.

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: novu-migrate-REPLACE_STEP
  namespace: novu
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 1800
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: REPLACE_RUNNER_IMAGE_AT_SHA256
          workingDir: /usr/src/app/apps/api
          command: ["/bin/sh", "-ec"]
          args:
            - REPLACE_WITH_ONE_COMMAND_BELOW
          envFrom:
            - configMapRef:
                name: novu-migration-config
            - secretRef:
                name: novu-secret
          env:
            - name: MONGO_URL
              valueFrom:
                secretKeyRef:
                  name: novu-mongodb-svcbind-root
                  key: uri
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: novu-redis
                  key: redis-password
            - name: NODE_ENV
              value: production
            - name: MIGRATION
              value: "true"
            - name: MONGO_AUTO_CREATE_INDEXES
              value: "false"
            - name: NEW_RELIC_ENABLED
              value: "false"
          resources:
            requests:
              cpu: "1"
              memory: 2Gi
            limits:
              cpu: "2"
              memory: 4Gi
```

Set PORT=3000, IS_SELF_HOSTED=true, NOVU_ENTERPRISE=false, IS_V2_ENABLED=true, both pool sizes and the API-specific flags/URLs in `novu-migration-config` alongside the server ConfigMap settings. Use the actual Secret values, including the encryption key. Never deploy empty placeholders over existing secrets. Size Job resources and timeout from rehearsal. Inspect retained logs and postconditions after each Job before creating the next.

### Complete new Mongo migration inventory and order

Compared complete v2.1.0/v3.19.0 source trees under [`apps/api/migrations`](https://github.com/novuhq/novu/tree/v3.19.0/apps/api/migrations). These are the eight new executable Mongo scripts; `.spec.ts` files are tests. The legacy message cleanup and preference tombstone reconciliation below are additional data steps, not upstream scripts. Complete them before the numbered migrations. All `pnpm` commands below run from `apps/api` in the runner.

| Order | Path under migrations/ | Applicability and rerun behavior |
| --- | --- | --- |
| 1 | `preferences-uniqueness/preferences-uniqueness-migration.ts` | Required for conflicting duplicates among SUBSCRIBER_GLOBAL, SUBSCRIBER_WORKFLOW, USER_WORKFLOW and WORKFLOW_RESOURCE. Use the patched runner only: keeps latest `updatedAt` (greatest `_id` on ties), preserves distinct subscriber contexts and propagates failures. Destructive: reconcile tombstones, review/export exact live survivors and reconcile context metadata first. Idempotent on unchanged data. |
| 2 | `001-add-default-identifier-to-topic-subscribers/add-default-identifier-to-topic-subscribers-migration.ts` | Required for existing topic links without identifier. Use the patched runner only. Missing-field filter is idempotent. Missing topicKey/externalSubscriberId, failed batches or remaining missing identifiers fail the Job; repair before proceeding. |
| 3 | `002-remove-duplicate-identifiers/remove-duplicate-identifiers.ts` | Required when environment+identifier duplicates exist, after 001. Use the patched runner only: destructively keeps lowest `_id`; review survivors. Batch/cursor failures, short deletes and remaining duplicate groups fail the Job. Idempotent on unchanged data. |
| 4 | `email-step-ui-schema-html-editor/email-step-ui-schema-html-editor-migration.ts` | Use the patched runner with explicit disconnect/exit. Required for email templates with controls.uiSchema; otherwise no-op. Repeated $set has the same content but can change timestamps. |
| 5 | `add-layout-id-to-email-controls/add-layout-id-to-email-controls-migration.ts` | Use the patched runner only. Required for nondeleted email templates with schema/uiSchema and both layoutId properties missing. Template write failures or remaining matching templates fail the Job. Idempotent filter; inspect partially populated templates separately. |
| 6 | `agent-subscriber-access-default/agent-subscriber-access-default.migration.ts` | Conditional on existing agents missing behavior.subscriberAccess. Managed runtime+managedRuntime → open, others → restricted; expected no-op for this deployment. Idempotent missing-field filter. Needs explicit DAL connection. |
| 7 | `infobip-sms-base-url/deactivate-misconfigured-infobip-sms-integrations.migration.ts` | Conditional on active Infobip SMS integrations with unsafe/missing baseUrl. Deactivates them; unrelated to SendGrid. Idempotent active-only filter. Export only, needs explicit DAL connection and original encryption key. |
| Deferred | `deleteLogs/dropLogsCollection.ts` | Optional destructive cleanup of obsolete logs; defer until after rollback window. Rerun catches NamespaceNotFound rather than clean success. |

### Required legacy live-message cleanup

The [3.19 message schema](https://github.com/novuhq/novu/blob/v3.19.0/libs/dal/src/repositories/message/message.schema.ts) filters live messages with `deleted: {$exists: false}`. Legacy messages with the boolean `deleted:false` would disappear from those queries. After the coordinated backup, with every writer stopped, inventory `messages.deleted` in the actual application database. Export the affected IDs and representative inbox/message responses to the protected evidence location. Rehearse this cleanup on the restored copy first. Keep `deleted:true` tombstones unchanged; never unset the field on all messages.

Run this command in a manually created Mongo tools Job with `mongosh`, the same injected application `MONGO_URL`, `backoffLimit: 0` and a rehearsed deadline. It uses the raw collection, avoiding the 3.19 model's visibility filter. Unknown field values block execution for separate reconciliation. Record the before/after counts; any failed write or postcondition must exit nonzero and block the next migration.

```sh
mongosh "$MONGO_URL" --quiet --eval '
const messages = db.getCollection("messages");
const live = {$expr: {$eq: ["$deleted", false]}};
const tombstones = {$expr: {$eq: ["$deleted", true]}};
const absent = {deleted: {$exists: false}};
const before = {
  total: messages.countDocuments({}),
  live: messages.countDocuments(live),
  tombstones: messages.countDocuments(tombstones),
  absent: messages.countDocuments(absent)
};
printjson({database: db.getName(), before});
if (before.total !== before.live + before.tombstones + before.absent) {
  throw new Error("Unexpected messages.deleted values; reconcile before cleanup");
}
const result = messages.updateMany(live, {$unset: {deleted: ""}});
const after = {
  total: messages.countDocuments({}),
  live: messages.countDocuments(live),
  tombstones: messages.countDocuments(tombstones),
  absent: messages.countDocuments(absent)
};
printjson({matched: result.matchedCount, modified: result.modifiedCount, after});
if (!result.acknowledged || result.matchedCount !== before.live || result.modifiedCount !== before.live ||
    after.live !== 0 || after.total !== before.total || after.tombstones !== before.tombstones ||
    after.absent !== before.absent + before.live) {
  throw new Error("Legacy message cleanup postcondition failed");
}
'
```

The operation is idempotent with writers stopped: a completed rerun matches zero documents. A partial failure requires inspection before rerunning. Require zero remaining `deleted:false` messages, unchanged total/tombstone counts, and representative previously live messages visible through the 3.19 inbox and messages APIs. The pre-upgrade backup is the rollback source; never try to reverse this by setting `deleted:false` on all messages that lack the field.

### Reconcile preference tombstones before deduplication

The [3.19 preference schema](https://github.com/novuhq/novu/blob/v3.19.0/libs/dal/src/repositories/preferences/preferences.schema.ts) uniquely indexes `{_environmentId, _templateId, type}` for `USER_WORKFLOW` and `WORKFLOW_RESOURCE` without a `deleted` filter. The patched migration uses Mongoose's soft-delete filtering, so it cannot remove `deleted:true` rows that still occupy those keys. Do not choose a tombstone as a live survivor or unset its `deleted` field.

With writers stopped and the backup verified, use raw `mongosh` collection queries (not the Mongoose repository) to inspect duplicate keys, including tombstones:

```sh
mongosh "$MONGO_URL" --quiet --eval '
printjson(db.preferences.aggregate([
  {$match: {type: {$in: ["USER_WORKFLOW", "WORKFLOW_RESOURCE"]}}},
  {$group: {
    _id: {env: "$_environmentId", template: "$_templateId", type: "$type"},
    rows: {$push: {id: "$_id", deleted: "$deleted"}}, count: {$sum: 1}
  }},
  {$match: {count: {$gt: 1}}}
]).toArray());
'
```

Export the full documents for each collision group to the protected backup location, review live channel opt-outs separately, and record the exact tombstone IDs approved for physical deletion as an Extended JSON array in `/backup/preference-tombstone-ids.json`. Include all colliding tombstones; for tombstone-only groups, deletion must not create a live preference. Skip the deletion command when no tombstones need reconciliation. This manifest is specific to the selected database and maintenance snapshot; never reuse the rehearsal manifest on live data.

```sh
mongosh "$MONGO_URL" --quiet --eval '
const ids = EJSON.parse(require("fs").readFileSync("/backup/preference-tombstone-ids.json", "utf8"));
if (!Array.isArray(ids) || !ids.length || new Set(ids.map(id => id.toHexString())).size !== ids.length) {
  throw new Error("Expected a nonempty reviewed array of distinct ObjectIds");
}
const preferences = db.getCollection("preferences");
const types = {type: {$in: ["USER_WORKFLOW", "WORKFLOW_RESOURCE"]}};
const filter = {...types, deleted: true, _id: {$in: ids}};
const total = preferences.countDocuments({});
const live = preferences.countDocuments({...types, deleted: {$ne: true}});
if (preferences.countDocuments(filter) !== ids.length) {
  throw new Error("Manifest does not match current workflow tombstones; stop and reconcile");
}
const result = preferences.deleteMany(filter);
if (!result.acknowledged || result.deletedCount !== ids.length || preferences.countDocuments(filter) !== 0 ||
    preferences.countDocuments({}) !== total - ids.length ||
    preferences.countDocuments({...types, deleted: {$ne: true}}) !== live) {
  throw new Error("Preference tombstone cleanup postcondition failed");
}
printjson({database: db.getName(), deleted: result.deletedCount, live});
'
```

Run the patched live-preference deduplication next, then repeat the raw collision audit and require zero groups before creating indexes. Rehearse live+deleted and deleted+deleted collisions for both types, preserved live opt-outs, and manifest/deletion-count failures. Archive tombstones outside the application database; rollback restores the coordinated pre-upgrade backup. A partial deletion or failed postcondition blocks progression and requires a fresh inventory, not a blind rerun.

### Execute upstream migrations

Run only the audited applicable steps, in order, with auto-index creation disabled, using the immutable patched runner above:

```sh
pnpm exec ts-node --transpileOnly ./migrations/preferences-uniqueness/preferences-uniqueness-migration.ts
```

```sh
pnpm exec ts-node --transpileOnly ./migrations/001-add-default-identifier-to-topic-subscribers/add-default-identifier-to-topic-subscribers-migration.ts
```

```sh
pnpm exec ts-node --transpileOnly ./migrations/002-remove-duplicate-identifiers/remove-duplicate-identifiers.ts
```

```sh
pnpm exec ts-node --transpileOnly ./migrations/email-step-ui-schema-html-editor/email-step-ui-schema-html-editor-migration.ts
```

```sh
pnpm exec ts-node --transpileOnly ./migrations/add-layout-id-to-email-controls/add-layout-id-to-email-controls-migration.ts
```

```sh
pnpm exec ts-node --transpileOnly -e 'require("./src/config"); (async()=>{const dal=new (require("@novu/dal").DalService)();try{await dal.connect(process.env.MONGO_URL);await require("./migrations/agent-subscriber-access-default/agent-subscriber-access-default.migration").run();}finally{await dal.disconnect();}})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})'
```

```sh
pnpm exec ts-node --transpileOnly -e 'require("./src/config"); (async()=>{const dal=new (require("@novu/dal").DalService)();try{await dal.connect(process.env.MONGO_URL);await require("./migrations/infobip-sms-base-url/deactivate-misconfigured-infobip-sms-integrations.migration").deactivateMisconfiguredInfobipSmsIntegrations();}finally{await dal.disconnect();}})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})'
```

Only after the rollback window, if separately scheduled:

```sh
pnpm exec ts-node --transpileOnly ./migrations/deleteLogs/dropLogsCollection.ts
```

The five patched scripts propagate failures; other upstream scripts can still catch/log errors. A completed Job is not proof of migration success: require the postconditions below before advancing. Historical files with logic changes (`encrypt-api-keys`, `encrypt-credentials`, subscriber dedup, `changes-migration.ts`) are **not** new mandatory upgrade steps; audit existing encryption/dedup state instead of rerunning them. Other historical changes are formatting/import/logger changes; `subscriber-preferences-level` was removed. The six new `clickhouse-migrations/{1_initial_schema,2_add_workflow_id_to_schema,3_analytics_tables,4_refactor_traces_schema,5_finalize_table_exchange,6_add_source_to_requests}.sql` files are inapplicable without ClickHouse. `msteams-multi-tenant/README.md` describes Azure re-consent, not a Mongo migration.

## Migration verification and indexes

From a tools Job with the actual application `MONGO_URL`, capture collection counts and index definitions before and after. Do not output document credentials. These read-only checks run against the URI's selected database:

```sh
mongosh "$MONGO_URL" --quiet --eval '
print("database=" + db.getName());
for (const name of db.getCollectionNames().sort()) {
  printjson({name, count: db.getCollection(name).countDocuments({}), indexes: db.getCollection(name).getIndexes()});
}
printjson({missingTopicIdentifiers: db.topicsubscribers.countDocuments({identifier: {$exists: false}})});
printjson(db.topicsubscribers.aggregate([
  {$match: {identifier: {$exists: true}}},
  {$group: {_id: {env: "$_environmentId", identifier: "$identifier"}, count: {$sum: 1}}},
  {$match: {count: {$gt: 1}}}, {$count: "duplicateGroups"}
]).toArray());
for (const type of ["SUBSCRIBER_GLOBAL", "SUBSCRIBER_WORKFLOW", "USER_WORKFLOW", "WORKFLOW_RESOURCE"]) {
  const key = {env: "$_environmentId"};
  if (type.startsWith("SUBSCRIBER_")) {
    key.subscriber = "$_subscriberId";
    key.contextKeysHash = {$ifNull: ["$contextKeysHash", "DEFAULT_CONTEXT"]};
    key.contextKeys = {$sortArray: {input: {$ifNull: ["$contextKeys", []]}, sortBy: 1}};
  }
  if (type !== "SUBSCRIBER_GLOBAL") key.template = "$_templateId";
  printjson({type, duplicates: db.preferences.aggregate([
    {$match: {type}}, {$group: {_id: key, count: {$sum: 1}}},
    {$match: {count: {$gt: 1}}}, {$count: "groups"}
  ]).toArray()});
}'
```

Confirm collection names against the inventory before interpreting results. Recheck the legacy message cleanup counts and saved live-message samples before opening traffic. Require zero unresolved missing topic identifiers/duplicate groups for the legacy dataset. Review null/empty identifiers separately. Require zero raw workflow preference collision groups, including `deleted:true` rows; the Mongoose migration alone cannot establish this. Compare deleted counts with reviewed tombstone and survivor manifests and preserve representative preference values, including channel opt-outs. The audit uses the patched runner's context-aware grouping. Separately check the target unique index keys for collisions caused by inconsistent context hashes; reconcile those records without deleting valid distinct contexts.

For email UI fields compare affected template IDs and resulting body/editorType properties against the migration's exact $set values; check zero remaining templates matching the layout migration filter and inspect partial layouts. For agents require no missing behavior.subscriberAccess and correct managed/open versus restricted values. For Infobip verify only reviewed integration IDs were deactivated and no SendGrid flags or credentials changed. Confirm all other entity counts unchanged except approved deduplication, including organizations/environments/workflows/subscribers/topics.

Compare the target DAL schemas' desired indexes to saved `getIndexes()` output, including uniqueness and partial filters. Topic subscriptions require unique `{_environmentId:1, identifier:1}`. Preferences include contextKeysHash partial indexes and a workflow type partial index; don't replace these with a blanket uniqueness constraint. Schema sources: [topic subscriptions](https://github.com/novuhq/novu/blob/v3.19.0/libs/dal/src/repositories/topic/topic-subscribers.schema.ts), [preferences](https://github.com/novuhq/novu/blob/v3.19.0/libs/dal/src/repositories/preferences/preferences.schema.ts).

After approved dedup/backfills, remove **only** reviewed conflicting obsolete index names, with the exact `db.<collection>.dropIndex("<reviewed-name>")` operations recorded during rehearsal. Do not call blanket `dropIndexes()` or `syncIndexes()`. In a separate source runner Job, after inventorying the loaded model list, create target indexes without automatically deleting old ones:

```sh
pnpm exec ts-node --transpileOnly -e 'require("./src/config"); (async()=>{const {DalService,mongoose}=require("@novu/dal");const dal=new DalService();try{await dal.connect(process.env.MONGO_URL);for(const name of mongoose.modelNames()){const model=mongoose.model(name);console.log(name,JSON.stringify(model.schema.indexes()));await model.createIndexes();}}finally{await dal.disconnect();}})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})'
```

Verify the loaded model list covers the target collections and every expected index exists; require no E11000 or index option/name conflicts. This command's build/runtime viability must be established in rehearsal. Only then allow application startup auto-indexing. Snapshot the migrated rehearsal data and exercise the entire consumer matrix before scheduling live execution.

## Scheduled rollout and acceptance

1. Repeat the maintenance barrier and validated backups with fresh live data. Execute the same reviewed migration commands and postconditions, with the same immutable runner images and indexes disabled. Reconcile indexes.
2. With traffic blocked, deploy 3.19 API and WS first, worker held at zero replicas and auto-indexing disabled by the pinned staging values. Start dashboard on its new host and verify DNS, certificate and IP restriction. Keep producers paused.
3. Run the existing Activity Centre workflow sync Job against the API. Preserve code-first workflow identifiers, bridge URL and signing key. Verify repeated sync is idempotent. Start the 3.19 worker, then run approved synthetic traffic. Never briefly start all components against unmigrated data through a normal unattended sync.
4. All four deployments must pass startup/readiness/liveness: API/WS `/<contextPath>/v1/health-check` on 3000/3002 (or `/v1/health-check` with an empty context), worker `/v1/health-check` on 3004, dashboard `/` on 4000. API/WS context values are normalized by trimming surrounding slashes for both the environment and probes. The worker internal API_ROOT_URL appends the same normalized API context path. Confirm process counts, Mongo pools, no E11000/SSRF/decryption errors, stable memory/restarts, queue drain and representative p95 latency.
5. Complete the acceptance matrix below and attach evidence, expected/actual counts, logs, backup identifiers and restore timings. Open traffic only after owner acceptance. Prune obsolete frontend resources deliberately. Restore desired replica counts and reconcile overrides; leave future promotion manual.

| Consumer | Required acceptance |
| --- | --- |
| Dashboard | CE email/password login/logout, existing users/orgs/environments visible, registration rejected, assets and deep links load, clean CSP/CORS console, IP restriction and TLS valid. Inventory old UI workflow visibility separately. |
| Activity Centre `@novu/framework` 2.13 | Signed discover and execute via the unchanged `/audit-log-service-api/novu` URL; no SSRF block; sync Job succeeds twice without changing workflow identities; actual workflow execution and digest/retry behavior. Target framework source is 2.13.0. |
| Browser SDK 3.1.0 | `POST /v1/inbox/session` with **top-level** applicationIdentifier/subscriberId/subscriberHash returns usable session/token; notification listing, read/unread, preferences and Socket.IO realtime work. [Target DTO](https://github.com/novuhq/novu/blob/v3.19.0/apps/api/src/app/inbox/dtos/subscriber-session-request.dto.ts) retains the legacy field; [use case](https://github.com/novuhq/novu/blob/v3.19.0/apps/api/src/app/inbox/usecases/session/session.usecase.ts) falls back to it. Live behavior remains a rollout gate. |
| `@novu/api` 1.8.0 | From **both proda-core-api and excelsior**, subscriber lookup, topic subscribe/unsubscribe with `{subscriberIds:[...]}` and topic fanout; check SDK response parsing and swallowed warnings. Target [create](https://github.com/novuhq/novu/blob/v3.19.0/apps/api/src/app/topics-v2/dtos/create-topic-subscriptions.dto.ts)/[delete DTOs](https://github.com/novuhq/novu/blob/v3.19.0/apps/api/src/app/topics-v2/dtos/delete-topic-subscriptions.dto.ts) retain the old payload. |
| SendGrid/email | Preserve `sendgrid` provider, `apiKey`, `from`, `senderName`, active/primary flags and encryption key. An env SENDGRID_API_KEY cannot replace stored integration credentials. One owner-approved delivery with rendered body and one in-app delivery; use Mailpit where staging routes there, and separately verify SendGrid decryption/config. Never send a production test email during isolated rehearsal. |
| HMAC | Preserve integration hmac=true and environment API keys. HMAC-SHA256(key=environment API key, message=subscriberId), hex; correct accepted, wrong/missing rejected. JWT_SECRET/NOVU_SECRET_KEY are not the hashing key. |

## Rollback

Trigger rollback on failed migration postconditions, lost preferences/data, authentication or consumer failures, stuck queues, sustained errors/OOMs, or the agreed downtime deadline. Pause producers/traffic/sync Jobs and stop **all** 3.19 writers; suspend Argo self-heal/parent reconciliation. Save failure evidence before changing state.

Restore chart pin `b6f40fb6ab529119dd34bd47e6acaa16815240d9` **and** the full matching pre-upgrade values/CSP/sync-policy snapshot. This restores `web` keys, host, resources and 2.1 images; a pin-only rollback with dashboard values is invalid. Keep automation paused during restore.

A revision-only rollback is allowed only if no migrations (including legacy message cleanup), index changes or 3.19 writes occurred, or restored-copy rehearsal proved that exact data state compatible. Otherwise restore the coordinated pre-upgrade Mongo data **and indexes**, original credentials/config and matching Redis disk snapshot/AOF into fresh same-version storage. Do not point 2.1 at unverified 3.19-written data or flush queues. Use the validated `mongorestore` procedure above or validated disk snapshots; verify users/auth, all databases, counts, indexes, preferences and integrations before attaching applications. Reattach the restored claims/endpoints using the rehearsed plan; retain original PVCs/snapshots until acceptance.

Start all 2.1 components, verify baseline login/session/HMAC/topics/bridge/email and queue behavior, then reopen traffic and resume producers only after owner acceptance. A data restore loses post-backup writes; reconcile/replay source events deliberately and account for already-sent mail to avoid duplicate delivery. Record recovery duration and residual discrepancies. Do not delete obsolete logs until the rollback window closes.

## Outstanding owner gates

Replace blocked companion `c58b51404`/chart `28e4afa` pins and verify the exact bridge FQDN in both rendered server environments; review/remove staging's explicit new messages response opt-in; new dashboard DNS/TLS; actual database name, versions, PVC capacity and recoverable snapshots; legacy preference centralization applicability/replica-set rehearsal; duplicate survivor decisions and index reconciliation; immutable migration runner builds and restored-data execution; browser/consumer/provider smoke tests and representative resource measurements. None of these live checks was performed by this implementation task. Other regions need separate values/host/CSP updates and reviewed pins before rollout.
