import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const objects = render('charts/novu', enabled).split(/^---\s*$/m).map((document) => Bun.YAML.parse(document) as any).filter(Boolean);
  const jobs = objects.filter((item) => item.kind === 'Job' && item.metadata.name.startsWith('novu-upgrade-'));
  assert.equal(jobs.length, 8);
  const expected = [['quiesce', 'PreSync', '-60'], ['backup', 'PreSync', '-50'], ['verify', 'PreSync', '-40'], ['precheck', 'PreSync', '-30'], ['migrate', 'PreSync', '-20'], ['reconcile-indexes', 'PreSync', '-10'], ['smoke', 'PostSync', '10'], ['failure', 'SyncFail', '0']];
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
    assert.equal(pod.spec.automountServiceAccountToken, true);
    assert.equal(pod.spec.restartPolicy, 'Never');
    for (const metadata of [job.metadata, pod.metadata]) {
      assert.equal(metadata.labels['tags.datadoghq.com/env'], 'staging');
      assert.equal(metadata.labels['tags.datadoghq.com/service'], 'novu-upgrade');
    }
    const container = pod.spec.containers[0];
    assert.deepEqual(container.args, [step]);
    assert.match(container.image, /@sha256:[a-f0-9]{64}$/);
    assert.ok(container.resources.requests.cpu && container.resources.requests.memory);
    assert.equal(container.env.find((item: any) => item.name === 'MONGO_AUTO_CREATE_INDEXES').value, 'false');
  }
  assert.equal(objects.filter((item) => ['ServiceAccount', 'Role', 'RoleBinding', 'ConfigMap'].includes(item.kind) && ['novu-upgrade', 'novu-upgrade-state'].includes(item.metadata.name)).length, 0);
  for (const extra of [['--set', 'upgrade.mode=restore'], ['--set', 'global.env.mongodb.autoCreateIndexes=true'], ['--set-string', 'upgrade.image=runner:latest']]) {
    assert.notEqual(spawnSync('helm', ['template', 'novu', 'charts/novu', '-n', 'novu', '-f', fixture, ...enabled, ...extra]).status, 0);
  }
  console.log('PASS: disabled render equals #5; enabled hooks, waves, identity, labels, deadlines and unsafe-input guards');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
