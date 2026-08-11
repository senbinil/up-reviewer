import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { assertGitRef, diffBetweenRefs } from './git-diff.ts';

const execFileAsync = promisify(execFile);

// Throwaway git repositories, hermetic against the ambient machine: the
// developer's global/system git config (GIT_CONFIG_GLOBAL/SYSTEM), commit
// signing (commit.gpgSign), hooks (core.hooksPath), and the default branch
// name (init.defaultBranch) must never leak in, or results become
// machine-dependent. GIT_CONFIG_* point at an empty file, signing is forced
// off, hooks go to a nonexistent path (git skips hooks it cannot find), and
// the branch is pinned to `main` via symbolic-ref — that works on every git
// version, whereas init.defaultBranch only exists on git >= 2.28.
interface TestRepo {
  dir: string;
  git: (args: string[]) => Promise<string>;
}

async function makeRepo(): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'flue-git-test-'));
  const emptyConfig = join(dir, 'empty-gitconfig');
  await writeFile(emptyConfig, '', 'utf8');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_AUTHOR_NAME: 'Test Runner',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test Runner',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const git = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync(
      'git',
      [
        '-c', 'commit.gpgSign=false',
        '-c', 'tag.gpgSign=false',
        '-c', `core.hooksPath=${join(dir, 'no-hooks')}`,
        ...args,
      ],
      { cwd: dir, env },
    );
    return stdout;
  };
  await git(['init']);
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { dir, git };
}

async function commitAll(repo: TestRepo, message: string): Promise<void> {
  await repo.git(['add', '-A']);
  await repo.git(['commit', '-m', message]);
}

async function currentSha(repo: TestRepo): Promise<string> {
  return (await repo.git(['rev-parse', 'HEAD'])).trim();
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
  const repo = await makeRepo();
  try {
    await writeFile(join(repo.dir, 'a.txt'), 'one\ntwo\nthree\n', 'utf8');
    await commitAll(repo, 'initial');
    const base = await currentSha(repo);

    await writeFile(join(repo.dir, 'a.txt'), 'one\ntwo changed\nthree\n', 'utf8');
    await commitAll(repo, 'change');
    const head = await currentSha(repo);

    const { stat, diff } = await diffBetweenRefs(base, head, repo.dir);
    assert.match(stat, /1 file changed/);
    assert.match(diff, /a\.txt/);
    assert.match(diff, /-two\b/);
    assert.match(diff, /\+two changed/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs includes uncommitted working-tree changes when head is omitted', async () => {
  const repo = await makeRepo();
  try {
    await writeFile(join(repo.dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(repo, 'initial');

    await writeFile(join(repo.dir, 'a.txt'), 'one\nedited\n', 'utf8');
    const { diff } = await diffBetweenRefs('HEAD', undefined, repo.dir);
    assert.match(diff, /\+edited/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs returns an empty diff for identical refs', async () => {
  const repo = await makeRepo();
  try {
    await writeFile(join(repo.dir, 'a.txt'), 'one\n', 'utf8');
    await commitAll(repo, 'initial');
    const sha = await currentSha(repo);
    const { diff } = await diffBetweenRefs(sha, sha, repo.dir);
    assert.equal(diff.trim(), '');
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs rejects a diff larger than the 100 KB cap', async () => {
  const repo = await makeRepo();
  try {
    const line = (i: number) =>
      `console.log("value number ${String(i).padStart(5, '0')} with a padded tail here");`;
    const before = Array.from({ length: 3000 }, (_, i) => line(i)).join('\n') + '\n';
    const after = Array.from({ length: 3000 }, (_, i) => line(i) + ' // changed').join('\n') + '\n';

    await writeFile(join(repo.dir, 'big.js'), before, 'utf8');
    await commitAll(repo, 'initial');
    const base = await currentSha(repo);

    await writeFile(join(repo.dir, 'big.js'), after, 'utf8');
    await commitAll(repo, 'big change');
    const head = await currentSha(repo);

    await assert.rejects(diffBetweenRefs(base, head, repo.dir), /exceeds the .*character limit/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});

test('diffBetweenRefs rejects an invalid base ref', async () => {
  const repo = await makeRepo();
  try {
    await assert.rejects(diffBetweenRefs('-n', undefined, repo.dir), /Invalid git ref/);
  } finally {
    await rm(repo.dir, { recursive: true, force: true });
  }
});
