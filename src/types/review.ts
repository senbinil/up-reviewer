export type ReviewSeverity = "high" | "medium" | "low";

export interface ReviewFinding {
  /** Path of the file in the head (newer) revision. */
  file: string;
  /**
   * 1-based line number in the head revision of the file.
   * Omitted for file-level findings (e.g. "missing tests").
   */
  line?: number;
  severity: ReviewSeverity;
  title: string;
  body: string;
}
