import type { ParsedDiff } from "../types/diff";

export function parseDiff(diff: string): ParsedDiff {
    const lines = diff.split("\n");
    let diffLines: string[] = [];
    let totalFiles = 0;
    const result: ParsedDiff = {
        files: [],
        totalFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
    };
    for (const line of lines)
        if (line.match(/^diff --git/g)) diffLines.push(line);
    for (const stat of diffLines) {
        const diffInParts = stat.split(" ");
        if (diffInParts[-1] == diffInParts[-2]) {
            result.files.push(diffInParts[-1])
        }
    }
    return result;
}
