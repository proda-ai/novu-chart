# Rendered Deployment changes

WEB-6859, refreshed 2026-11-04. Baseline chart `b6f40fb6ab529119dd34bd47e6acaa16815240d9` with the EU staging values from argocd-app-of-apps `main` versus this chart 0.3.0 with the exact `spec.source.helm.valuesObject` from `environments/staging/novu.yaml` in [argocd-app-of-apps #8848](https://github.com/proda-ai/argocd-app-of-apps/pull/8848).

Validation: default and exact staging `helm lint` and `helm template` pass; the baseline also renders. Render assertions check all four images/ports/probes, server flags, dashboard VITE-only environment, exact API/worker outbound exceptions, disabled staging auto-indexing, worker replicas zero, Service selectors/targets, dashboard IP allowlist, unchanged application Secret data and unchanged Mongo/Redis StatefulSet specs (excluding the existing randomly generated Redis Secret checksum). No migration Job is rendered. Additional renders verify worker API_ROOT_URL and API probes share the normalized context path; invalid LOG_LEVEL=INFO and NODE_ENV=staging are rejected. Live compatibility, migrations, CSP/browser behavior and capacity remain rollout gates in the [runbook](UPGRADE-3.19-RUNBOOK.md).

The pinned staging allowlist is `staging-audit-log-service-service.audit-log-service.svc.cluster.local,mailpit.novu.svc.cluster.local`, covering the bridge and private SMTP. It replaces the broad suffix exception. Mongo pools remain 10/50, MONGO_AUTO_CREATE_INDEXES is false, and worker replicas remain zero until migration/index verification and the controlled worker start. These are staging overrides: chart defaults remain an empty allowlist, pools 10/200, auto-indexing true and one worker. Production pool sizing requires the runbook's capacity review.

The chart defaults `api.newMessagesApiResponseEnabled` to false to retain `totalCount` and the prior `hasMore` calculation. Staging keeps it false; enabling the new response format is a separate, consumer-reviewed change. API/WS probes and worker API routing honor normalized context paths (empty in this staging input). `ingress.web` must be migrated to `ingress.dashboard` with its IP allowlist.

```diff
--- b6f40fb / EU staging values at argocd-app-of-apps main
+++ 0.3.0 / EU staging values in argocd-app-of-apps #8848
@@ -1,27 +1,36 @@
 - deployment: novu-api
   replicas: 1
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
+    IS_NEW_MESSAGES_API_RESPONSE_ENABLED: 'false'
+    IS_SELF_HOSTED: 'true'
+    IS_V2_ENABLED: 'true'
     JWT_SECRET: <Secret novu-secret:JWT_SECRET>
-    MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    LOG_LEVEL: info
+    MONGO_AUTO_CREATE_INDEXES: 'false'
+    MONGO_MAX_POOL_SIZE: '50'
+    MONGO_MIN_POOL_SIZE: '10'
     MONGO_URL: <Secret novu-mongodb-svcbind-root:uri>
     NEW_RELIC_APP_NAME: ''
+    NEW_RELIC_ENABLED: 'false'
     NEW_RELIC_LICENSE_KEY: <Secret novu-secret:NEW_RELIC_LICENSE_KEY>
     NODE_ENV: production
+    NOVU_ENTERPRISE: 'false'
+    NOVU_SAFE_OUTBOUND_ALLOW: staging-audit-log-service-service.audit-log-service.svc.cluster.local,mailpit.novu.svc.cluster.local
     NOVU_SECRET_KEY: <Secret novu-secret:NOVU_SECRET_KEY>
     PORT: '3000'
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
     REDIS_CACHE_SERVICE_HOST: novu-redis-master
     REDIS_CACHE_SERVICE_PORT: '6379'
     REDIS_DB_INDEX: '2'
@@ -33,28 +42,35 @@
     S3_REGION: eu-west-2
     SENTRY_DSN: <Secret novu-secret:SENTRY_DSN>
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
+    WIDGET_BASE_URL: ''
 - deployment: novu-worker
-  replicas: 1
-  image: ghcr.io/novuhq/novu/worker:2.1.0
-  ports: []
+  replicas: 0
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
-    MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    LOG_LEVEL: info
+    MONGO_AUTO_CREATE_INDEXES: 'false'
+    MONGO_MAX_POOL_SIZE: '50'
+    MONGO_MIN_POOL_SIZE: '10'
     MONGO_URL: <Secret novu-mongodb-svcbind-root:uri>
     MULTICAST_QUEUE_CHUNK_SIZE: '100'
     NEW_RELIC_APP_NAME: ''
+    NEW_RELIC_ENABLED: 'false'
     NEW_RELIC_LICENSE_KEY: <Secret novu-secret:NEW_RELIC_LICENSE_KEY>
     NODE_ENV: production
+    NOVU_ENTERPRISE: 'false'
+    NOVU_SAFE_OUTBOUND_ALLOW: staging-audit-log-service-service.audit-log-service.svc.cluster.local,mailpit.novu.svc.cluster.local
     NOVU_SECRET_KEY: <Secret novu-secret:NOVU_SECRET_KEY>
-    REACT_APP_API_URL: https://api.novu-staging.platform-services.proda.dev
-    REACT_APP_ENVIRONMENT: production
+    PORT: '3004'
     REDIS_CACHE_SERVICE_HOST: novu-redis-master
     REDIS_CACHE_SERVICE_PORT: '6379'
     REDIS_DB_INDEX: '2'
@@ -68,26 +84,28 @@
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
 - deployment: novu-ws
   replicas: 1
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
-    MONGO_AUTO_CREATE_INDEXES: 'true'
-    MONGO_MAX_POOL_SIZE: '200'
+    LOG_LEVEL: info
+    MONGO_AUTO_CREATE_INDEXES: 'false'
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
@@ -100,32 +118,12 @@
     SENTRY_DSN: <Secret novu-secret:SENTRY_DSN>
     STORE_ENCRYPTION_KEY: <Secret novu-secret:STORE_ENCRYPTION_KEY>
     WS_CONTEXT_PATH: ''
-- deployment: novu-web
+- deployment: novu-dashboard
   replicas: 1
-  image: ghcr.io/novuhq/novu/web:2.1.0
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
