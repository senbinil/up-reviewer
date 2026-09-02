#!/usr/bin/env node

// GitHub Actions mode: dispatches the Reviewer agent which fetches the PR diff
// via `gh pr diff` and posts a review via `gh api`.
//
// Usage:
//   npx review
//   env: GITHUB_ACTIONS=true, PR_NUMBER=123, GH_TOKEN=xxx, AGENT_API_KEY=xxx
//
// Required environment variables (set by the workflow):
//   GITHUB_ACTIONS=true
//   PR_NUMBER — the pull request number
//   GH_TOKEN — GitHub token for API access
//   AGENT_API_KEY — model provider API key

import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';

import { Reviewer } from '../agents/reviewer.ts';
import db from '../db.ts';

export async function runGithub(): Promise<void> {
  let flue: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const prNumber = process.env.PR_NUMBER;
    if (!prNumber) {
      throw new Error(
        'PR_NUMBER environment variable is required. ' +
        'Set it in your GitHub Actions workflow from github.event.pull_request.number.'
      );
    }

    flue = await start({ agents: [Reviewer], db });
    const handle = init(Reviewer);

    const message = [
      `Review pull request #${prNumber}.`,
      '',
      'Call `fetch_pr_diff` with the PR number to load the diff, then review it,',
      'then call `post_review` with your findings.',
    ].join('\n');

    const receipt = await handle.dispatch(message);
    const reply = await handle.read(receipt);

    if (reply.text) {
      console.error('Agent replied with text instead of calling post_review:');
      console.error(reply.text);
      process.exitCode = 1;
    }
  } finally {
    await flue?.stop();
  }
}
