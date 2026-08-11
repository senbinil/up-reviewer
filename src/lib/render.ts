// Shared rendering for review findings: markdown for humans, and the
// GitHub review-comments payload shape. Used by the local CLI workflow and by
// the agent's `post_review` tool so both produce identical output.
import type { ReviewFinding } from '../types/review.ts';

const SEVERITY_HEADING: Record<ReviewFinding['severity'], string> = {
  high: '🔴 High',
  medium: '🟠 Medium',
  low: '🟡 Low',
};

// Strip terminal control characters from model-produced text before printing:
// a crafted diff could steer the model into echoing ANSI/OSC escape sequences
// into a finding, which the terminal would then interpret. Keep \n and \t
// (multi-line finding bodies must survive); strip CR and everything else.
export function sanitize(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
}

function countBySeverity(findings: ReviewFinding[]): Record<ReviewFinding['severity'], number> {
  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const f of findings) bySeverity[f.severity]++;
  return bySeverity;
}

// Strips terminal control characters, but unlike `sanitize` also removes
// newlines, tabs, and backticks — for contexts where multi-line text or
// markdown code markers are never valid (file paths, anchors).
function sanitizePath(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F-\u009F`]/g, '');
}

function findingAnchor(f: ReviewFinding): string {
  const file = sanitizePath(f.file);
  return f.line !== undefined ? `\`${file}:${f.line}\`` : `\`${file}\``;
}

/** GitHub-flavored markdown, paste-able into a PR comment. */
export function toMarkdown(findings: ReviewFinding[]): string {
  if (findings.length === 0) return 'No findings — the diff looks clean.';
  const bySeverity = countBySeverity(findings);
  const lines = [
    `## Code review — ${findings.length} finding(s) ` +
      `(${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low)`,
  ];
  for (const f of findings) {
    lines.push('');
    lines.push(
      `### ${SEVERITY_HEADING[f.severity]} — ${sanitize(f.title)} — ${findingAnchor(f)}`,
    );
    lines.push('');
    lines.push(sanitize(f.body));
  }
  return lines.join('\n');
}

export interface GitHubComment {
  body: string;
  path: string;
  line: number;
}

/** { summary, comments } shaped for GitHub PR commenting / scripting. */
export function toJson(findings: ReviewFinding[]): {
  summary: string;
  comments: GitHubComment[];
} {
  const comments: GitHubComment[] = [];
  for (const f of findings) {
    if (f.line === undefined) continue; // file-level findings go in the summary
    comments.push({
      body:
        `**${SEVERITY_HEADING[f.severity]}: ${sanitize(f.title)}**\n\n` +
        sanitize(f.body),
      // Sanitize the path with the strict variant (no newlines/tabs/backticks):
      // a control character in a model-produced file path would 422 the whole
      // review from the API side.
      path: sanitizePath(f.file),
      line: f.line,
    });
  }
  return { summary: toMarkdown(findings), comments };
}
