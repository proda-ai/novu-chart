# Rendered Deployment changes

WEB-6859, 2026-11-02. Baseline chart commit `b6f40fb6ab529119dd34bd47e6acaa16815240d9` with original EU staging values versus chart 0.3.0 with updated EU staging values. Release/namespace: `novu`. ConfigMap values are expanded; Secret values stay symbolic. Other regions are unchanged.

Validation: default and staging `helm lint` pass; baseline and updated `helm template` pass. All four image/port/probe configurations, Service selectors/targets, checksum annotations, dashboard-only IP/CSP annotations, unchanged Mongo/Redis StatefulSet specs (excluding the existing randomly generated Redis Secret checksum) and unchanged application Secret data were checked. No migration Job is rendered. A changed config/Secret was rendered to verify rollout checksums change; a dashboard TLS override preserved API/WS TLS. The worker-paused render (`worker.replicaCount=0`) also passes. Renovate config passes its official JSON schema. Actual dashboard image output matches the staging CSP hash. Live compatibility, migrations and capacity remain rollout gates.

Consensus follow-up, 2026-11-03: default and exact pinned EU staging values pass `helm lint` and `helm template`. Additional render checks cover API/WS context paths, rejection of `ingress.web`, the default false versus staging true messages-response flag, and preservation of the dashboard IP allowlist. The five-script patch applies without offsets/fuzz to v3.19.0. Isolated mocks exercise migration success/failure exits and legacy message cleanup; they do not replace runner builds or restored-Mongo rehearsal.

Review follow-up: the chart default SSRF allowlist is now empty, its Mongo maximum remains 200 (minimum 10), and an unset websocket URL derives from ingress host/TLS or falls back to localhost only without ingress. The EU staging values in `aoa-novu-3-19/environments/staging/novu.yaml` explicitly set `.svc.cluster.local`, Mongo 10/50 and the public websocket URL, so their effective Deployment diff below is unchanged. Companion commit `c58b51404` pins chart `28e4afa` and remains blocked for rollout: replace that staging SSRF override with the confirmed bridge FQDN, repin the fixed chart in a new companion commit, and verify the exact host in both API/worker renders. The broad exception below records the current input; it is not an approved deployment configuration. Production pool sizing requires the runbook's explicit capacity review.

The chart now defaults `api.newMessagesApiResponseEnabled` to false to retain `totalCount` and the prior `hasMore` calculation. Staging explicitly opts in with true, so the flag below remains true; remove that override unless the response change is separately accepted. API/WS probe paths now honor their normalized context paths (empty in this staging input). `ingress.web` is rejected by schema validation; migrate every override, including the IP allowlist, to `ingress.dashboard`.

```diff
--- b6f40fb / original staging values
+++ 0.3.0 / updated staging values
@@ -1,26 +1,35 @@
 - deployment: novu-api
-  image: ghcr.io/novuhq/novu/api:2.1.0
+  image: ghcr.io/novuhq/novu/api:3.19.0
   ports:
-  - containerPort: 3000
+  - name: http
+    containerPort: 3000
   env:
     API_CONTEXT_PATH: ''
-    API_PORT: '3000'
     API_ROOT_URL: https://api.novu-staging.platform-services.proda.dev
     AWS_ACCESS_KEY_ID: dummy
     AWS_SECRET_ACCESS_KEY: <Secret novu-secret:AWS_SECRET_ACCESS_KEY>
+    DASHBOARD_URL: https://dashboard.novu-staging.platform-services.proda.dev
     DISABLE_USER_REGISTRATION: 'true'
-    FRONT_BASE_URL: https://web.novu-staging.platform-services.proda.dev
+    FRONT_BASE_URL: https://dashboard.novu-staging.platform-services.proda.dev
+    IS_API_IDEMPOTENCY_ENABLED: 'false'
+    IS_API_RATE_LIMITING_ENABLED: 'false'
+    IS_NEW_MESSAGES_API_RESPONSE_ENABLED: 'true'
+    IS_SELF_HOSTED: 'true'
+    IS_V2_ENABLED: 'true'
     JWT_SECRET: <Secret novu-secret:JWT_SECRET>
+    LOG_LEVEL: info
     MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    MONGO_MAX_POOL_SIZE: '50'
+    MONGO_MIN_POOL_SIZE: '10'
     MONGO_URL: <Secret novu-mongodb-svcbind-root:uri>
     NEW_RELIC_APP_NAME: ''
+    NEW_RELIC_ENABLED: 'false'
     NEW_RELIC_LICENSE_KEY: <Secret novu-secret:NEW_RELIC_LICENSE_KEY>
     NODE_ENV: production
+    NOVU_ENTERPRISE: 'false'
+    NOVU_SAFE_OUTBOUND_ALLOW: .svc.cluster.local
     NOVU_SECRET_KEY: <Secret novu-secret:NOVU_SECRET_KEY>
     PORT: '3000'
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
     REDIS_CACHE_SERVICE_HOST: novu-redis-master
     REDIS_CACHE_SERVICE_PORT: '6379'
     REDIS_DB_INDEX: '2'
@@ -32,27 +41,34 @@
     S3_REGION: eu-west-2
     SENTRY_DSN: <Secret novu-secret:SENTRY_DSN>
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
+    WIDGET_BASE_URL: ''
 - deployment: novu-worker
-  image: ghcr.io/novuhq/novu/worker:2.1.0
-  ports: []
+  image: ghcr.io/novuhq/novu/worker:3.19.0
+  ports:
+  - name: http
+    containerPort: 3004
   env:
-    API_CONTEXT_PATH: ''
-    API_PORT: '3000'
-    API_ROOT_URL: https://api.novu-staging.platform-services.proda.dev
+    API_ROOT_URL: http://novu-api.novu.svc.cluster.local:3000
     AWS_ACCESS_KEY_ID: dummy
     AWS_SECRET_ACCESS_KEY: <Secret novu-secret:AWS_SECRET_ACCESS_KEY>
     BROADCAST_QUEUE_CHUNK_SIZE: '100'
+    IS_SELF_HOSTED: 'true'
+    IS_V2_ENABLED: 'true'
     JWT_SECRET: <Secret novu-secret:JWT_SECRET>
+    LOG_LEVEL: info
     MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    MONGO_MAX_POOL_SIZE: '50'
+    MONGO_MIN_POOL_SIZE: '10'
     MONGO_URL: <Secret novu-mongodb-svcbind-root:uri>
     MULTICAST_QUEUE_CHUNK_SIZE: '100'
     NEW_RELIC_APP_NAME: ''
+    NEW_RELIC_ENABLED: 'false'
     NEW_RELIC_LICENSE_KEY: <Secret novu-secret:NEW_RELIC_LICENSE_KEY>
     NODE_ENV: production
+    NOVU_ENTERPRISE: 'false'
+    NOVU_SAFE_OUTBOUND_ALLOW: .svc.cluster.local
     NOVU_SECRET_KEY: <Secret novu-secret:NOVU_SECRET_KEY>
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
+    PORT: '3004'
     REDIS_CACHE_SERVICE_HOST: novu-redis-master
     REDIS_CACHE_SERVICE_PORT: '6379'
     REDIS_DB_INDEX: '2'
@@ -65,26 +81,28 @@
     SENTRY_DSN: <Secret novu-secret:SENTRY_DSN>
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
 - deployment: novu-ws
-  image: ghcr.io/novuhq/novu/ws:2.1.0
+  image: ghcr.io/novuhq/novu/ws:3.19.0
   ports:
-  - containerPort: 3002
+  - name: http
+    containerPort: 3002
   env:
-    API_CONTEXT_PATH: ''
-    API_PORT: '3000'
     API_ROOT_URL: https://api.novu-staging.platform-services.proda.dev
     AWS_ACCESS_KEY_ID: dummy
     AWS_SECRET_ACCESS_KEY: <Secret novu-secret:AWS_SECRET_ACCESS_KEY>
+    IS_SELF_HOSTED: 'true'
     JWT_SECRET: <Secret novu-secret:JWT_SECRET>
+    LOG_LEVEL: info
     MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    MONGO_MAX_POOL_SIZE: '50'
+    MONGO_MIN_POOL_SIZE: '10'
     MONGO_URL: <Secret novu-mongodb-svcbind-root:uri>
     NEW_RELIC_APP_NAME: ''
+    NEW_RELIC_ENABLED: 'false'
     NEW_RELIC_LICENSE_KEY: <Secret novu-secret:NEW_RELIC_LICENSE_KEY>
     NODE_ENV: production
+    NOVU_ENTERPRISE: 'false'
     NOVU_SECRET_KEY: <Secret novu-secret:NOVU_SECRET_KEY>
     PORT: '3002'
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
     REDIS_CACHE_SERVICE_HOST: novu-redis-master
     REDIS_CACHE_SERVICE_PORT: '6379'
     REDIS_DB_INDEX: '2'
@@ -97,31 +115,11 @@
     SENTRY_DSN: <Secret novu-secret:SENTRY_DSN>
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
     WS_CONTEXT_PATH: ''
-- deployment: novu-web
-  image: ghcr.io/novuhq/novu/web:2.1.0
+- deployment: novu-dashboard
+  image: ghcr.io/novuhq/novu/dashboard:3.19.0
   ports:
-  - containerPort: 4200
+  - name: http
+    containerPort: 4000
   env:
-    API_CONTEXT_PATH: ''
-    API_PORT: '3000'
-    API_ROOT_URL: https://api.novu-staging.platform-services.proda.dev
-    AWS_ACCESS_KEY_ID: dummy
-    MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
-    MONGO_URL: mongodb://novu-mongodb-mongodb.novu.svc.cluster.local:27017/novu
-    NEW_RELIC_APP_NAME: ''
-    NODE_ENV: production
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
-    REACT_APP_IS_SELF_HOSTED: 'true'
-    REACT_APP_WEBHOOK_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_WIDGET_EMBED_PATH: ''
-    REACT_APP_WS_URL: wss://ws.novu-staging.platform-services.proda.dev
-    REDIS_CACHE_SERVICE_HOST: novu-redis-master
-    REDIS_CACHE_SERVICE_PORT: '6379'
-    REDIS_DB_INDEX: '2'
-    REDIS_HOST: novu-redis-master.novu.svc.cluster.local
-    REDIS_PORT: '6379'
-    S3_BUCKET_NAME: novu-placeholder
-    S3_LOCAL_STACK: 'false'
-    S3_REGION: eu-west-2
+    VITE_API_HOSTNAME: https://api.novu-staging.platform-services.proda.dev
+    VITE_WEBSOCKET_HOSTNAME: https://ws.novu-staging.platform-services.proda.dev
```
