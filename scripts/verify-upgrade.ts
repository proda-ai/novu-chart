import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (program: string, args: string[]) => {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const scratch = mkdtempSync(join(tmpdir(), 'novu-hooks-'));
const fixture = join(scratch, 'values.yaml');
writeFileSync(fixture, `mongodb:
  auth:
    rootPassword: render-test-only
redis:
  auth:
    password: render-test-only
`);
const render = (path: string, args: string[] = []) => run('helm', ['template', 'novu', path, '-n', 'novu', '-f', fixture, ...args]);
try {
  const archive = spawnSync('git', ['archive', 'b8ed8a841a4c113677d5d2dd20833f40b85de3c0', 'charts/novu'], { maxBuffer: 20 * 1024 * 1024 });
  assert.equal(archive.status, 0);
  const unpack = spawnSync('tar', ['-x', '-C', scratch], { input: archive.stdout });
  assert.equal(unpack.status, 0);
  cpSync('charts/novu/charts', join(scratch, 'charts/novu/charts'), { recursive: true });
  assert.equal(render('charts/novu'), render(join(scratch, 'charts/novu')), 'Disabled render must equal PR #5 byte for byte');
  const enabled = ['--set', 'upgrade.enabled=true', '--set', 'global.env.mongodb.autoCreateIndexes=false', '--set-string', `upgrade.image=example.invalid/runner@sha256:${'a'.repeat(64)}`, '--set-string', 'upgrade.operationId=eu-staging-upgrade', '--set-string', 'upgrade.attemptId=rehearsal-one', '--set-string', `upgrade.syncRevision=${'b'.repeat(40)}`, '--set-string', 'upgrade.smoke.subscriberId=fixture-subscriber', '--set-string', 'upgrade.smoke.applicationIdentifier=fixture-application', '--set-string', 'upgrade.smoke.apiKeySecretName=fixture-smoke'];
  const parse = (output: string) => output.split(/^---\s*$/m).map((document) => Bun.YAML.parse(document) as any).filter(Boolean);
  const upgradeJobs = (objects: any[]) => objects.filter((item) => item.kind === 'Job' && item.metadata.name.startsWith('novu-upgrade-'));
  const disabledJobs = upgradeJobs(parse(render('charts/novu', [...enabled, '--set', 'upgrade.centralize.approved=false', '--set', 'upgrade.report.enabled=false'])));
  assert.equal(disabledJobs.length, 8);
  assert.ok(disabledJobs.every((job) => !['novu-upgrade-centralize', 'novu-upgrade-report'].includes(job.metadata.name)));
  const both = [...enabled, '--set', 'upgrade.centralize.approved=true', '--set', 'upgrade.report.enabled=true', '--set-string', 'global.imagePullSecrets[0]=registry-pull'];
  const objects = parse(render('charts/novu', both));
  const jobs = objects.filter((item) => item.kind === 'Job' && item.metadata.name.startsWith('novu-upgrade-'));
  assert.equal(jobs.length, 10);
  const expected = [['quiesce', 'PreSync', '-60'], ['backup', 'PreSync', '-50'], ['verify', 'PreSync', '-40'], ['centralize', 'PreSync', '-35'], ['precheck', 'PreSync', '-30'], ['migrate', 'PreSync', '-20'], ['reconcile-indexes', 'PreSync', '-10'], ['smoke', 'PostSync', '10'], ['failure', 'SyncFail', '0']];
  for (const [step, phase, wave] of expected) {
    const job = jobs.find((item) => item.metadata.name === `novu-upgrade-${step}`);
    assert.ok(job);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/hook'], phase);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/sync-wave'], wave);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/hook-delete-policy'], 'BeforeHookCreation');
    assert.equal(job.spec.backoffLimit, 0);
    assert.ok(job.spec.activeDeadlineSeconds >= 180);
    assert.equal(job.spec.ttlSecondsAfterFinished, undefined);
    const pod = job.spec.template;
    assert.equal(pod.spec.serviceAccountName, 'novu-upgrade');
    assert.deepEqual(pod.spec.imagePullSecrets, [{ name: 'registry-pull' }]);
    assert.equal(pod.spec.automountServiceAccountToken, true);
    assert.equal(pod.spec.restartPolicy, 'Never');
    for (const metadata of [job.metadata, pod.metadata]) {
      assert.equal(metadata.labels['tags.datadoghq.com/env'], 'staging');
      assert.equal(metadata.labels['tags.datadoghq.com/service'], 'novu-upgrade');
    }
    const container = pod.spec.containers[0];
    assert.deepEqual(container.args, [step]);
    assert.equal(container.env.find((item: any) => item.name === 'MODE').value, 'upgrade');
    assert.deepEqual(container.env.filter((item: any) => item.name === 'CENTRALIZE_APPROVED'), step === 'centralize' ? [{ name: 'CENTRALIZE_APPROVED', value: 'true' }] : []);
    assert.deepEqual(container.env.filter((item: any) => item.name.startsWith('SMOKE_')).map((item: any) => item.name), step === 'smoke' ? ['SMOKE_SUBSCRIBER_ID', 'SMOKE_APPLICATION_IDENTIFIER', 'SMOKE_API_KEY'] : []);
    assert.match(container.image, /@sha256:[a-f0-9]{64}$/);
    assert.ok(container.resources.requests.cpu && container.resources.requests.memory);
    assert.equal(container.env.find((item: any) => item.name === 'MONGO_AUTO_CREATE_INDEXES').value, 'false');
  }
  const report = jobs.find((item) => item.metadata.name === 'novu-upgrade-report');
  const precheck = jobs.find((item) => item.metadata.name === 'novu-upgrade-precheck');
  assert.ok(report);
  assert.equal(report.metadata.annotations, undefined);
  assert.equal(report.spec.ttlSecondsAfterFinished, 86400);
  assert.equal(report.spec.backoffLimit, 0);
  assert.equal(report.spec.activeDeadlineSeconds, precheck.spec.activeDeadlineSeconds);
  const reportPod = structuredClone(precheck.spec.template);
  reportPod.spec.containers[0].env.find((item: any) => item.name === 'MODE').value = 'report';
  assert.deepEqual(report.spec.template, reportPod);
  const reportOnly = upgradeJobs(parse(render('charts/novu', [...both, '--set', 'upgrade.enabled=false', '--set', 'global.env.mongodb.autoCreateIndexes=true', '--set-string', 'upgrade.smoke.subscriberId=', '--set-string', 'upgrade.smoke.applicationIdentifier=', '--set-string', 'upgrade.smoke.apiKeySecretName='])));
  assert.deepEqual(reportOnly, [report]);
  assert.equal(upgradeJobs(parse(render('charts/novu', [...both, '--set', 'upgrade.enabled=false', '--set', 'upgrade.report.enabled=false']))).length, 0);
  assert.equal(objects.filter((item) => ['ServiceAccount', 'Role', 'RoleBinding', 'ConfigMap'].includes(item.kind) && ['novu-upgrade', 'novu-upgrade-state'].includes(item.metadata.name)).length, 0);
  for (const extra of [['--set', 'upgrade.mode=restore'], ['--set', 'global.env.mongodb.autoCreateIndexes=true'], ['--set-string', 'upgrade.image=runner:latest']]) {
    assert.notEqual(spawnSync('helm', ['template', 'novu', 'charts/novu', '-n', 'novu', '-f', fixture, ...enabled, ...extra]).status, 0);
  }
  for (const [key, placeholder] of Object.entries({ subscriberId: 'SMOKE_SUBSCRIBER_ID', applicationIdentifier: 'SMOKE_APPLICATION_IDENTIFIER', apiKeySecretName: 'SMOKE_API_KEY_SECRET_NAME', apiKeySecretKey: 'SMOKE_API_KEY_SECRET_KEY' })) {
    const result = spawnSync('helm', ['template', 'novu', 'charts/novu', '-n', 'novu', '-f', fixture, ...enabled, '--set-string', `upgrade.smoke.${key}=${placeholder}`], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`upgrade.smoke.${key} requires a resolved smoke input`));
  }
  const restoreBlocks = [...readFileSync('docs/R1-RESTORE.md', 'utf8').matchAll(/^```yaml\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  for (const path of ['docs/R1-RESTORE.md', 'docs/UPGRADE-3.19-RUNBOOK.md']) {
    for (const [, block] of readFileSync(path, 'utf8').matchAll(/^```yaml\n([\s\S]*?)^```/gm)) {
      for (const document of block.split(/^---\s*$/m)) assert.ok(Bun.YAML.parse(document));
    }
  }
  const restoreYaml = restoreBlocks.at(-1)!.replaceAll('REPLACE_VERIFIED_GENERATION', '1730995200123456');
  const restoreJobs = restoreYaml.split(/^---\s*$/m).map((document) => Bun.YAML.parse(document) as any);
  assert.equal(restoreJobs.length, 4);
  for (const job of restoreJobs) {
    assert.equal(job.kind, 'Job');
    for (const env of job.spec.template.spec.containers[0].env) {
      if ('value' in env) assert.equal(typeof env.value, 'string', env.name);
    }
    assert.equal(job.spec.template.spec.containers[0].env.find((env: any) => env.name === 'BACKUP_GENERATION').value, '1730995200123456');
  }
  const restoreExpected = [['quiesce', 'PreSync', '-60'], ['restore', 'PreSync', '-50'], ['smoke', 'PostSync', '10'], ['failure', 'SyncFail', '0']];
  const restoreEnv = restoreJobs[0].spec.template.spec.containers[0].env;
  for (const [step, phase, wave] of restoreExpected) {
    const job = restoreJobs.find((item) => item.metadata.name === `novu-upgrade-r1-${step}`);
    assert.ok(job);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/hook'], phase);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/sync-wave'], wave);
    assert.equal(job.metadata.annotations['argocd.argoproj.io/hook-delete-policy'], 'BeforeHookCreation');
    const pod = job.spec.template.spec;
    const container = pod.containers[0];
    assert.deepEqual(container.args, [step]);
    assert.equal(container.env.find((env: any) => env.name === 'MODE').value, 'restore');
    assert.deepEqual(container.env.filter((env: any) => !env.name.startsWith('SMOKE_')), restoreEnv);
    assert.equal(pod.volumes.some((volume: any) => volume.persistentVolumeClaim), step === 'restore');
    assert.deepEqual(container.env.filter((env: any) => env.name.startsWith('SMOKE_')), step === 'smoke' ? [
      { name: 'SMOKE_SUBSCRIBER_ID', value: 'REPLACE_EXISTING_SMOKE_SUBSCRIBER_ID' },
      { name: 'SMOKE_APPLICATION_IDENTIFIER', value: 'REPLACE_SMOKE_APPLICATION_IDENTIFIER' },
      { name: 'SMOKE_API_KEY', valueFrom: { secretKeyRef: { name: 'novu-upgrade-smoke', key: 'api-key' } } },
    ] : []);
  }
  console.log('PASS: disabled render equals #5; centralize/report opt-ins and standalone report; enabled hooks, waves, identity, labels, deadlines and unsafe-input guards; R1 restore/validation/failure hooks and both docs YAML');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
