{{- define "novu.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "novu.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "novu.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "novu.labels" -}}
helm.sh/chart: {{ include "novu.chart" . }}
{{ include "novu.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "novu.selectorLabels" -}}
app.kubernetes.io/name: {{ include "novu.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "novu.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "novu.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "novu.api.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "api" -}}
{{- end -}}

{{- define "novu.dashboard.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "dashboard" -}}
{{- end -}}

{{- define "novu.worker.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "worker" -}}
{{- end -}}

{{- define "novu.ws.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "ws" -}}
{{- end -}}

{{- define "redis.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "redis" -}}
{{- end -}}

{{- define "mongodb.fullname" -}}
{{- printf "%s-%s" (include "novu.fullname" .) "mongodb" -}}
{{- end -}}
