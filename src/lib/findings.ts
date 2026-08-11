import * as v from "valibot";

import type { ReviewFinding } from "../types/review.ts";

export const findingsSchema = v.array(
  v.object({
    file: v.string(),
    line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    severity: v.picklist(["high", "medium", "low"]),
    title: v.string(),
    body: v.string(),
  }),
);

export type Findings = ReviewFinding[];

/**
 * Extracts and validates the findings array from the model's reply text.
 * Returns undefined when the reply contains no parseable findings array.
 */
export function parseFindings(text: string): Findings | undefined {
  const trimmed = text.trim();
  try {
    return v.parse(findingsSchema, JSON.parse(trimmed));
  } catch {
    // tolerate prose or markdown fences: scan for the first balanced [ ... ]
    const start = trimmed.indexOf("[");
    if (start === -1) return undefined;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            return v.parse(
              findingsSchema,
              JSON.parse(trimmed.slice(start, i + 1)),
            );
          } catch {
            return undefined;
          }
        }
      }
    }
    return undefined;
  }
}

