# WEB-6859: automated regional Novu upgrade

This flow wires staging, production and us-production upgrades from 2.1.0 to 3.19.0; regional infrastructure and rehearsal evidence remain rollout gates. This runbook supersedes the lean addendum's staging-only no-outbox trade-off for production. Production requires durable Activity Centre dispatch, a rehearsed suspend/drain/resume procedure, provisioning coordination and an accepted notification interruption window. Hooks default to disabled, and a 3.x workload render requires either armed upgrade hooks or an explicit data-readiness acknowledgement. Publishing the chart or runner does not activate an upgrade.

## Inputs and activation

L1 infrastructure #3662 must have applied in both `Proda/platform-staging` and `Proda/kubernetes-staging`. Compare their `novu_upgrade` outputs: bucket `proda-staging-636c0f80-novu-upgrade`, namespace `novu`, KSA `novu-upgrade`, state ConfigMap `novu-upgrade-state`, regional cluster `staging-proda-cluster` in `europe-west2`. Terraform owns the KSA/Role/RoleBinding/ConfigMap. This chart creates none of them. Pods opt into the projected token; GCS authenticates through Workload Identity ADC.

Required regional inputs for upgrade, report and recheck:

| upgrade.deployEnv / DEPLOY_ENV | upgrade.bucket / BACKUP_BUCKET | Namespace |
| --- | --- | --- |
| staging | proda-staging-636c0f80-novu-upgrade | novu |
| production | proda-production-1d97bb62-novu-upgrade | novu |
| us-production | proda-production-us-novu-upgrade | novu |

The chart defaults both regional strings to empty; any enabled Job mode refuses missing or mismatched inputs. `upgrade.smoke.minWorkflows` drives `MIN_WORKFLOWS` on every Job, including report, and defaults to seven. EU production requires at least one; US production also requires at least one unless the explicit exception below is approved. The runner binds a non-default minimum to operation identity, so recheck cannot lower it mid-attempt. Labels and JSON logs use the same deployment environment.

### Data-readiness acknowledgement and regional values

With `upgrade.enabled=false`, every 3.x workload render, including recheck, requires `upgrade.migratedOperationId` naming the operation that completed the data migration. Review its completed migration and index-reconciliation receipts before adding this value. It acknowledges data compatibility, not passing smoke or operational acceptance. Helm cannot read or prove the live receipts; a `contained` or `verification-failed` status alone is insufficient because containment can precede migration. Recheck additionally requires this value to equal `upgrade.operationId`; the runner still checks ownership and prerequisite receipts. Report-only mode needs no acknowledgement and renders only its Job, with both datastore subcharts disabled.

A genuinely fresh installation can instead set `upgrade.freshInstall: true`, with `upgrade.migratedOperationId: ""`, after confirming both Mongo and Redis contain no existing Novu data. These acknowledgements are mutually exclusive; fresh-install acknowledgement is forbidden for recheck. Never use it to bypass migration of existing stores, including externally supplied stores. Defaults intentionally fail a bare 3.x render. The chart-testing fixture `charts/novu/ci/fresh-install-values.yaml` acknowledges its disposable empty stores.

EU staging is already migrated by `web-6859-eu-staging-3-19-001`. Add the following to `spec.source.helm.valuesObject` for the next recheck, retaining the original attempt, sync revision, runner digest and smoke inputs (including the previous-key correction where required):

```yaml
upgrade:
  enabled: false
  migratedOperationId: web-6859-eu-staging-3-19-001
  freshInstall: false
  operationId: web-6859-eu-staging-3-19-001
  deployEnv: staging
  bucket: proda-staging-636c0f80-novu-upgrade
  report:
    enabled: false
  recheck:
    enabled: true
  smoke:
    minWorkflows: 7
```

After the successful staging recheck, set `upgrade.recheck.enabled: false` and retain the acknowledgement and regional inputs.

For EU production's first 3.19 promotion, merge the chart pin atomically with these values, alongside all resolved activation inputs below. Do not acknowledge migration before it has completed:

```yaml
upgrade:
  enabled: true
  migratedOperationId: ""
  freshInstall: false
  deployEnv: production
  bucket: proda-production-1d97bb62-novu-upgrade
  report:
    enabled: false
  recheck:
    enabled: false
  smoke:
    minWorkflows: 7
    noConsumersApproved: false
```

US production uses the same activation shape with `upgrade.deployEnv: us-production` and `upgrade.bucket: proda-production-us-novu-upgrade`; set a positive workflow minimum from its inventory. For either region, the disarm change must set `upgrade.enabled: false` and `upgrade.migratedOperationId` to the exact completed `upgrade.operationId`, retaining `freshInstall: false`. For recheck before acceptance, use that same acknowledgement only after verifying completed migration/reconciliation, then enable recheck as above.

The only production zero-workflow exception is US: a reviewed inventory must establish no consumers (including Activity Centre, Core API and other callers), with an owner-approved evidence reference in the values PR. Then explicitly set both `upgrade.smoke.minWorkflows: 0` and `upgrade.smoke.noConsumersApproved: true` before the attempt. The schema rejects this flag outside `us-production` or with a nonzero minimum, and rejects an unacknowledged US zero. This waives only the workflow count: an existing synthetic subscriber/environment, Terraform smoke Secret, API/WS health and HMAC session checks remain mandatory. Staging may use zero for an inventory-backed rehearsal; EU production cannot. This is an operator attestation, not an automated inventory check.

Bucket names derive from Terraform's `modules/novu_upgrade` naming contract, EU project ID in `_production.tf`, and US `environments/us-production/platform/terraform.tfvars`. Compare applied regional outputs before activation; this wiring does not apply infrastructure. Use the regional project's cluster name/location and backup bucket for every observation and R1 command; the L1 paragraph above is the staging example only. Prepare actual regional PVC names using [R1](R1-RESTORE.md), never infer them from staging's existing claims.

Activity Centre's independent `ops/novu-upgrade` workflow builds a runner from Novu commit `fe53c481acb005925b990fe2484fcb6aea396e28`, applying [the upstream patch](novu-3.19-migrations.patch), and publishes only on main. Copy the registry `@sha256` reference from the workflow summary; never use its mutable SHA tag in values. The package has no Activity Centre deployment dependency. Node, Mongo 8.0.8/database tools and Redis 7.4.3 are bundled; Jobs download no source or packages. Registry pull/WI and available ephemeral disk must be rehearsed before activation.

L4 changes only the Novu child Application: immutable chart/runner pins, `upgrade.enabled=true`, full reviewed `upgrade.syncRevision`, unique `operationId`/`attemptId`, bucket/KSA, `global.env.mongodb.autoCreateIndexes=false`, desired worker replicas 1, existing secret bytes and hosts preserved. `syncRevision` is supplied explicitly: Argo does not substitute an environment variable inside a rendered hook. Use the actual chart source SHA consistently across every Job. Keep automated sync off on the production Application during the upgrade and sync it manually only. Set `retry.limit:0` because a manual sync operation can still retry. Never selective-sync this Application; hooks do not run during selective sync. Parent automation remains enabled.

Supply an existing test subscriber and its environment application identifier through `upgrade.smoke.*`; unresolved `SMOKE_*` and `REPLACE_*` inputs block rendering. The smoke does not provision fixtures. L1 declares ExternalSecret `novu/novu-upgrade-smoke`, copying the existing Secret Manager value `scr-s-audit-log-service-novu` for staging (`scr-p-audit-log-service-novu` for production; US must supply its confirmed Activity Centre key) through ClusterSecretStore `gcp-secret-manager` to Secret `novu-upgrade-smoke`, key `api-key`. Set `apiKeySecretName` and `apiKeySecretKey` to those names. The core-api namespace's Secret cannot satisfy a hook in `novu`. The report Application and the quiesce hook receive the same smoke inputs and Secret as the smoke hook and send its exact HMAC inbox session request to the still-running 2.1 API (see [Smoke credentials before maintenance](#smoke-credentials-before-maintenance)). Before creating even the report Job, apply the regional Terraform smoke Secret resources (infrastructure #3735 for production; US platform before kubernetes), supply the confirmed US key where applicable, and require ExternalSecret Ready plus the resulting `novu/novu-upgrade-smoke` Secret with key `api-key`. The report mounts this Secret and cannot start without it; it cannot be used to bypass the Terraform prerequisite. Before activation, require this ExternalSecret's Ready condition and `credentials.ok: true` in the report evidence; the runner records only sanitized results and fingerprints, never the key or session token. This proves both fixture existence and key/environment agreement before any writer stops. Do not change smoke inputs during an attempt; the only exception is correcting the smoke key through [recheck](#correcting-the-smoke-key). Preserve `JWT_SECRET`, `NOVU_SECRET_KEY`, environment API keys, the exact 32-byte `STORE_ENCRYPTION_KEY`, integration IDs and provider credentials. Keep the bridge/Mailpit outbound allowlist, old messages response shape, Redis DB/config, Mongo standalone topology and PVCs. No real SendGrid delivery is part of automated smoke.

Preflight must confirm the exact L1 workload names: Deployments `novu-api`, `novu-worker`, `novu-ws`; StatefulSets `novu-mongodb-mongodb`, `novu-redis-master`; Mongo major 8, Redis major 7, single master. Preserve Mongo chart 16.5.1 and Redis chart 20.13.4. Confirm 40Gi work space fits the compressed archives plus restored Mongo/Redis copies; tune resource budgets from rehearsal. Prepare [R1](R1-RESTORE.md) before arming.

## First activation

First activation uses `upgrade.indexDrops` pre-filled from the Novu 2.1 schema:

```yaml
upgrade:
  indexDrops:
    - collection: subscribers
      name: subscriberId_1__environmentId_1
      definitionSha256: e1f3b69204c2bd48663e2597e7a0917aa8f836afede8fe44dd8a69733594627a
    - collection: preferences
      name: _environmentId_1__templateId_1_type_1
      definitionSha256: f0b9477871d216902f35e20e311e7d508d98f6575e649d9923066820e475befb
```

Quiesce audits live indexes before recording `maintenanceStarted` and stopping writers. If live definitions differ or another unapproved conflict exists, the Job fails with writers still up. Its failure log and evidence contain every conflicting index's collection, live name, exact normalized definition JSON and hash, plus a paste-able `indexDrops` array. Read it with:

```sh
kubectl -n novu logs job/novu-upgrade-quiesce --all-containers=true
```

### Smoke credentials before maintenance

On a first attempt, quiesce proves the smoke credentials before the index audit, `maintenanceStarted` and any writer scaling: it waits up to 30 s for `API_URL` health, checks the smoke subscriber exists in the selected environment, then posts the smoke's HMAC inbox session request to the live 2.1 API. A wrong or rotated key fails quiesce with `HMAC inbox session credential check failed before maintenance; writers untouched` (a missing fixture or unhealthy API fails with its own guard). Writers stay up, no data changes, and SyncFail records failure without scaling writers, leaving the owner `contained` with `retryable:true`. Correct the Secret, confirm `credentials.ok: true` with a fresh report, and re-sync with a fresh `attemptId`. A successful check is recorded as `credentials` in the quiesce result; the quiesce receipt carries `smokeInputHash` and `smokeTargetHash`.

Copy the printed `indexDrops` entries into `spec.source.helm.valuesObject.upgrade.indexDrops` in `argocd-app-of-apps/environments/<DEPLOY_ENV>/novu.yaml`, review the definitions and approvals, set a fresh `attemptId`, and re-sync after the parent reconciles the corrected values. Archive the failed Job's logs first. Argo CD 2.13.2 also runs SyncFail for a failed PreSync Job; before maintenance, that hook records failure without scaling writers and permits a corrected attempt to claim ownership. The later precheck repeats the index audit after backup verification.

## Centralization findings

Inspect centralization findings through a **separate** `argocd-app-of-apps` child Application, e.g. `novu-upgrade-report`, targeting namespace `novu` and the same chart repository/path pinned at the new reviewed revision. Keep the existing Novu Application pinned at the 2.1 chart revision and never sync it during diagnostics. If precheck already failed, contain that attempt first and keep main sync disabled.

Set the report Application's `spec.source.helm.releaseName: novu` to satisfy the chart's fullname/RBAC check. Its `valuesObject` requires `upgrade.enabled=false`, `upgrade.report.enabled=true`, `mongodb.enabled=false`, `redis.enabled=false`, the immutable `upgrade.image` digest, `upgrade.operationId`, a fresh `upgrade.attemptId`, `upgrade.syncRevision` matching the full reviewed chart SHA and the resolved `upgrade.smoke.*` inputs of the planned upgrade. Set the matching `upgrade.deployEnv` and `upgrade.bucket` pair from [Inputs and activation](#inputs-and-activation). Retain the fixed defaults `upgrade.serviceAccountName=novu-upgrade` and `upgrade.operationStateName=novu-upgrade-state`. The Job uses the existing Secrets `novu-mongodb-svcbind-root`, `novu-redis`, `novu-secret` and the smoke key Secret; it creates none of those resources.

Only the plain `novu-upgrade-report` Job renders; enabling the upgrade or either datastore subchart fails rendering. It runs `precheck` with `MODE=report`, requires the smoke inputs but no prerequisite receipts, and audits read-only without claiming state, maintenance or scaling. It runs the pre-maintenance smoke credential check against the live 2.1 API and records `credentials` (`ok`, or the guard message) with `smokeInputHash`/`smokeTargetHash`. Audit findings or a failed credential check produce status `findings` and exit code 3, so the report Job fails while retaining its evidence; a clean report returns `complete` and exit code 0. Inspect the immutable `report-*.json` evidence, including `credentials.ok`, index and data audits, and centralization findings before arming; Job completion alone is insufficient. It has no Argo hook annotations and expires after 86400 seconds. Read its `report-*.json` evidence from the bucket, then remove the report Application from Git and confirm the cascading deletion removed `Job/novu-upgrade-report`: an orphaned fixed-name Job blocks a later report with changed inputs until it is cleaned up.

After reviewing the findings, arm the main Novu Application at the new chart revision with `upgrade.report.enabled=false`, `upgrade.centralize.approved=true`, a fresh `upgrade.attemptId` and `upgrade.enabled=true`, using the activation inputs above. The approved `centralize` hook runs after verify at wave -35 with `CENTRALIZE_APPROVED=true`, before precheck. Subscriber-level centralization remains out of scope: nonempty `subscriberpreferences` blocks the step.

## Dispatch gate before quiesce

Activity Centre PR #441 stores notification intents durably in PostgreSQL with the audit transaction and dispatches them asynchronously. For covered producers, intents created during maintenance must remain pending and be delivered after the window, preserving per-company ordering. This contract requires the suspend control and drain proof. The operator commands are `suspend EVIDENCE_UUID`, `drain-status` and `resume EVIDENCE_UUID`. `drain-status` exits 2 while any intent is still leased, and also when dispatch is not suspended; it exits 0 only when suspended and `leased` is 0, so pending intents that are not leased do not make it exit 2. The chart/runner does not enforce this gate today.

1. Before arming/syncing the upgrade, freeze Activity Centre/Core UI deployment changes and the independent `novu-provision` hook. Inventory other producers and pause or durably buffer them; PR #441 covers Activity Centre intents only.
2. Suspend dispatch with `suspend EVIDENCE_UUID` and the operation's evidence reference. Verify suspension is durable across dispatcher restarts and run `drain-status` until it exits 0, with `leased=0` and no in-flight Novu requests, before quiesce. Archive that proof. Continue accepting audit transactions into the outbox; do not drain pending intents by sending them during the window.
3. Keep dispatch suspended throughout quiesce, migration, Sync and failed verification/recovery. Novu workloads and their existing Redis queue consumers resume during Sync, before PostSync smoke; dispatch suspension does not stop that queue or make the inbox available through the window. An R1 restore is only clean before the first Sync effect. After any possible Sync effect, the default is forward repair and recheck, and an R1 restore needs the three conditions in [Standalone failure containment](#standalone-failure-containment): an explicit owner decision, explicit channel-aware reconciliation and an accepted recovery point.
4. After smoke and consumer acceptance pass, resume dispatch with `resume EVIDENCE_UUID`. Observe pending count/oldest age, quarantine and delivery evidence until the backlog drains; measure drain capacity above arrivals in rehearsal. Reconcile ambiguous deliveries from receiver evidence before unblocking successors; do not blindly retry possible accepted sends. Archive suspend/drain/resume evidence with the operation.

Without the outbox deployed, Activity Centre trigger failures during downtime are logged and can be lost; callers without durable buffering retain that risk. With the reviewed #441 but without suspend/drain, intents are stored, yet outage sends can become ambiguous/quarantined and block subsequent intents for the company indefinitely until reconciled. Service recovery alone does not drain those rows. With the completed gate, covered cards and approval emails are delayed by the window plus backlog drain; inbox reads/mutations and sockets still experience the announced outage. A no-loss claim also needs real Novu outage/recovery evidence and coverage of every producer.

## Execution and receipts

| Hook | Wave | Deadline | Result |
| --- | ---: | ---: | --- |
| PreSync quiesce | -60 | 360s | Prove the smoke HMAC inbox session against the live 2.1 API and audit index approvals with writers up; record maintenance start, then scale API/worker/WS to zero and wait for Pod deletion. |
| PreSync backup | -50 | 600s | Pause Mongo TTL; dump all databases, snapshot Redis RDB and upload checksummed manifest. |
| PreSync verify | -40 | 900s | Download exact generations; restore on disposable loopback mongod; compare counts/options/indexes; check/load RDB. |
| PreSync centralize (approved only) | -35 | 900s | Centralize legacy workflow preferences on standalone Mongo after verified backup. |
| PreSync precheck | -30 | 300s | Prove centralization unnecessary; reject collisions and invalid legacy/context/layout data. |
| PreSync migrate | -20 | 900s | Apply ordered pinned contracts and verify counts and complete value fingerprints. |
| PreSync reconcile-indexes | -10 | 600s | Apply only approved named drops; create/verify target DAL indexes. |
| PostSync smoke | 10 | 300s | API/WS health (retry connection errors and unhealthy responses every 5s for up to 180s), at least `upgrade.smoke.minWorkflows` active external workflows (default seven) and valid HMAC inbox session; restore original TTL setting. |
| SyncFail failure | 0 | 300s | Record failure; preserve writers and restore TTL after completed migration, otherwise contain maintenance failures; retain data for R1. |

Deadlines are upper bounds, not a measured downtime promise. Target maintenance downtime is at most 30 minutes; measure it in rehearsal. Jobs have no retries or TTL cleanup and use `BeforeHookCreation`; last runs remain inspectable. Datadog labels are `env:<upgrade.deployEnv>`, `service:novu-upgrade`; JSON includes operation_id, step, attempt, status, duration and exit_code. Termination/deadline can prevent any final log, so inspect Job status too.

Every operation claims a receipt with ConfigMap resourceVersion CAS. Matching completed receipts skip; partial, failed or changed-input receipts stop. A global owner rejects overlapping attempts. After a failed attempt, contain it and use the recovery decision below; changing the attempt string alone is not permission to resume partial migrations. For an owner with `maintenanceStarted:true`, failure rechecks writers at zero only while migration prerequisites are incomplete. After all prerequisites complete it preserves workloads and restores manifest TTL, recording `verification-failed`. A completed smoke is terminal: owner status `complete` for upgrade or `recovered` for R1 is terminal and skips without scaling writers or changing receipts. Data restore alone records nonterminal `restored`; failure still contains writers until R1 PostSync validation succeeds.

Backups live under `<sync-revision>/<attempt-id>/<operation-id>/`. Every upload uses `ifGenerationMatch=0`. The ConfigMap backup receipt references a manifest by object name, generation, SHA-256 and size; the manifest pins the Mongo archive, RDB and complete inventory. Step evidence uses unique immutable objects. Downloads specify the generation and recheck hashes. No logs or state contain raw documents or credentials. Retention is 30 days; lifecycle eligibility is 60 days, not a promise of immediate deletion.

The runner uses narrow raw Mongo operations and bundled upstream helpers, avoiding Nest bootstrap and its provider/queue side effects. Order: exact boolean `deleted:false` message-field removal; preference uniqueness audit; missing-only topic identifiers; topic uniqueness audit; email editor fields; layout fields; agent access defaults; conditional unsafe Infobip deactivation. Unsafe active Infobip integrations require their exact IDs in `upgrade.infobipIntegrationIds` before deactivation; the default empty list blocks such changes. No implicit preference/tombstone deletion is approved. All collisions, including raw workflow tombstones and subscription/context unique indexes, block before migration. Legacy `subscriberpreferences` must be empty; legacy workflow values must be represented centrally before precheck passes. If centralization is needed, follow the approval flow above.

Index definitions come from the pinned DAL. `upgrade.indexDrops` must list each reviewed obsolete index's collection, name and SHA-256 of the normalized live definition (keys preserve ordering; server `v`, `ns`, `background` fields are excluded). No blanket `dropIndexes`/`syncIndexes`. Unapproved conflicts fail. App auto-indexing remains false after migration.

Mongo TTL is paused during backup/verification/migration, so collection comparisons have no expiry allowance that could hide lost rows. Redis expiration timestamps remain absolute in the RDB; expired keys disappear when it is loaded. All database backups are quiesced standalone `mongodump --archive --gzip`; there is no `--oplog`. Verification runs separate local processes in the runner Pod, never a scratch database on the live Mongo instance.

Quiesce now runs fresh read-only subscriber-preference, workflow-plan, preference/message/topic/layout, Infobip and target unique-index checks before maintenance, alongside the existing version and index-definition checks, and requires enabled baseline TTL before a live first attempt. Post-quiesce checks still run because writers can change live data. Completed centralization, backup inventories, dump verification, migration fingerprints and all writes must stay after quiesce. No separate report receipt substitutes for this fresh check.

TTL stays paused after incomplete maintenance because expiry could invalidate backup comparisons or mutate partially migrated data; containment keeps writers stopped. Before maintenance it is untouched. After completed migration SyncFail restores the matching manifest setting even if smoke failed or never started, and converts an interrupted smoke receipt to failed evidence so recheck is reachable. Recheck restores TTL before its health/session checks, including when they fail. A terminated recheck needs standalone failure if it did not reach cleanup. TTL restoration errors preserve writers and `verification-failed`, record `ttlRestored:false` with sanitized details and exit nonzero; retry cleanup or recheck. R1 failure never contacts possibly stopped/partially restored Mongo for TTL; the saved baseline restart enables it. Terminal complete/recovered owners skip failure after verifying successful smoke evidence.

`verification-failed` expresses incomplete serving validation without claiming stopped writers or healthy workloads. It allows recheck and R1 but prevents a fresh upgrade. Legacy `contained` remains supported; a recheck sync can resume those workloads. Pre-migration containment semantics and retry rules remain unchanged.

## Acceptance and disarming

Prepare the follow-up Git change before activation. Once smoke, the full consumer acceptance checks and the observation window succeed, archive the operation evidence before any further Novu sync: all rendered Job manifests/statuses, Pod statuses/termination details, events, per-Pod timestamped logs, the `novu-upgrade-state` ConfigMap and the immutable GCS receipt references. Store that snapshot with the operation's acceptance record. `BeforeHookCreation` replaces the previous Job on another sync; completed receipts do not preserve its Kubernetes status or logs. Failed/terminated Jobs need the same snapshot before retry or R1.

Then merge a follow-up change to `argocd-app-of-apps/environments/<DEPLOY_ENV>/novu.yaml` setting `spec.source.helm.valuesObject.upgrade.enabled: false` and `upgrade.migratedOperationId` to the exact completed `upgrade.operationId`, with `upgrade.freshInstall: false`. Keep the accepted 3.19 chart pin, runner/operation inputs, worker replicas and `autoCreateIndexes:false` unchanged. Let the parent reconcile this child values change and confirm its rendered desired manifests contain no `novu-upgrade-*` resources before ordinary Novu changes resume. No new operation/attempt is needed for disarming. Retain the ConfigMap, GCS backups and archived evidence through the rollback window; do not clear receipts.

The runner's terminal-smoke guard prevents a later SyncFail from containing the accepted upgrade while disarming is pending. It does not prevent hook Job replacement, so acceptance is not operationally closed until the evidence is archived and the hooks are disarmed. R1 remains a separate restore operation and is still permitted after successful smoke.

## Recheck after a failed or missing smoke

Use recheck after completed migration when smoke failed or Sync failed before smoke could finish. The state ConfigMap must still belong to the same operation with owner status `verification-failed` (or legacy `contained`), the failure receipt must be complete with readable evidence and `serving: true` (or legacy `contained: true`), and quiesce, backup, verify, centralize (if present), precheck, migrate and reconcile-indexes must have completed for the same attempt. Normally the smoke receipt must be failed with readable evidence. For a `verification-failed` owner, a first recheck is also permitted when the smoke receipt is absent or still `running` without evidence or a result; legacy `contained` owners still require failed-smoke evidence. Preserve the quiesce receipt's `smokeTargetHash` when present; an existing smoke receipt must also satisfy its input/target fingerprint checks. This path runs smoke without rerunning migration or restoring data. A `running` owner is rejected; stop the previous operation and runners and complete containment before proceeding. Use a pinned runner digest that implements `MODE=recheck`; preserve the original operation, attempt, sync revision, runner, smoke subscriber, application identifier, API/WS endpoints, backup bucket and state name. Only the smoke key may differ; see [Correcting the smoke key](#correcting-the-smoke-key). Do not edit receipts or start a fresh attempt for recheck.

1. Archive the failed operation's Jobs, logs, state and evidence. After verifying completed migration/reconciliation, disarm hooks in the main Novu Application by setting `upgrade.enabled=false` and `upgrade.migratedOperationId` to the unchanged `upgrade.operationId`, keeping `upgrade.report.enabled=false` and `upgrade.freshInstall=false`, and let the parent reconcile the change before any child sync. Keep the 3.19 chart/workload configuration and `autoCreateIndexes:false`.
2. Enable `upgrade.recheck.enabled=true` and sync that Application. The normal workloads render alongside the plain `Job/novu-upgrade-recheck`, so this sync preserves serving 3.19 workloads or brings legacy contained workloads back up for smoke. The Job uses the smoke hook's image, identity, bucket, environment and Secrets with `MODE=recheck` and `args: [smoke]`; it has no Argo hook annotations, never restarts, and expires after 86400 seconds. Enabling upgrade hooks or report mode at the same time fails rendering.
3. Inspect `kubectl -n novu logs job/novu-upgrade-recheck --all-containers=true` and Job status. Require a completed smoke receipt, owner status `complete`, and read the receipt's exact immutable `smoke-complete-<uuid>.json` evidence from the backup bucket, checking `health`, `session`, `workflows`, `ttlRestored` and `attempts`. Recheck restores the Mongo TTL monitor from the backup manifest before health/session requests and leaves other receipts untouched. Failure records `verification-failed` without scaling. A killed recheck leaves `running/recheck`; after its Pod terminates, run standalone failure with the original owner inputs to restore TTL and release recovery.
4. Archive the Job, logs, receipt and evidence, then set `upgrade.recheck.enabled=false` and sync with pruning to remove the fixed-name Job. Confirm no upgrade Jobs remain in desired manifests before ordinary syncs resume. Before another recheck, confirm the previous Job and Pod are gone; do not rely on TTL cleanup to permit an immediate rerun.

### Correcting the smoke key

When the smoke failed only because the smoke Secret held a wrong or rotated key (`HMAC inbox session smoke failed`, the API answering 400 `Please provide a valid HMAC hash`), correct the Secret behind `upgrade.smoke.apiKeySecretName`/`apiKeySecretKey` and recheck the same attempt. Recheck accepts a different `SMOKE_API_KEY` only when the target fingerprint (API/WS endpoints, subscriber, application identifier) equals the failed smoke receipt's; any other difference still refuses with `Smoke inputs differ from the recorded attempt`. When the quiesce receipt carries `smokeTargetHash` (quiesce proved the credentials), the target must also equal it, otherwise recheck refuses with `Smoke target differs from the one quiesce proved; recheck refused`; the PostSync smoke claim applies the same check.

- A failed smoke receipt with `smokeTargetHash` needs no extra input.
- A receipt written before `smokeTargetHash` existed (it has only `smokeInputHash`, as EU staging attempt 002 does) refuses with `Smoke receipt has no target fingerprint` unless the recheck also receives the key the failed smoke used. Keep or create a Secret in `novu` holding that previous key and set `upgrade.recheck.previousApiKeySecretName` (and `previousApiKeySecretKey`, default `api-key`); the chart renders it as `SMOKE_PREVIOUS_API_KEY` on the recheck Job only. Recheck proceeds only when the current endpoints, subscriber and application identifier plus that previous key reproduce the recorded `smokeInputHash`, which proves only the key changed. For attempt 002 the previous key is still the Secret Manager value `scr-s-proda-core-api-novu`; source the previous-key Secret from it through an ExternalSecret, and delete that ExternalSecret and Secret and clear the value after the recheck.
- The recheck receipt and its `smoke-complete`/`smoke-failed` evidence record `smokeInputHash` (corrected), `recordedSmokeInputHash` (from the failed receipt) and `smokeTargetHash`; archive them with the operation.

## Read-only observation

The observer needs VPN, current owner-renewed gcloud login, GKE read access and the Datadog EU logs PAT. No Secret reads, Pod exec, patch/delete, Argo operation or bucket-payload access is required.

```sh
gcloud container clusters list --project "$PROJECT_ID"
gcloud container clusters describe "$CLUSTER_NAME" --region "$CLUSTER_LOCATION" --project "$PROJECT_ID" --format='value(name,location,status)'
kubectl config current-context
kubectl -n novu get jobs,pods,events
kubectl -n novu get deployments novu-api novu-worker novu-ws
kubectl -n novu get configmap novu-upgrade-state -o json
kubectl -n novu logs job/novu-upgrade-verify --all-containers=true --timestamps
kubectl -n novu describe job novu-upgrade-migrate
```

For Datadog, set `DEPLOY_ENV`, the non-secret operation ID and an existing read-only PAT in the shell environment. Keep shell tracing disabled. Search ascending and follow `meta.page.after` with `page.cursor` until exhausted:

```sh
curl --fail-with-body --silent --show-error \
  https://api.datadoghq.eu/api/v2/logs/events/search \
  -H "Authorization: Bearer ${DD_PAT}" -H 'Content-Type: application/json' \
  --data "{\"filter\":{\"from\":\"now-2h\",\"to\":\"now\",\"query\":\"service:novu-upgrade env:${DEPLOY_ENV} @operation_id:${OPERATION_ID}\"},\"sort\":\"timestamp\",\"page\":{\"limit\":100}}"
```

Useful queries: `service:novu-upgrade env:${DEPLOY_ENV} @status:failed`, `service:novu-upgrade env:${DEPLOY_ENV} @status:contained`, and `service:novu-upgrade env:${DEPLOY_ENV} @step:restore`. L1 monitors failed `novu-upgrade-*` Jobs, Novu CrashLoop/OOM/restarts/replica availability and ingress 5xx. Missing logs/metrics are never proof of success. Rehearse actual ingestion, metric tags and notification delivery.

## Failure and recovery

A migration/precheck/verification error blocks Sync before 3.19 writers start. SyncFail leaves writers untouched after every quiesce…reconcile-indexes prerequisite completes for the matching owner (centralize when present), restoring backup-manifest TTL and recording `verification-failed`. Incomplete maintenance still scales writers to zero, including inherited stopped writers; with no owner or before maintenance it leaves writers untouched. It writes failure evidence in either case and does **not** restore data. If the hook cannot run, the read-only observer alerts the owner; the observer does not mutate the cluster. A partial receipt is intentional evidence, not something to erase. Keep the operation's Jobs terminated before merging R1; the runner also refuses concurrent active runner Pods.

A Deployment exceeding `progressDeadlineSeconds` ([Kubernetes default 600s unless set](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#progress-deadline-seconds)) reports `ProgressDeadlineExceeded`; the pinned Argo CD v2.13.2 engine maps it to [Degraded](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/health/health_deployment.go#L32-L38) and fails the sync so SyncFail containment runs. An isolated stuck Deployment is therefore not necessarily unbounded. Other resources still Progressing can [delay failure and SyncFail](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/sync/sync_context.go#L416-L489). If sync remains Running after migrate, the observer alerts the upgrade owner immediately; containment is owner-operated:

1. In the verified regional context, run `argocd app get "$NOVU_APP" -o json | jq '{operation: (.status.operationState | {phase, startedAt, message}), resources: .status.resources}'` and `kubectl -n novu get deployments,pods,jobs,events`. Identify the completed migrate receipt, still-Progressing resources, Deployment conditions/deadlines and missing PostSync/SyncFail execution. `NOVU_APP` is the verified regional Novu Application name.
2. Disable child auto-sync in the Git-owned Application (remove `spec.syncPolicy.automated`, keep `retry.limit:0`); ensure the parent has reconciled this before proceeding so it cannot undo a live-only toggle. Archive current Job/Pod status, timestamped logs and receipts, then run `argocd app terminate-op "$NOVU_APP"`. Confirm the operation has stopped and all runner Pods have terminated; prevent concurrent manual syncs/retries during containment.
3. Read `kubectl -n novu get configmap novu-upgrade-state -o json`. Match `data.active.inputHash` and operation/attempt/revision to the stopped sync. Verify the complete quiesce…reconcile receipt chain, not just migrate. Stop and escalate on ambiguous ownership. A terminal `complete` or `recovered` owner requires matching successful smoke evidence and must remain serving. Do not manually scale a nonterminal owner merely because smoke or Sync failed: standalone failure decides whether migration completed and preserves writers in that case. Keep sync disabled to exclude concurrent reconciliation until the recovery decision is recorded.
4. Run standalone failure containment below with the **stopped operation's original inputs**, then require a successful Job, the same owner's `contained` or `verification-failed` status and a completed failure receipt with immutable evidence before R1. Argo CD v2.13.2's pinned [`Terminate()`](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/sync/sync_context.go#L1067-L1097) deletes running hooks and sets the operation phase directly; it does not run SyncFail hooks. Manual scaling alone leaves the runner owner `running`, which blocks R1's new quiesce claim. Do not edit/clear receipts or mark the owner `contained` manually.
5. Record UTC times, operation/attempt/revision/inputHash, ConfigMap resourceVersion and receipts, Argo operation/resource health, Deployment conditions, Job/Pod statuses/events/logs, replica counts and containment result with the immutable evidence references. Escalate immediately to the **regional platform on-call and the Novu upgrade owner for WEB-6859**, including any ownership ambiguity, containment failure or failure to stop writers. Keep sync disabled; keep incomplete-migration writers stopped and completed-migration workloads serving until reviewed recovery starts.

### Standalone failure containment

Use an operator with Job creation, Deployment scaling and Job/state/Pod/log read access in `novu`; the Job uses the existing L1 `novu-upgrade` service account and Workload Identity. Require Helm, Mike Farah `yq` v4, `jq` and `kubectl`. Run the blocks in the same Bash shell with tracing off. Set `ORIGINAL_CHART_DIR` to an absolute checkout of the stopped operation's exact chart source SHA with its locked chart dependencies available, and `ORIGINAL_VALUES` to an absolute, access-restricted YAML file containing that operation's complete effective Helm values. Use the archived activation inputs, not current main or R1 values. Preserve the runner digest, operation/attempt, sync revision, mode, bucket/state name, approved index drops/Infobip IDs, Secret references and their original bytes; changed inputs cannot claim the original owner. Do not change the attempt ID to run containment.

After steps 1–3 above, render only the hook template into a private scratch directory outside the checkout. This does not apply workloads:

```sh
set -eu
set -o pipefail
: "${ORIGINAL_CHART_DIR:?Set the original chart checkout path}"
: "${ORIGINAL_VALUES:?Set the original effective Helm values file}"
umask 077
CONTAINMENT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/novu-containment.XXXXXX")
helm template novu "$ORIGINAL_CHART_DIR/charts/novu" --namespace novu \
  --values "$ORIGINAL_VALUES" --show-only templates/upgrade-jobs.yaml \
  > "$CONTAINMENT_DIR/hooks.yaml"
```

For containment of a terminated R1 operation instead, replace the entire block above with the following, setting `ORIGINAL_R1_JOBS` to its archived, fully resolved standalone `jobs.yaml`. Preserve its original `MODE=restore` and selected backup object/generation/checksum as well as the other inputs. Do not render the 3.19 chart in restore mode. The subsequent selection accepts exactly one failure Job from either source.

```sh
set -eu
set -o pipefail
: "${ORIGINAL_R1_JOBS:?Set the original resolved R1 jobs.yaml path}"
umask 077
CONTAINMENT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/novu-containment.XXXXXX")
cp "$ORIGINAL_R1_JOBS" "$CONTAINMENT_DIR/hooks.yaml"
```

Create a fresh standalone Job name so retained hook Jobs and evidence are not overwritten. Replace only Job metadata, removing Argo hook/tracking metadata while retaining the complete Pod spec, runner labels, identity, Secret references and failure arguments. After this block, review the generated JSON against the stopped operation before creating the Job; do not proceed on any mismatch.

```sh
yq -o=json '.' "$CONTAINMENT_DIR/hooks.yaml" | jq -se '
  [.[] | select(.kind == "Job" and .spec.template.spec.containers[0].args == ["failure"])]
  | if length == 1 then .[0] else error("Expected exactly one failure Job") end
  | .metadata = {
      generateName: "novu-upgrade-manual-failure-",
      namespace: "novu",
      labels: .spec.template.metadata.labels
    }
' > "$CONTAINMENT_DIR/failure.json"
```

Recheck the nonterminal owner against step 3 immediately before creation. `EXPECTED_INPUT_HASH` must be the exact hash already verified there. The runner independently requires its computed input hash to match the active owner, rejects other active runners, stops/verifies writers only for incomplete maintenance, uploads evidence and records `contained` for incomplete maintenance or `verification-failed` after completed migration; it restores no data. Keep concurrent syncs and runners excluded throughout.

```sh
: "${EXPECTED_INPUT_HASH:?Set the verified stopped operation inputHash}"
kubectl -n novu get configmap novu-upgrade-state -o json | jq -e --arg hash "$EXPECTED_INPUT_HASH" '
  .data.active | fromjson
  | .inputHash == $hash and (.status == "running" or .status == "restored" or .status == "contained" or .status == "verification-failed")
'
CONTAINMENT_JOB=$(kubectl -n novu create -f "$CONTAINMENT_DIR/failure.json" -o name)
kubectl -n novu wait --for=condition=complete --timeout=660s "$CONTAINMENT_JOB"
kubectl -n novu logs "$CONTAINMENT_JOB" --all-containers=true --timestamps
kubectl -n novu get configmap novu-upgrade-state -o json > "$CONTAINMENT_DIR/state-after.json"
jq -e --arg hash "$EXPECTED_INPUT_HASH" '
  (.data.active | fromjson | .inputHash == $hash and (.status == "contained" or .status == "verification-failed")) and
  ([.data | to_entries[] | select(.key | startswith("r-")) | .value | fromjson
    | select(.inputHash == $hash and .step == "failure" and .status == "complete"
      and (.result.contained == true or (.result.serving == true and .result.ttlRestored == true)) and .evidence.name and .evidence.generation and .evidence.sha256)] | length == 1)
' "$CONTAINMENT_DIR/state-after.json"
```

If creation, waiting or either state check fails, stop and escalate; do not launch R1 or clear ownership. Archive the standalone Job/Pod status, logs and the failure receipt's immutable evidence reference with the original operation, and confirm its Pod has terminated before recovery. A successful failure receipt and matching `contained` or `verification-failed` owner allow a fresh R1 quiesce claim; the selected backup must still have completed verification. Keep sync disabled until reviewed recovery starts; `verification-failed` writers keep serving and R1 quiesce stops them explicitly.

Traffic and existing Redis queue consumption resume during Sync, before PostSync smoke; Activity Centre dispatch must remain suspended until the acceptance gate above passes. An R1 restore is only clean before the first Sync effect. Once Sync may have had any effect (workloads started on 3.19, queues consumed), an R1 restore loses user writes made since the backup and can repeat queued emails, so the default after that point is forward repair and recheck, and an R1 restore needs an explicit owner decision, explicit channel-aware reconciliation and an accepted recovery point. The separate PostgreSQL outbox retains accepted delivery records, so cards removed by restore are not automatically replayed; indiscriminate replay can duplicate email. Durable intents do not make post-release restore lossless; never auto-restore in a loop.

Choose recovery from the receipts, not just the failed Job name:

- If quiesce, backup, verification or precheck failed before a migration/index/smoke/restore receipt exists, require successful SyncFail containment, owner status `contained` with `retryable:true`, no malformed receipts and termination of every previous runner Job. Correct the prerequisite and use a fresh attempt ID, preserving the old receipts. The next attempt must quiesce, take a new backup and verify it before precheck/migration. The runner carries forward the recorded original TTL setting across retryable attempts. Writers remain stopped until that attempt reaches Sync; changing the attempt alone does not reopen them. Once an earlier owner stopped writers, the API is down, so fresh quiesce skips the live check. The active record carries `writersStopped` and any credential proof (`smokeInputHash` and evidence reference) across every retry handoff, even if quiesce never completed or an intermediate retry failed before starting maintenance. Matching smoke inputs reuse the inherited proof and record `credentials: { session: true, provenBy, reason: "inherited proof with matching smokeInputHash" }`. If changed smoke inputs, including a changed key, match neither the inherited credential proof nor the previous quiesce receipt's `smokeInputHash`, the runner rejects the handoff unless explicitly given `ALLOW_UNPROVEN_SMOKE=true` (default false). The chart exposes no value for this override; it must be supplied explicitly in a separately reviewed runner Job configuration. With the override and no matching proof, quiesce proceeds and records `credentials: { session: false, reason: "writers already stopped by a prior attempt", unprovenUntilSmoke: true, allowUnprovenSmoke: true }`; the override does not prove credentials, and PostSync smoke must verify them. Legacy contained owners with `maintenanceStarted:true` also qualify. First attempts and fresh upgrades after successful recovery still require the live check before maintenance. A report run in that state records `credentials.ok: false` (`Health smoke failed`).
- Without a completed verification receipt, the attempted backup is not eligible for R1. Do not manufacture verification evidence, clear state or merge the destructive restore Jobs. Precheck requires completed verification, so a clean contained pre-mutation failure can follow the fresh-attempt path above. If containment or ownership is ambiguous, keep the system closed and escalate for investigation; there is no automatic recovery authorization.
- A centralize receipt alone does not select R1. Centralize writes are idempotent upserts into the preferences collection that 2.1 tolerates, so a running or failed centralize needs no restore: follow the fresh-attempt path, which re-runs centralize. If centralize completed and precheck later failed, data changed additively only; apply the same rule and do not treat it as the pre-mutation restore branch, but archive the centralize evidence with the original operation.
- An R1 restore is only clean before the first Sync effect. While a migration or index reconciliation receipt exists (including a running or failed receipt) and Sync has had no effect, use R1 with a completed verification receipt for the exact selected manifest, then begin a fresh reviewed upgrade attempt. Once Sync may have had any effect, the default is forward repair and recheck, and an R1 restore needs the three conditions stated above: an explicit owner decision, explicit channel-aware reconciliation and an accepted recovery point. This includes a Sync failure before smoke with a `verification-failed` owner and an absent or unfinished smoke receipt: use the first recheck path in [Recheck after a failed or missing smoke](#recheck-after-a-failed-or-missing-smoke) when its receipt checks pass. If those checks do not pass, forward repair remains the default and those same three conditions still apply. A smoke failure cannot be repaired by editing smoke values on the contained attempt, except correcting the smoke key through [recheck](#correcting-the-smoke-key). If no eligible backup can be established despite mutation evidence before any Sync effect, keep writers stopped and escalate; neither R1 nor a fresh upgrade is safe to authorize from those receipts.

R1 pins the verified regional baseline chart SHA (staging example: `b6f40fb6ab529119dd34bd47e6acaa16815240d9`) and the **complete** saved regional 2.1 values/configuration, including web hostname/CSP and existing credentials/claims. A second immutable source contains standalone quiesce/restore, PostSync smoke and SyncFail hooks; changing only server image tags is insufficient. `upgrade.mode=restore` deliberately fails rendering on the 3.19 chart to prevent accidental 3.19 Sync after restore.

The restore quiesce Job stops writer and datastore StatefulSet Pods. Only then can the restore Job mount the existing RWO claims. It downloads the selected manifest generations, verifies them again on isolated processes, empties the Mongo data directory, restores **all** archived databases/users/indexes and verifies the inventory. Redis persistence is rebuilt from the RDB, including a completed AOF rewrite before shutdown; stale AOF files cannot override the recovered RDB. The old chart restarts datastores and 2.1 workloads in Sync. R1 PostSync smoke then validates API/WS health and the existing HMAC inbox session in restore mode before recording `recovered`; an apply failure after data restore still contains writers. Retire the separate R1 source/hooks as required in [R1](R1-RESTORE.md) before ordinary syncs resume. No Terraform permission extension, Pod exec or runner-created Kubernetes resource is needed.

R1 is a separate reviewed operation/attempt with the original verified manifest object/generation/SHA-256. Never choose `latest`. Failure during restore remains closed and requires investigation; do not retry destructively by deleting receipts. After baseline health/session/HMAC/topics/bridge/Mailpit checks, record recovery duration and reconcile lost events/possible duplicate deliveries. Keep backups through the rollback window.

## Validation and rollout gates

Local checks: `helm dependency build charts/novu`, `helm lint charts/novu --set upgrade.freshInstall=true`, `bun scripts/verify-upgrade.ts`. The render script rejects unacknowledged 3.x workloads, verifies migrated/fresh-install and recheck acknowledgements, enforces production workflow minima and the US exception, compares acknowledged disarmed output byte-for-byte with #5 at `b8ed8a841a4c113677d5d2dd20833f40b85de3c0` using identical fixed test datastore passwords, and asserts enabled hook annotations/waves, identity, labels, resources, deadlines and unsafe-input rejection. Chart-testing skips GitHub maintainer-account validation because the inherited Chart.yaml lists upstream display names; chart schema, YAML lint and install checks remain enabled. Chart CI runs the same script; the fork's Actions must be enabled for remote checks.

Before L4 activation, require a published digest, applied L1 outputs, WI/image-pull checks, a restored-data migration and full R1 rehearsal, killed-Job/upload-loss/collision/short-write/deadline/repeated-sync failure injection, and full consumer acceptance: dashboard login/registration guard, SDK 3.1 inbox/realtime/preferences, framework 2.13 discovery/execution and repeated sync, both @novu/api topic callers, HMAC invalid/missing rejection, Mailpit delivery, and stored SendGrid credential decryption without sending real staging mail. Verify dashboards/DNS/TLS/CSP, queues, error rates, memory and latency. Automated smoke proves only its listed subset. No live rehearsal or deployment is implied by Helm or unit-test success.
