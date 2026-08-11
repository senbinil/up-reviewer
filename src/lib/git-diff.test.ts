import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { assertGitRef, diffBetweenRefs } from './git-diff.ts';

const execFileAsync = promisify(execFile);

// Author/committer identity for throwaway repos (no user config needed).
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Test Runner',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test Runner',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'flue-git-test-'));
  await execFileAsync('git', ['init'], { cwd: dir });
  return dir;
}

async function commitAll(dir: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', message], {
    cwd: dir,
    env: { ...process.env, ...GIT_ENV },
  });
}

async function currentSha(dir: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

test('assertGitRef accepts valid refs', () => {
  for (const ref of [
    'HEAD',
    'main',
    'feature/x',
    'feature/review-test',
    'v1.2.3',
    'abc1234',
    'refs/heads/main',
    'a/b_c.d-e',
  ]) {
    assert.doesNotThrow(() => assertGitRef(ref, 'test'), `should accept "${ref}"`);
  }
});

test('assertGitRef rejects refs that could smuggle options or shell input', () => {
  for (const ref of [
    '',           // empty
    '-U3',        // option smuggling
    '-n',
    'main extra', // space
    'main;rm -rf /',
    '$(id)',
    '`id`',
    '..',
    './x',
    'HEAD~1', // '~' is not allowed by the pattern
    'abc^',
    '_leading-underscore',
  ]) {
    assert.throws(
      () => assertGitRef(ref, 'test'),
      /Invalid git ref/,
      `should reject "${ref}"`,
    );
  }
});

test('diffBetweenRefs returns the diff and stat between two commits', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');
    await commitAll(dir, 'initial');
    const base = await currentSha(dir);

    await writeFile(join(dir, 'a.txt'), 'one\ntwo changed\nthree\n', 'utf8');
    await commitAll(dir, 'change');
    const head = await currentSha(dir);

    const { stat, diff } = await diffBetweenRefs(base, head, dir);
    assert.match(stat, /1 file changed/);
    assert.match(diff, /a\.txt/);
    assert.match(diff, /-two\b/);
    assert.match(diff, /\+two changed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs includes uncommitted working-tree changes when head is omitted', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'initial');

    await writeFile(join(dir, 'a.txt'), 'one\nedited\n', 'utf8');
    const { diff } = await diffBetweenRefs('HEAD', undefined, dir);
    assert.match(diff, /\+edited/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs returns an empty diff for identical refs', async () => {
  const dir = await makeRepo();
  try {
    await writeFile(join(dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(dir, 'initial');
    const sha = await currentSha(dir);
    const { diff } = await diffBetweenRefs(sha, sha, dir);
    assert.equal(diff.trim(), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs rejects a diff larger than the 100 KB cap', async () => {
  const dir = await makeRepo();
  try {
    const line = (i: number) =>
      `console.log("value number ${String(i).padStart(5, '0')} with a padded tail here");`;
    const before = Array.from({ length: 3000 }, (_, i) => line(i)).join('\n') + '\n';
    const after = Array.from({ length: 3000 }, (_, i) => line(i) + ' // changed').join('\n') + '\n';

    await writeFile(join(dir, 'big.js'), before, 'utf8');
    await commitAll(dir, 'initial');
    const base = await currentSha(dir);

    await writeFile(join(dir, 'big.js'), after, 'utf8');
    await commitAll(dir, 'big change');
    const head = await currentSha(dir);

    await assert.rejects(diffBetweenRefs(base, head, dir), /exceeds the .*character limit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs rejects an invalid base ref', async () => {
  const dir = await makeRepo();
  try {
    await assert.rejects(diffBetweenRefs('-n', undefined, dir), /Invalid git ref/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
