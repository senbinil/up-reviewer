export interface ParsedFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface ParsedDiff {
  files: ParsedFile[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
}