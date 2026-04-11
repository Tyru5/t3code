import { describe, expect, it } from "vitest";

import {
  formatGitCiCountsSummary,
  formatGitCiSidebarTooltip,
  formatGitCiSourceLabel,
  getRelevantGitCiChecks,
  resolveThreadGitCi,
  sortGitCiChecks,
} from "./gitCi";

const ciSummary = {
  provider: "github" as const,
  source: "pull_request" as const,
  branch: "feature/demo",
  headSha: "abcdef1234567890",
  overallState: "failure" as const,
  targetUrl: "https://github.com/octocat/example/pull/42",
  counts: {
    total: 5,
    pass: 2,
    fail: 1,
    pending: 1,
    skipping: 1,
    cancel: 0,
  },
  checks: [
    {
      name: "pass",
      workflow: "CI",
      state: "SUCCESS",
      bucket: "pass" as const,
      description: null,
      event: "pull_request",
      startedAt: null,
      completedAt: null,
      link: null,
    },
    {
      name: "fail",
      workflow: "CI",
      state: "FAILURE",
      bucket: "fail" as const,
      description: "1 failing test",
      event: "pull_request",
      startedAt: null,
      completedAt: null,
      link: null,
    },
    {
      name: "pending",
      workflow: "CI",
      state: "IN_PROGRESS",
      bucket: "pending" as const,
      description: "Running",
      event: "pull_request",
      startedAt: null,
      completedAt: null,
      link: null,
    },
  ],
  updatedAt: "2026-04-09T12:00:00.000Z",
};

describe("gitCi helpers", () => {
  it("only returns CI when git status matches the thread branch", () => {
    expect(
      resolveThreadGitCi("feature/demo", {
        isRepo: true,
        hasOriginRemote: true,
        isDefaultBranch: false,
        branch: "feature/demo",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
        ci: ciSummary,
      }),
    ).toEqual(ciSummary);

    expect(
      resolveThreadGitCi("feature/other", {
        isRepo: true,
        hasOriginRemote: true,
        isDefaultBranch: false,
        branch: "feature/demo",
        hasWorkingTreeChanges: false,
        workingTree: { files: [], insertions: 0, deletions: 0 },
        hasUpstream: true,
        aheadCount: 0,
        behindCount: 0,
        pr: null,
        ci: ciSummary,
      }),
    ).toBeNull();
  });

  it("formats shared CI labels", () => {
    expect(formatGitCiSourceLabel(ciSummary)).toBe("PR checks");
    expect(formatGitCiCountsSummary(ciSummary)).toBe("1 failed, 1 pending, 2 passed, 1 skipped");
    expect(formatGitCiSidebarTooltip(ciSummary)).toBe(
      "CI failed: 1 failed, 1 pending, 2 passed, 1 skipped",
    );
  });

  it("prioritizes failing and pending checks in the relevant check list", () => {
    expect(getRelevantGitCiChecks(ciSummary).map((check) => check.name)).toEqual([
      "fail",
      "pending",
      "pass",
    ]);
  });

  it("sorts the full check list using the same priority order", () => {
    expect(sortGitCiChecks(ciSummary.checks).map((check) => check.name)).toEqual([
      "fail",
      "pending",
      "pass",
    ]);
  });
});
