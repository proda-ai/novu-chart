# WEB-6859: automated EU staging Novu upgrade

This flow upgrades only EU staging from 2.1.0 to 3.19.0. The binding lean addendum supersedes the old manual runbook and DESIGN's recovery-controller/outbox proposal. No upgrade is activated by merging the chart or publishing the runner. Hooks default to disabled. Other Applications, including Core UI, Excelsior and APS, continue deploying.

## Inputs and activation

L1 infrastructure #3662 must have applied in both `Proda/platform-staging` and `Proda/kubernetes-staging`. Compare their `novu_upgrade` outputs: bucket `proda-staging-636c0f80-novu-upgrade`, namespace `novu`, KSA `novu-upgrade`, state ConfigMap `novu-upgrade-state`, regional cluster `staging-proda-cluster` in `europe-west2`. Terraform owns the KSA/Role/RoleBinding/ConfigMap. This chart creates none of them. Pods opt into the projected token; GCS authenticates through Workload Identity ADC.

Activity Centre's independent `ops/novu-upgrade` workflow builds a runner from Novu commit `fe53c481acb005925b990fe2484fcb6aea396e28`, applying [the upstream patch](novu-3.19-migrations.patch), and publishes only on main. Copy the registry `@sha256` reference from the workflow summary; never use its mutable SHA tag in values. The package has no Activity Centre deployment dependency. Node, Mongo 8.0.8/database tools and Redis 7.4.3 are bundled; Jobs download no source or packages. Registry pull/WI and available ephemeral disk must be rehearsed before activation.

L4 changes only the Novu child Application: immutable chart/runner pins, `upgrade.enabled=true`, full reviewed `upgrade.syncRevision`, unique `operationId`/`attemptId`, bucket/KSA, `global.env.mongodb.autoCreateIndexes=false`, desired worker replicas 1, existing secret bytes and hosts preserved. `syncRevision` is supplied explicitly: Argo does not substitute an environment variable inside a rendered hook. Use the actual chart source SHA consistently across every Job. Configure automated sync with `selfHeal:false` and `retry.limit:0` during maintenance. Never selective-sync this Application; hooks do not run during selective sync. Parent automation remains enabled.

Supply an existing test subscriber, its environment application identifier and an existing Secret holding that environment's API key through `upgrade.smoke.*`. The smoke does not provision fixtures. Preserve `JWT_SECRET`, `NOVU_SECRET_KEY`, environment API keys, the exact 32-byte `STORE_ENCRYPTION_KEY`, integration IDs and provider credentials. Keep the bridge/Mailpit outbound allowlist, old messages response shape, Redis DB/config, Mongo standalone topology and PVCs. No real SendGrid delivery is part of automated smoke.

Preflight must confirm the exact L1 workload names: Deployments `novu-api`, `novu-worker`, `novu-ws`; StatefulSets `novu-mongodb`, `novu-redis-master`; Mongo major 8, Redis major 7, single master. Preserve Mongo chart 16.5.1 and Redis chart 20.13.4. Confirm 40Gi work space fits the compressed archives plus restored Mongo/Redis copies; tune resource budgets from rehearsal. Prepare [R1](R1-RESTORE.md) before arming.

## Execution and receipts

| Hook | Wave | Deadline | Result |
| --- | ---: | ---: | --- |
| PreSync quiesce | -60 | 300s | Scale API/worker/WS to zero and wait for Pod deletion. |
| PreSync backup | -50 | 600s | Pause Mongo TTL; dump all databases, snapshot Redis RDB and upload checksummed manifest. |
| PreSync verify | -40 | 900s | Download exact generations; restore on disposable loopback mongod; compare counts/options/indexes; check/load RDB. |
| PreSync precheck | -30 | 300s | Prove centralization unnecessary; reject collisions and invalid legacy/context/layout data. |
| PreSync migrate | -20 | 900s | Apply ordered pinned contracts and verify counts and complete value fingerprints. |
| PreSync reconcile-indexes | -10 | 600s | Apply only approved named drops; create/verify target DAL indexes. |
| PostSync smoke | 10 | 180s | API/WS health, seven active external workflows and valid HMAC inbox session; restore original TTL setting. |
| SyncFail failure | 0 | 300s | Stop writers, record contained failure, retain data for R1. |

Deadlines are upper bounds, not a measured downtime promise. Target maintenance downtime is at most 30 minutes; measure it in rehearsal. Jobs have no retries or TTL cleanup and use `BeforeHookCreation`; last runs remain inspectable. Datadog labels are `env:staging`, `service:novu-upgrade`; JSON includes operation_id, step, attempt, status, duration and exit_code. Termination/deadline can prevent any final log, so inspect Job status too.

Every operation claims a receipt with ConfigMap resourceVersion CAS. Matching completed receipts skip; partial, failed or changed-input receipts stop. A global owner rejects overlapping attempts. After a failed attempt, contain it and restore before beginning another upgrade attempt; changing the attempt string alone is not permission to resume partial migrations. Failure containment always rechecks writers even when its earlier receipt completed.

Backups live under `<sync-revision>/<attempt-id>/<operation-id>/`. Every upload uses `ifGenerationMatch=0`. The ConfigMap backup receipt references a manifest by object name, generation, SHA-256 and size; the manifest pins the Mongo archive, RDB and complete inventory. Step evidence uses unique immutable objects. Downloads specify the generation and recheck hashes. No logs or state contain raw documents or credentials. Retention is 30 days; lifecycle eligibility is 60 days, not a promise of immediate deletion.

The runner uses narrow raw Mongo operations and bundled upstream helpers, avoiding Nest bootstrap and its provider/queue side effects. Order: exact boolean `deleted:false` message-field removal; preference uniqueness audit; missing-only topic identifiers; topic uniqueness audit; email editor fields; layout fields; agent access defaults; conditional unsafe Infobip deactivation. Unsafe active Infobip integrations require their exact IDs in `upgrade.infobipIntegrationIds` before deactivation; the default empty list blocks such changes. No implicit preference/tombstone deletion is approved. All collisions, including raw workflow tombstones and subscription/context unique indexes, block before migration. Legacy `subscriberpreferences` must be empty; legacy workflow values must already be represented centrally. If centralization is needed, stop: the 2.1 temporary replica-set path is not automated here.

Index definitions come from the pinned DAL. `upgrade.indexDrops` must list each reviewed obsolete index's collection, name and SHA-256 of the normalized live definition (keys preserve ordering; server `v`, `ns`, `background` fields are excluded). No blanket `dropIndexes`/`syncIndexes`. Unapproved conflicts fail. App auto-indexing remains false after migration.

Mongo TTL is paused during backup/verification/migration, so collection comparisons have no expiry allowance that could hide lost rows. Redis expiration timestamps remain absolute in the RDB; expired keys disappear when it is loaded. All database backups are quiesced standalone `mongodump --archive --gzip`; there is no `--oplog`. Verification runs separate local processes in the runner Pod, never a scratch database on the live Mongo instance.

## Read-only observation

The observer needs VPN, current owner-renewed gcloud login, GKE read access and the Datadog EU logs PAT. No Secret reads, Pod exec, patch/delete, Argo operation or bucket-payload access is required.

```sh
gcloud container clusters list --project proda-staging-636c0f80
gcloud container clusters describe staging-proda-cluster --region europe-west2 --project proda-staging-636c0f80 --format='value(name,location,status)'
kubectl config current-context
kubectl -n novu get jobs,pods,events
kubectl -n novu get deployments novu-api novu-worker novu-ws
kubectl -n novu get configmap novu-upgrade-state -o json
kubectl -n novu logs job/novu-upgrade-verify --all-containers=true --timestamps
kubectl -n novu describe job novu-upgrade-migrate
```

For Datadog, set the non-secret operation ID and an existing read-only PAT in the shell environment. Keep shell tracing disabled. Search ascending and follow `meta.page.after` with `page.cursor` until exhausted:

```sh
curl --fail-with-body --silent --show-error \
  https://api.datadoghq.eu/api/v2/logs/events/search \
  -H "Authorization: Bearer ${DD_PAT}" -H 'Content-Type: application/json' \
  --data "{\"filter\":{\"from\":\"now-2h\",\"to\":\"now\",\"query\":\"service:novu-upgrade env:staging @operation_id:${OPERATION_ID}\"},\"sort\":\"timestamp\",\"page\":{\"limit\":100}}"
```

Useful queries: `service:novu-upgrade env:staging @status:failed`, `service:novu-upgrade env:staging @status:contained`, and `service:novu-upgrade env:staging @step:restore`. L1 monitors failed `novu-upgrade-*` Jobs, Novu CrashLoop/OOM/restarts/replica availability and ingress 5xx. Missing logs/metrics are never proof of success. Rehearse actual ingestion, metric tags and notification delivery.

## Failure and recovery

A migration/precheck/verification error blocks Sync before 3.19 writers start. SyncFail scales the writers to zero, writes a summary and does **not** restore data. If the hook cannot run, the read-only observer alerts the owner; the observer does not mutate the cluster. A partial receipt is intentional evidence, not something to erase. Keep the operation's Jobs terminated before merging R1; the runner also refuses concurrent active runner Pods.

Traffic and queue consumption resume during Sync, before PostSync smoke. Activity Centre triggers during downtime fail and are logged; there is no outbox. A later R1 restore loses writes since the backup and can replay queued notifications already delivered during the 3.19 window. This is the accepted staging trade-off. Do not describe recovery as lossless or auto-restore in a loop.

R1 pins chart `b6f40fb6ab529119dd34bd47e6acaa16815240d9` and the **complete** saved 2.1 values/configuration from main, including web hostname/CSP and existing credentials/claims. A second immutable source contains standalone quiesce/restore hooks; changing only server image tags is insufficient. `upgrade.mode=restore` deliberately fails rendering on the 3.19 chart to prevent accidental 3.19 Sync after restore.

The restore quiesce Job stops writer and datastore StatefulSet Pods. Only then can the restore Job mount the existing RWO claims. It downloads the selected manifest generations, verifies them again on isolated processes, empties the Mongo data directory, restores **all** archived databases/users/indexes and verifies the inventory. Redis persistence is rebuilt from the RDB, including a completed AOF rewrite before shutdown; stale AOF files cannot override the recovered RDB. The old chart restarts datastores and 2.1 workloads in Sync. No Terraform permission extension, Pod exec or runner-created Kubernetes resource is needed.

R1 is a separate reviewed operation/attempt with the original verified manifest object/generation/SHA-256. Never choose `latest`. Failure during restore remains closed and requires investigation; do not retry destructively by deleting receipts. After baseline health/session/HMAC/topics/bridge/Mailpit checks, record recovery duration and reconcile lost events/possible duplicate deliveries. Keep backups through the rollback window.

## Validation and rollout gates

Local checks: `helm dependency build charts/novu`, `helm lint charts/novu`, `bun scripts/verify-upgrade.ts`. The render script compares disabled output byte-for-byte with #5 at `b8ed8a841a4c113677d5d2dd20833f40b85de3c0` using identical fixed test datastore passwords, and asserts enabled hook annotations/waves, identity, labels, resources, deadlines and unsafe-input rejection. Chart CI runs the same script; the fork's Actions must be enabled for remote checks.

Before L4 activation, require a published digest, applied L1 outputs, WI/image-pull checks, a restored-data migration and full R1 rehearsal, killed-Job/upload-loss/collision/short-write/deadline/repeated-sync failure injection, and full consumer acceptance: dashboard login/registration guard, SDK 3.1 inbox/realtime/preferences, framework 2.13 discovery/execution and repeated sync, both @novu/api topic callers, HMAC invalid/missing rejection, Mailpit delivery, and stored SendGrid credential decryption without sending real staging mail. Verify dashboards/DNS/TLS/CSP, queues, error rates, memory and latency. Automated smoke proves only its listed subset. No live rehearsal or deployment is implied by Helm or unit-test success.
