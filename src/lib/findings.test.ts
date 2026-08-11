import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFindings } from './findings.ts';

const valid = [
  { file: 'a.ts', line: 3, severity: 'high', title: 'T', body: 'B' },
  { file: 'b.ts', severity: 'low', title: 'T2', body: 'B2' },
];

test('parses a bare JSON array', () => {
  assert.deepEqual(parseFindings(JSON.stringify(valid)), valid);
});

test('parses JSON inside a markdown fence', () => {
  const text = 'Here you go:\n```json\n' + JSON.stringify(valid) + '\n```';
  assert.deepEqual(parseFindings(text), valid);
});

test('parses an array embedded in prose', () => {
  const text = 'Findings: ' + JSON.stringify(valid) + ' — end of review.';
  assert.deepEqual(parseFindings(text), valid);
});

test('handles an empty findings array', () => {
  assert.deepEqual(parseFindings('[]'), []);
  assert.deepEqual(parseFindings('No issues. { "findings": [] }'), []);
  assert.deepEqual(parseFindings('{"findings":[]}'), []);
});

test('tolerates brackets and escaped quotes inside string values', () => {
  const findings = [
    { file: 'a.ts', severity: 'high', title: 'List [x, y]', body: 'see [a] and "b]"' },
  ];
  assert.deepEqual(parseFindings(JSON.stringify(findings)), findings);
});

test('returns undefined when no array is present', () => {
  assert.equal(parseFindings('The diff looks clean.'), undefined);
  assert.equal(parseFindings(''), undefined);
  assert.equal(parseFindings('{ "findings": "none" }'), undefined);
  assert.equal(parseFindings('not json at all'), undefined);
});

test('rejects structurally invalid findings', () => {
  const cases = [
    // line 0 and non-integer lines violate the schema
    JSON.stringify([{ file: 'a.ts', line: 0, severity: 'high', title: 'T', body: 'B' }]),
    JSON.stringify([{ file: 'a.ts', line: 1.5, severity: 'high', title: 'T', body: 'B' }]),
    // unknown severity
    JSON.stringify([{ file: 'a.ts', severity: 'critical', title: 'T', body: 'B' }]),
    // missing required fields
    JSON.stringify([{ severity: 'high', title: 'T', body: 'B' }]),
    JSON.stringify([{ file: 'a.ts', severity: 'high', title: 'T' }]),
    // not an array of objects
    JSON.stringify([1, 2, 3]),
    // title and body exceed their length caps (100 and 300 chars respectively)
    JSON.stringify([{ file: 'a.ts', severity: 'high', title: 'A'.repeat(101), body: 'B' }]),
    JSON.stringify([{ file: 'a.ts', severity: 'high', title: 'T', body: 'B'.repeat(301) }]),
  ];
  for (const text of cases) {
    assert.equal(parseFindings(text), undefined, `should reject: ${text}`);
  }
});

test('tolerates unknown keys and strips them from the parsed output', () => {
  const withExtra = [
    { file: 'a.ts', severity: 'high', title: 'T', body: 'B', extra: 'x' },
  ];
  assert.deepEqual(parseFindings(JSON.stringify(withExtra)), [
    { file: 'a.ts', severity: 'high', title: 'T', body: 'B' },
  ]);
});
