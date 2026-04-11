import type { GitCiCheck, GitCiSummary, GitStatusResult } from "@t3tools/contracts";

const GIT_CI_BUCKET_PRIORITY: Record<GitCiCheck["bucket"], number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  skipping: 3,
  cancel: 4,
};

export function sortGitCiChecks(checks: ReadonlyArray<GitCiCheck>): ReadonlyArray<GitCiCheck> {
  return checks.toSorted(
    (left, right) => GIT_CI_BUCKET_PRIORITY[left.bucket] - GIT_CI_BUCKET_PRIORITY[right.bucket],
  );
}

export function resolveThreadGitCi(
  threadBranch: string | null,
  gitStatus: GitStatusResult | null,
): GitCiSummary | null {
  if (threadBranch === null || gitStatus === null || gitStatus.branch !== threadBranch) {
    return null;
  }

  return gitStatus.ci ?? null;
}

export function formatGitCiSourceLabel(summary: GitCiSummary): string {
  return summary.source === "pull_request" ? "PR checks" : "Branch checks";
}

export function formatGitCiCountsSummary(summary: GitCiSummary): string {
  const parts: string[] = [];
  if (summary.counts.fail > 0) {
    parts.push(`${summary.counts.fail} failed`);
  }
  if (summary.counts.pending > 0) {
    parts.push(`${summary.counts.pending} pending`);
  }
  if (summary.counts.pass > 0) {
    parts.push(`${summary.counts.pass} passed`);
  }
  if (summary.counts.skipping > 0) {
    parts.push(`${summary.counts.skipping} skipped`);
  }
  if (summary.counts.cancel > 0) {
    parts.push(`${summary.counts.cancel} cancelled`);
  }

  return parts.length > 0 ? parts.join(", ") : "No checks reported yet";
}

export function formatGitCiSidebarTooltip(summary: GitCiSummary): string {
  let label = "CI complete";
  if (summary.overallState === "failure") {
    label = "CI failed";
  } else if (summary.overallState === "pending") {
    label = "CI pending";
  } else if (summary.overallState === "success") {
    label = "CI passed";
  }

  return `${label}: ${formatGitCiCountsSummary(summary)}`;
}

export function getRelevantGitCiChecks(
  summary: GitCiSummary,
  limit = 3,
): ReadonlyArray<GitCiCheck> {
  return sortGitCiChecks(summary.checks).slice(0, limit);
}
