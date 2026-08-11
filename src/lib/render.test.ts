import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sanitize, toJson, toMarkdown } from './render.ts';
import type { ReviewFinding } from '../types/review.ts';

test('sanitize strips terminal control characters but keeps newlines and tabs', () => {
  assert.equal(sanitize('a\u001bb\u0000c\nd\te\u0007f'), 'abc\nd\tef');
});

test('toMarkdown renders an empty array as a clean-review message', () => {
  assert.equal(toMarkdown([]), 'No findings — the diff looks clean.');
});

test('toMarkdown renders severity counts and line-anchored headings', () => {
  const md = toMarkdown([
    { file: 'src/a.ts', line: 42, severity: 'high', title: 'Null deref', body: 'Guard it.' },
  ]);
  assert.match(md, /## Code review — 1 finding\(s\) \(1 high, 0 medium, 0 low\)/);
  assert.match(md, /\*\*🔴 High — Null deref\*\* — `src\/a\.ts:42`/);
  assert.match(md, /Guard it\./);
});

test('toMarkdown renders file-level findings without a line anchor', () => {
  const md = toMarkdown([
    { file: 'b.ts', severity: 'low', title: 'Style', body: 'x' },
  ]);
  assert.match(md, /\*\*🟡 Low — Style\*\* — `b\.ts`/);
});

test('toMarkdown counts severities across findings', () => {
  const md = toMarkdown([
    { file: 'a.ts', line: 1, severity: 'high', title: 'H', body: 'x' },
    { file: 'a.ts', line: 2, severity: 'medium', title: 'M', body: 'x' },
    { file: 'a.ts', line: 3, severity: 'low', title: 'L', body: 'x' },
  ]);
  assert.match(md, /3 finding\(s\) \(1 high, 1 medium, 1 low\)/);
});

test('toMarkdown sanitizes model-produced control characters', () => {
  const md = toMarkdown([
    { file: 'a.ts', severity: 'high', title: 'T\u001b', body: 'B\u0007' },
  ]);
  assert.ok(!md.includes('\u001b'));
  assert.ok(!md.includes('\u0007'));
});

test('toJson emits GitHub-shaped comments and a summary', () => {
  const { summary, comments } = toJson([
    { file: 'a.ts', line: 3, severity: 'high', title: 'T', body: 'B' },
    { file: 'b.ts', severity: 'low', title: 'File-level', body: 'Missing tests' },
  ]);
  assert.equal(comments.length, 1); // file-level findings go to the summary only
  assert.deepEqual(comments[0], {
    body: '**🔴 High: T**\nB',
    path: 'a.ts',
    line: 3,
  });
  assert.match(summary, /2 finding\(s\)/);
});

test('toJson sanitizes paths and bodies before they reach GitHub', () => {
  const { comments } = toJson([
    { file: 'a\u0007.ts`\n', line: 1, severity: 'medium', title: 'T\u001b', body: 'B\u0000' },
  ]);
  assert.equal(comments[0].path, 'a.ts');
  assert.equal(comments[0].body, '**🟠 Medium: T**\nB');
});

test('toMarkdown renders with a custom template', () => {
  const templates = {
    summary: '{{count}} total ({{high}}h/{{medium}}m/{{low}}l):\n{{findings}}',
    finding: '- [{{severity}}] {{title}} at {{anchor}}',
    comment: '{{severity_label}} | {{title}}',
  };
  const findings: ReviewFinding[] = [
    { file: 'a.ts', line: 3, severity: 'high', title: 'T', body: 'B' },
    { file: 'b.ts', severity: 'low', title: 'S', body: 'X' },
  ];
  assert.equal(
    toMarkdown(findings, templates),
    '2 total (1h/0m/1l):\n- [high] T at `a.ts:3`\n\n- [low] S at `b.ts`',
  );
});

test('toJson renders comments with a custom template', () => {
  const templates = {
    summary: '{{count}}',
    finding: '',
    comment: '{{severity_label}}|{{file}}:{{line}}',
  };
  const { summary, comments } = toJson(
    [{ file: 'a.ts', line: 3, severity: 'high', title: 'T', body: 'B' }],
    templates,
  );
  assert.equal(summary, '1');
  assert.equal(comments[0].body, '🔴 High|a.ts:3');
});
