# WEB-6859: automated EU staging Novu upgrade

This flow upgrades only EU staging from 2.1.0 to 3.19.0. The binding lean addendum supersedes the old manual runbook and DESIGN's recovery-controller/outbox proposal. No upgrade is activated by merging the chart or publishing the runner. Hooks default to disabled. Other Applications, including Core UI, Excelsior and APS, continue deploying.

## Inputs and activation

L1 infrastructure #3662 must have applied in both `Proda/platform-staging` and `Proda/kubernetes-staging`. Compare their `novu_upgrade` outputs: bucket `proda-staging-636c0f80-novu-upgrade`, namespace `novu`, KSA `novu-upgrade`, state ConfigMap `novu-upgrade-state`, regional cluster `staging-proda-cluster` in `europe-west2`. Terraform owns the KSA/Role/RoleBinding/ConfigMap. This chart creates none of them. Pods opt into the projected token; GCS authenticates through Workload Identity ADC.

Activity Centre's independent `ops/novu-upgrade` workflow builds a runner from Novu commit `fe53c481acb005925b990fe2484fcb6aea396e28`, applying [the upstream patch](novu-3.19-migrations.patch), and publishes only on main. Copy the registry `@sha256` reference from the workflow summary; never use its mutable SHA tag in values. The package has no Activity Centre deployment dependency. Node, Mongo 8.0.8/database tools and Redis 7.4.3 are bundled; Jobs download no source or packages. Registry pull/WI and available ephemeral disk must be rehearsed before activation.

L4 changes only the Novu child Application: immutable chart/runner pins, `upgrade.enabled=true`, full reviewed `upgrade.syncRevision`, unique `operationId`/`attemptId`, bucket/KSA, `global.env.mongodb.autoCreateIndexes=false`, desired worker replicas 1, existing secret bytes and hosts preserved. `syncRevision` is supplied explicitly: Argo does not substitute an environment variable inside a rendered hook. Use the actual chart source SHA consistently across every Job. Configure automated sync with `selfHeal:false` and `retry.limit:0` during maintenance. Never selective-sync this Application; hooks do not run during selective sync. Parent automation remains enabled.

Supply an existing test subscriber and its environment application identifier through `upgrade.smoke.*`; unresolved `SMOKE_*` and `REPLACE_*` inputs block rendering. The smoke does not provision fixtures. L1 declares ExternalSecret `novu/novu-upgrade-smoke`, copying the existing Secret Manager value `scr-s-proda-core-api-novu` through ClusterSecretStore `gcp-secret-manager` to Secret `novu-upgrade-smoke`, key `api-key`. Set `apiKeySecretName` and `apiKeySecretKey` to those names. The core-api namespace's Secret cannot satisfy a hook in `novu`. Before activation, require this ExternalSecret's Ready condition and a successful HMAC inbox session against the still-running 2.1 API using the exact subscriber, application identifier and key; record sanitized evidence, never the key or session token. This proves both fixture existence and key/environment agreement before migration. Do not change smoke inputs during an attempt. Preserve `JWT_SECRET`, `NOVU_SECRET_KEY`, environment API keys, the exact 32-byte `STORE_ENCRYPTION_KEY`, integration IDs and provider credentials. Keep the bridge/Mailpit outbound allowlist, old messages response shape, Redis DB/config, Mongo standalone topology and PVCs. No real SendGrid delivery is part of automated smoke.

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

Copy the printed `indexDrops` entries into `spec.source.helm.valuesObject.upgrade.indexDrops` in `argocd-app-of-apps/environments/staging/novu.yaml`, review the definitions and approvals, set a fresh `attemptId`, and re-sync after the parent reconciles the corrected values. Archive the failed Job's logs first. Argo CD 2.13.2 also runs SyncFail for a failed PreSync Job; before maintenance, that hook records failure without scaling writers and permits a corrected attempt to claim ownership. The later precheck repeats the index audit after backup verification.

## Centralization findings

When precheck stops on workflow centralization, contain the failed attempt, then inspect findings with the upgrade disarmed. The report runs only with `upgrade.enabled=false` and `upgrade.report.enabled=true`: no hooks render and the 2.1 workloads stay untouched, so the plain `novu-upgrade-report` Job syncs as an ordinary resource. With `upgrade.enabled=true` the failing PreSync hooks run first and Argo never reaches it. The Job runs `precheck` with `MODE=report`; it requires the runner digest, operation/attempt IDs and sync revision, but no smoke inputs or prerequisite receipts. It audits read-only without claiming state, maintenance or scaling, and findings do not fail it. It has no Argo hook annotations and expires after 86400 seconds. Read its `report-<uuid>.json` evidence from the bucket.

After reviewing the findings, set `upgrade.report.enabled=false` and `upgrade.centralize.approved=true`, set a fresh `upgrade.attemptId`, and re-arm with `upgrade.enabled=true`. The approved `centralize` hook runs after verify at wave -35 with `CENTRALIZE_APPROVED=true`, before precheck. Subscriber-level centralization remains out of scope: nonempty `subscriberpreferences` blocks the step.

## Execution and receipts

| Hook | Wave | Deadline | Result |
| --- | ---: | ---: | --- |
| PreSync quiesce | -60 | 300s | Audit index approvals with writers up; record maintenance start, then scale API/worker/WS to zero and wait for Pod deletion. |
| PreSync backup | -50 | 600s | Pause Mongo TTL; dump all databases, snapshot Redis RDB and upload checksummed manifest. |
| PreSync verify | -40 | 900s | Download exact generations; restore on disposable loopback mongod; compare counts/options/indexes; check/load RDB. |
| PreSync centralize (approved only) | -35 | 900s | Centralize legacy workflow preferences on standalone Mongo after verified backup. |
| PreSync precheck | -30 | 300s | Prove centralization unnecessary; reject collisions and invalid legacy/context/layout data. |
| PreSync migrate | -20 | 900s | Apply ordered pinned contracts and verify counts and complete value fingerprints. |
| PreSync reconcile-indexes | -10 | 600s | Apply only approved named drops; create/verify target DAL indexes. |
| PostSync smoke | 10 | 180s | API/WS health, seven active external workflows and valid HMAC inbox session; restore original TTL setting. |
| SyncFail failure | 0 | 300s | Record failure; stop writers only if the owner started maintenance; retain data for R1. |

Deadlines are upper bounds, not a measured downtime promise. Target maintenance downtime is at most 30 minutes; measure it in rehearsal. Jobs have no retries or TTL cleanup and use `BeforeHookCreation`; last runs remain inspectable. Datadog labels are `env:staging`, `service:novu-upgrade`; JSON includes operation_id, step, attempt, status, duration and exit_code. Termination/deadline can prevent any final log, so inspect Job status too.

Every operation claims a receipt with ConfigMap resourceVersion CAS. Matching completed receipts skip; partial, failed or changed-input receipts stop. A global owner rejects overlapping attempts. After a failed attempt, contain it and use the recovery decision below; changing the attempt string alone is not permission to resume partial migrations. For an owner with `maintenanceStarted:true`, failure containment rechecks writers even when its earlier containment receipt completed, except when the same operation has completed smoke: owner status `complete` for upgrade or `recovered` for R1 is terminal and skips without scaling writers or changing receipts. Data restore alone records nonterminal `restored`; failure still contains writers until R1 PostSync validation succeeds.

Backups live under `<sync-revision>/<attempt-id>/<operation-id>/`. Every upload uses `ifGenerationMatch=0`. The ConfigMap backup receipt references a manifest by object name, generation, SHA-256 and size; the manifest pins the Mongo archive, RDB and complete inventory. Step evidence uses unique immutable objects. Downloads specify the generation and recheck hashes. No logs or state contain raw documents or credentials. Retention is 30 days; lifecycle eligibility is 60 days, not a promise of immediate deletion.

The runner uses narrow raw Mongo operations and bundled upstream helpers, avoiding Nest bootstrap and its provider/queue side effects. Order: exact boolean `deleted:false` message-field removal; preference uniqueness audit; missing-only topic identifiers; topic uniqueness audit; email editor fields; layout fields; agent access defaults; conditional unsafe Infobip deactivation. Unsafe active Infobip integrations require their exact IDs in `upgrade.infobipIntegrationIds` before deactivation; the default empty list blocks such changes. No implicit preference/tombstone deletion is approved. All collisions, including raw workflow tombstones and subscription/context unique indexes, block before migration. Legacy `subscriberpreferences` must be empty; legacy workflow values must be represented centrally before precheck passes. If centralization is needed, follow the approval flow above.

Index definitions come from the pinned DAL. `upgrade.indexDrops` must list each reviewed obsolete index's collection, name and SHA-256 of the normalized live definition (keys preserve ordering; server `v`, `ns`, `background` fields are excluded). No blanket `dropIndexes`/`syncIndexes`. Unapproved conflicts fail. App auto-indexing remains false after migration.

Mongo TTL is paused during backup/verification/migration, so collection comparisons have no expiry allowance that could hide lost rows. Redis expiration timestamps remain absolute in the RDB; expired keys disappear when it is loaded. All database backups are quiesced standalone `mongodump --archive --gzip`; there is no `--oplog`. Verification runs separate local processes in the runner Pod, never a scratch database on the live Mongo instance.

## Acceptance and disarming

Prepare the follow-up Git change before activation. Once smoke, the full consumer acceptance checks and the observation window succeed, archive the operation evidence before any further Novu sync: all rendered Job manifests/statuses, Pod statuses/termination details, events, per-Pod timestamped logs, the `novu-upgrade-state` ConfigMap and the immutable GCS receipt references. Store that snapshot with the operation's acceptance record. `BeforeHookCreation` replaces the previous Job on another sync; completed receipts do not preserve its Kubernetes status or logs. Failed/terminated Jobs need the same snapshot before retry or R1.

Then merge a follow-up change to `argocd-app-of-apps/environments/staging/novu.yaml` setting only `spec.source.helm.valuesObject.upgrade.enabled: false`. Keep the accepted 3.19 chart pin, runner/operation inputs, worker replicas and `autoCreateIndexes:false` unchanged. Let the parent reconcile this child values change and confirm its rendered desired manifests contain no `novu-upgrade-*` resources before ordinary Novu changes resume. No new operation/attempt is needed for disarming. Retain the ConfigMap, GCS backups and archived evidence through the rollback window; do not clear receipts.

The runner's terminal-smoke guard prevents a later SyncFail from containing the accepted upgrade while disarming is pending. It does not prevent hook Job replacement, so acceptance is not operationally closed until the evidence is archived and the hooks are disarmed. R1 remains a separate restore operation and is still permitted after successful smoke.

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

A migration/precheck/verification error blocks Sync before 3.19 writers start. SyncFail scales the writers to zero only when the matching owner has `maintenanceStarted:true`; with no owner or before maintenance, it leaves writers untouched. It writes failure evidence in either case and does **not** restore data. If the hook cannot run, the read-only observer alerts the owner; the observer does not mutate the cluster. A partial receipt is intentional evidence, not something to erase. Keep the operation's Jobs terminated before merging R1; the runner also refuses concurrent active runner Pods.

A Deployment exceeding `progressDeadlineSeconds` ([Kubernetes default 600s unless set](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#progress-deadline-seconds)) reports `ProgressDeadlineExceeded`; the pinned Argo CD v2.13.2 engine maps it to [Degraded](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/health/health_deployment.go#L32-L38) and fails the sync so SyncFail containment runs. An isolated stuck Deployment is therefore not necessarily unbounded. Other resources still Progressing can [delay failure and SyncFail](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/sync/sync_context.go#L416-L489). If sync remains Running after migrate, the observer alerts the upgrade owner immediately; containment is owner-operated:

1. In the verified EU staging context, run `argocd app get "$NOVU_APP" -o json | jq '{operation: (.status.operationState | {phase, startedAt, message}), resources: .status.resources}'` and `kubectl -n novu get deployments,pods,jobs,events`. Identify the completed migrate receipt, still-Progressing resources, Deployment conditions/deadlines and missing PostSync/SyncFail execution. `NOVU_APP` is the verified EU staging Novu Application name.
2. Disable child auto-sync in the Git-owned Application (remove `spec.syncPolicy.automated`, keep `retry.limit:0`); ensure the parent has reconciled this before proceeding so it cannot undo a live-only toggle. Archive current Job/Pod status, timestamped logs and receipts, then run `argocd app terminate-op "$NOVU_APP"`. Confirm the operation has stopped and all runner Pods have terminated; prevent concurrent manual syncs/retries during containment.
3. Read `kubectl -n novu get configmap novu-upgrade-state -o json`. Match `data.active.inputHash` (decode the JSON stored in `data.active`) to the affected attempt's migrate receipt (restore receipt for interrupted R1) and verify its operation, attempt and revision against the stopped sync. Check the owner and receipts again immediately before scaling; stop and escalate on missing, malformed, changed or mismatched ownership. A `complete` or `recovered` owner requires its matching completed smoke receipt and evidence: do not scale that terminal operation down because obsolete hooks failed. For the verified nonterminal owner (`running`, `restored` or `contained`), run `kubectl -n novu scale deployment novu-api novu-worker novu-ws --replicas=0`; verify each Deployment's desired replicas is zero and no Pods matching its `spec.selector.matchLabels` remain. Keep sync disabled so reconciliation cannot restart writers.
4. Run standalone failure containment below with the **stopped operation's original inputs**, then require a successful Job, the same owner's `contained` status and a completed failure receipt with immutable evidence before R1. Argo CD v2.13.2's pinned [`Terminate()`](https://github.com/argoproj/gitops-engine/blob/bd7681ae3f8b/pkg/sync/sync_context.go#L1067-L1097) deletes running hooks and sets the operation phase directly; it does not run SyncFail hooks. Manual scaling alone leaves the runner owner `running`, which blocks R1's new quiesce claim. Do not edit/clear receipts or mark the owner `contained` manually.
5. Record UTC times, operation/attempt/revision/inputHash, ConfigMap resourceVersion and receipts, Argo operation/resource health, Deployment conditions, Job/Pod statuses/events/logs, replica counts and containment result with the immutable evidence references. Escalate immediately to the **EU staging platform on-call and the Novu upgrade owner for WEB-6859**, including any ownership ambiguity, containment failure or failure to stop writers. Keep writers stopped and sync disabled until they approve the reviewed recovery path below.

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
      labels: {"tags.datadoghq.com/env": "staging", "tags.datadoghq.com/service": "novu-upgrade"}
    }
' > "$CONTAINMENT_DIR/failure.json"
```

Recheck the nonterminal owner against step 3 immediately before creation. `EXPECTED_INPUT_HASH` must be the exact hash already verified there. The runner independently requires its computed input hash to match the active owner, stops/verifies writers, rejects other active runners, uploads evidence and records `contained`; it restores no data. Keep concurrent syncs and runners excluded throughout.

```sh
: "${EXPECTED_INPUT_HASH:?Set the verified stopped operation inputHash}"
kubectl -n novu get configmap novu-upgrade-state -o json | jq -e --arg hash "$EXPECTED_INPUT_HASH" '
  .data.active | fromjson
  | .inputHash == $hash and (.status == "running" or .status == "restored" or .status == "contained")
'
CONTAINMENT_JOB=$(kubectl -n novu create -f "$CONTAINMENT_DIR/failure.json" -o name)
kubectl -n novu wait --for=condition=complete --timeout=660s "$CONTAINMENT_JOB"
kubectl -n novu logs "$CONTAINMENT_JOB" --all-containers=true --timestamps
kubectl -n novu get configmap novu-upgrade-state -o json > "$CONTAINMENT_DIR/state-after.json"
jq -e --arg hash "$EXPECTED_INPUT_HASH" '
  (.data.active | fromjson | .inputHash == $hash and .status == "contained") and
  ([.data | to_entries[] | select(.key | startswith("r-")) | .value | fromjson
    | select(.inputHash == $hash and .step == "failure" and .status == "complete"
      and .result.contained == true and .evidence.name and .evidence.generation and .evidence.sha256)] | length == 1)
' "$CONTAINMENT_DIR/state-after.json"
```

If creation, waiting or either state check fails, stop and escalate; do not launch R1 or clear ownership. Archive the standalone Job/Pod status, logs and the failure receipt's immutable evidence reference with the original operation, and confirm its Pod has terminated before recovery. A successful failure receipt and matching `contained` owner allow a fresh R1 quiesce claim; the selected backup must still have completed verification. Keep sync disabled and writers stopped until the reviewed recovery starts.

Traffic and queue consumption resume during Sync, before PostSync smoke. Activity Centre triggers during downtime fail and are logged; there is no outbox. A later R1 restore loses writes since the backup and can replay queued notifications already delivered during the 3.19 window. This is the accepted staging trade-off. Do not describe recovery as lossless or auto-restore in a loop.

Choose recovery from the receipts, not just the failed Job name:

- If quiesce, backup, verification or precheck failed before a migration/index/smoke/restore receipt exists, require successful SyncFail containment, owner status `contained` with `retryable:true`, no malformed receipts and termination of every previous runner Job. Correct the prerequisite and use a fresh attempt ID, preserving the old receipts. The next attempt must quiesce, take a new backup and verify it before precheck/migration. The runner carries forward the recorded original TTL setting across retryable attempts. Writers remain stopped until that attempt reaches Sync; changing the attempt alone does not reopen them.
- Without a completed verification receipt, the attempted backup is not eligible for R1. Do not manufacture verification evidence, clear state or merge the destructive restore Jobs. Precheck requires completed verification, so a clean contained pre-mutation failure can follow the fresh-attempt path above. If containment or ownership is ambiguous, keep the system closed and escalate for investigation; there is no automatic recovery authorization.
- A centralize receipt alone does not select R1. Centralize writes are idempotent upserts into the preferences collection that 2.1 tolerates, so a running or failed centralize needs no restore: follow the fresh-attempt path, which re-runs centralize. If centralize completed and precheck later failed, data changed additively only; apply the same rule and do not treat it as the pre-mutation restore branch, but archive the centralize evidence with the original operation.
- Once a migration, index reconciliation or smoke receipt exists (including running or failed receipts), use R1 with a completed verification receipt for the exact selected manifest. A smoke failure cannot be repaired by editing smoke values on the contained attempt. Restore the verified baseline, then begin a fresh reviewed upgrade attempt. If no eligible backup can be established despite mutation evidence, keep writers stopped and escalate; neither R1 nor a fresh upgrade is safe to authorize from those receipts.

R1 pins chart `b6f40fb6ab529119dd34bd47e6acaa16815240d9` and the **complete** saved 2.1 values/configuration from main, including web hostname/CSP and existing credentials/claims. A second immutable source contains standalone quiesce/restore, PostSync smoke and SyncFail hooks; changing only server image tags is insufficient. `upgrade.mode=restore` deliberately fails rendering on the 3.19 chart to prevent accidental 3.19 Sync after restore.

The restore quiesce Job stops writer and datastore StatefulSet Pods. Only then can the restore Job mount the existing RWO claims. It downloads the selected manifest generations, verifies them again on isolated processes, empties the Mongo data directory, restores **all** archived databases/users/indexes and verifies the inventory. Redis persistence is rebuilt from the RDB, including a completed AOF rewrite before shutdown; stale AOF files cannot override the recovered RDB. The old chart restarts datastores and 2.1 workloads in Sync. R1 PostSync smoke then validates API/WS health and the existing HMAC inbox session in restore mode before recording `recovered`; an apply failure after data restore still contains writers. Retire the separate R1 source/hooks as required in [R1](R1-RESTORE.md) before ordinary syncs resume. No Terraform permission extension, Pod exec or runner-created Kubernetes resource is needed.

R1 is a separate reviewed operation/attempt with the original verified manifest object/generation/SHA-256. Never choose `latest`. Failure during restore remains closed and requires investigation; do not retry destructively by deleting receipts. After baseline health/session/HMAC/topics/bridge/Mailpit checks, record recovery duration and reconcile lost events/possible duplicate deliveries. Keep backups through the rollback window.

## Validation and rollout gates

Local checks: `helm dependency build charts/novu`, `helm lint charts/novu`, `bun scripts/verify-upgrade.ts`. The render script compares disabled output byte-for-byte with #5 at `b8ed8a841a4c113677d5d2dd20833f40b85de3c0` using identical fixed test datastore passwords, and asserts enabled hook annotations/waves, identity, labels, resources, deadlines and unsafe-input rejection. Chart-testing skips GitHub maintainer-account validation because the inherited Chart.yaml lists upstream display names; chart schema, YAML lint and install checks remain enabled. Chart CI runs the same script; the fork's Actions must be enabled for remote checks.

Before L4 activation, require a published digest, applied L1 outputs, WI/image-pull checks, a restored-data migration and full R1 rehearsal, killed-Job/upload-loss/collision/short-write/deadline/repeated-sync failure injection, and full consumer acceptance: dashboard login/registration guard, SDK 3.1 inbox/realtime/preferences, framework 2.13 discovery/execution and repeated sync, both @novu/api topic callers, HMAC invalid/missing rejection, Mailpit delivery, and stored SendGrid credential decryption without sending real staging mail. Verify dashboards/DNS/TLS/CSP, queues, error rates, memory and latency. Automated smoke proves only its listed subset. No live rehearsal or deployment is implied by Helm or unit-test success.
