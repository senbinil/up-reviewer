import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Refs are passed as argv to `git`, never through a shell. The pattern still
 * blocks option smuggling: a ref must start with an alphanumeric, so it can
 * never be mistaken for a `-`-prefixed git option.
 */
const GIT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Upper bound on the diff text fed to the model, to keep prompts bounded. */
export const MAX_DIFF_CHARS = 100_000;

export function assertGitRef(ref: string, label: string): void {
  if (!GIT_REF_PATTERN.test(ref)) {
    throw new Error(
      `Invalid git ref for ${label}: "${ref}". ` +
        "Use a branch name, tag, commit SHA, or HEAD.",
    );
  }
}

export interface GitDiffResult {
  stat: string;
  diff: string;
}

/**
 * Runs `git diff <base> [<head>]` and returns the raw unified diff plus the
 * one-line stat summary. No diff parsing happens here — the raw text goes
 * straight to the model. With no head, git compares base against the working
 * tree.
 *
 * @param cwd Directory to run git in; defaults to the process cwd. Exposed so
 *   tests can run against throwaway repositories.
 */
export async function diffBetweenRefs(
  base: string,
  head?: string,
  cwd?: string,
): Promise<GitDiffResult> {
  assertGitRef(base, "base");
  if (head !== undefined && head !== "") assertGitRef(head, "head");

  // Order matters: git diff base head shows the changes that turn base into
  // head.
  const range = head && head !== "" ? [base, head] : [base];

  const statResult = await execFileAsync(
    "git",
    ["diff", "--no-color", "--stat", ...range],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, cwd },
  );

  const diffResult = await execFileAsync(
    "git",
    ["diff", "--no-color", "-U3", ...range],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, cwd },
  );

  let diff = diffResult.stdout;
  if (diff.length > MAX_DIFF_CHARS) {
    throw new Error(
      `The diff between ${base}${head ? ` ${head}` : ""} is ${diff.length} ` +
        `characters, which exceeds the ${MAX_DIFF_CHARS}-character limit. ` +
        "Review the change in smaller chunks.",
    );
  }

  return { stat: statResult.stdout.trim(), diff };
}
