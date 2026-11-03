# 🚀 Novu Helm Chart

> 📣 A Helm chart to deploy **Novu**, the open-source notification infrastructure, on Kubernetes.

## 🛠️ Prerequisites

- Kubernetes **1.20+**
- Helm **3.7+**

## 📥 Installation

1. **Add the repository** 📚
   ```bash
   helm repo add nova-edge-charts oci://ghcr.io/nova-edge/charts
   helm repo update
   ```

2. **Install the chart** 🎉
   ```bash
   helm install novu nova-edge-charts/novu \
     --namespace novu \
     --create-namespace
   ```

3. **Verify** 🔍
   ```bash
   kubectl get pods -n novu
   ```

## 🗑️ Uninstallation

To remove all Novu resources:
```bash
helm uninstall novu -n novu
kubectl delete namespace novu
```

## ⚙️ Configuration

The following table lists the most commonly used parameters. For the full list, refer to [values.yaml](values.yaml).

| Parameter                        | Description                      | Default    |
|----------------------------------|----------------------------------|------------|
| `dashboard.replicaCount`               | 🚀 Number of dashboard pods            | `1`        |
| `api.replicaCount`               | 🔧 Number of API pods            | `1`        |
| `worker.replicaCount`            | 🏭 Number of worker pods         | `1`        |
| `ws.replicaCount`                | 🌐 Number of WebSocket pods      | `1`        |
| `global.env.mongodb.maxPoolSize` | 💾 MongoDB connection pool size  | `200`      |
| `global.env.mongodb.autoCreateIndexes` | 🔍 Build MongoDB indexes on boot | `true` |
| `global.env.secret.jwtSecret`    | 🔑 JWT signing secret            | *required* |
| `ingress.enabled`                | 🚪 Enable ingress                | `false`    |
| `ingress.annotations`            | 🏷️ Annotations shared by both Ingresses | `{}` |
| `ingress.dashboard.annotations`        | 🎯 Extra annotations for the dashboard Ingress, merged over `ingress.annotations` | `{}` |
| `ingress.dashboard.tls.secretName`     | 🔒 TLS secret override for the dashboard host | `dashboard.<ingress.tls.secretName>` |

### 🚪 Ingress

With `ingress.enabled`, the chart renders two Ingresses: `<fullname>` for `api.<host>` and `ws.<host>`, and `<fullname>-dashboard` for `dashboard.<host>`. Both get `ingress.annotations`; the dashboard one also gets `ingress.dashboard.annotations` (its keys win), so you can restrict only the dashboard by source IP while the API and websocket stay reachable from browsers:

```yaml
ingress:
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
  dashboard:
    annotations:
      nginx.ingress.kubernetes.io/whitelist-source-range: "10.0.0.0/8"
```

## 🛢️ Persistence

By default, Novu uses ephemeral MongoDB and Redis. To enable persistence, configure `persistence` settings in [`values.yaml`](values.yaml).

## 📦 Image Tags

| Component | Default Image Tag   |
|-----------|---------------------|
| dashboard | `3.19.0`            |
| api       | `3.19.0`            |
| worker    | `3.19.0`            |
| ws        | `3.19.0`            |

## 📑 Schema Validation

Helm (>=3.7) automatically validates your custom values against `values.schema.json` on `helm install`, `helm upgrade` and `helm lint`.

**Editor support:** To get autocompletion & live errors, either:

- **Add a schema hint** at the top of `charts/novu/values.yaml`:
  ```yaml
  # yaml-language-server: $schema=./values.schema.json
  ```

- **Map the schema URL** in your IDE (VS Code, JetBrains, etc.) to `charts/novu/values.yaml`.

## 👥 Maintainers

| Name            | Email                         |
|-----------------|-------------------------------|
| Ugo Mignon      | ugo.mignon@gameverse.app      |
| Jordan Labrosse | jordan.labrosse@gameverse.app |

## 📄 License

This chart is licensed under the **MIT License**. See [LICENSE](../../LICENSE).

## Upgrading 2.1.0 → 3.19

Chart 0.3.0 targets server 3.19.0. Follow the [migration and rollout runbook](../../docs/UPGRADE-3.19-RUNBOOK.md) before deploying; migrations and index reconciliation must finish while writers are stopped. This is a scheduled data upgrade with coordinated Mongo/Redis backup and restore rehearsal.

Rename `web` values to `dashboard` and `ingress.web` to `ingress.dashboard`. The frontend image is `ghcr.io/novuhq/novu/dashboard`, port 4000; the Deployment, Service, Ingress, host prefix and default TLS secret prefix become `dashboard`. Provision DNS/TLS and carry over IP restrictions before pruning old web resources. API/WS service identities and ports remain unchanged.

Set `global.env.apiRootUrl` and `global.env.frontBaseUrl` (the new dashboard URL) to browser-reachable origins. `global.env.websocketUrl` defaults to empty: with ingress enabled it derives `https://ws.<ingress.host>` (HTTP without TLS); without ingress it uses `http://localhost:<ws.port>` for local access. Set an explicit browser-reachable websocket origin for other routing; explicit values take precedence. The dashboard receives only the two runtime VITE hostnames and uses its image entrypoint. REACT_APP variables, widget values, env-config.js and the pnpm startup command are removed. The image's inline configuration needs exact CSP hashes; see the runbook for generation and CORS changes.

`global.env.safeOutboundAllow` wires NOVU_SAFE_OUTBOUND_ALLOW to API and worker, defaulting to empty. Set only the confirmed bridge FQDN for private bridges; replace any existing `.svc.cluster.local` environment override before rollout; retain the existing bridge path and signing key. Explicit CE/v2 flags, logging and disabled New Relic settings are configurable under `global.env`; API compatibility flags are under `api`. Mongo min/max pools now both apply (10/200 by default). EU staging explicitly uses 10/50. Review per-process and aggregate pool sizing, checkout waits/timeouts and Mongo capacity before production promotion; do not inherit staging sizing without load evidence. Worker explicitly listens on 3004, with internal API routing. All applications have startup, readiness and liveness probes; dashboard resources now honor values.

Keep existing JWT, encryption and Novu keys, provider credentials, database/Redis Secret refs and PVCs. Auto-index creation on boot and configuration/Secret checksum rollouts remain enabled. No automatic migration hooks or additional bridge/studio/database services are installed. Review the runbook's single-process image evidence and staging trial resource budgets before promotion.

The [rendered Deployment diff](../../docs/UPGRADE-3.19-RENDER-DIFF.md) records image, port and effective environment changes against the pinned 2.1 chart.

Image tags remain empty in values and follow Chart.appVersion. Renovate is enabled for this fork, checks the API image's appVersion annotation and groups Novu Docker updates weekly without automerge. Verify all four image tags/digests exist and repeat migration/consumer review for each proposed server update.
