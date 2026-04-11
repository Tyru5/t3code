import { Effect, Layer, Result, Schema, SchemaIssue } from "effect";
import { type GitCiCheck, TrimmedNonEmptyString } from "@t3tools/contracts";

import { runProcess } from "../../processRunner";
import { GitHubCliError } from "@t3tools/contracts";
import {
  GitHubCli,
  type GitHubRepositoryCloneUrls,
  type GitHubCliShape,
} from "../Services/GitHubCli.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
  formatGitHubJsonDecodeError,
} from "../githubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeGitHubCliError(operation: "execute" | "stdout", error: unknown): GitHubCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: gh")) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI (`gh`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("authentication failed") ||
      lower.includes("not logged in") ||
      lower.includes("gh auth login") ||
      lower.includes("no oauth token")
    ) {
      return new GitHubCliError({
        operation,
        detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
        cause: error,
      });
    }

    if (
      lower.includes("could not resolve to a pullrequest") ||
      lower.includes("repository.pullrequest") ||
      lower.includes("no pull requests found for branch") ||
      lower.includes("pull request not found")
    ) {
      return new GitHubCliError({
        operation,
        detail: "Pull request not found. Check the PR number or URL and try again.",
        cause: error,
      });
    }

    return new GitHubCliError({
      operation,
      detail: `GitHub CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: "GitHub CLI command failed.",
    cause: error,
  });
}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listOpenPullRequests"
    | "getPullRequest"
    | "getRepositoryCloneUrls"
    | "listBranchWorkflowRuns"
    | "listPullRequestChecks",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

const RawGitHubWorkflowRunSchema = Schema.Struct({
  name: Schema.optional(Schema.NullOr(Schema.String)),
  displayTitle: Schema.optional(Schema.NullOr(Schema.String)),
  workflowName: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  conclusion: Schema.optional(Schema.NullOr(Schema.String)),
  event: Schema.optional(Schema.NullOr(Schema.String)),
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawGitHubPrCheckSchema = Schema.Struct({
  bucket: Schema.String,
  completedAt: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  event: Schema.optional(Schema.NullOr(Schema.String)),
  link: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  startedAt: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.String,
  workflow: Schema.optional(Schema.NullOr(Schema.String)),
});

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkflowRunBucket(input: {
  status?: string | null | undefined;
  conclusion?: string | null | undefined;
}): GitCiCheck["bucket"] {
  const status = normalizeOptionalText(input.status)?.toLowerCase();
  if (status !== "completed") {
    return "pending";
  }

  const conclusion = normalizeOptionalText(input.conclusion)?.toLowerCase();
  if (!conclusion) {
    return "skipping";
  }

  if (conclusion === "success") {
    return "pass";
  }
  if (conclusion === "cancelled" || conclusion === "canceled") {
    return "cancel";
  }
  if (conclusion === "neutral" || conclusion === "skipped") {
    return "skipping";
  }
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure" ||
    conclusion === "action_required"
  ) {
    return "fail";
  }

  return "skipping";
}

function normalizePrCheckBucket(bucket: string): GitCiCheck["bucket"] {
  const normalized = bucket.trim().toLowerCase();
  if (
    normalized === "pass" ||
    normalized === "fail" ||
    normalized === "pending" ||
    normalized === "skipping" ||
    normalized === "cancel"
  ) {
    return normalized;
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancel";
  }
  return "pending";
}

function normalizeWorkflowRun(
  raw: Schema.Schema.Type<typeof RawGitHubWorkflowRunSchema>,
): GitCiCheck {
  const workflow = normalizeOptionalText(raw.workflowName) ?? normalizeOptionalText(raw.name);
  const name =
    normalizeOptionalText(raw.name) ??
    workflow ??
    normalizeOptionalText(raw.displayTitle) ??
    "Workflow run";
  const status = normalizeOptionalText(raw.status);
  const conclusion = normalizeOptionalText(raw.conclusion);
  const normalizedState = [status, conclusion].filter((value) => value !== null).join(" / ");

  return {
    name,
    workflow,
    state: normalizedState.length > 0 ? normalizedState : "unknown",
    bucket: normalizeWorkflowRunBucket(raw),
    description: normalizeOptionalText(raw.displayTitle),
    event: normalizeOptionalText(raw.event),
    startedAt: normalizeOptionalText(raw.startedAt),
    completedAt: normalizeOptionalText(raw.updatedAt),
    link: normalizeOptionalText(raw.url),
  };
}

function normalizePrCheck(raw: Schema.Schema.Type<typeof RawGitHubPrCheckSchema>): GitCiCheck {
  return {
    name: raw.name,
    workflow: normalizeOptionalText(raw.workflow),
    state: raw.state,
    bucket: normalizePrCheckBucket(raw.bucket),
    description: normalizeOptionalText(raw.description),
    event: normalizeOptionalText(raw.event),
    startedAt: normalizeOptionalText(raw.startedAt),
    completedAt: normalizeOptionalText(raw.completedAt),
    link: normalizeOptionalText(raw.link),
  };
}

const makeGitHubCli = Effect.sync(() => {
  const execute: GitHubCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("gh", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeGitHubCliError("execute", error),
    });

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    mergePullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "merge", String(input.prNumber), "--squash", "--delete-branch"],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    listBranchWorkflowRuns: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "run",
          "list",
          "--branch",
          input.branch,
          "--commit",
          input.headSha,
          "--limit",
          String(input.limit ?? 10),
          "--json",
          "attempt,conclusion,createdAt,databaseId,displayTitle,event,headBranch,headSha,name,number,startedAt,status,updatedAt,url,workflowDatabaseId,workflowName",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            Schema.Array(RawGitHubWorkflowRunSchema),
            "listBranchWorkflowRuns",
            "GitHub CLI returned invalid workflow run JSON.",
          ),
        ),
        Effect.map((workflowRuns) => workflowRuns.map(normalizeWorkflowRun)),
      ),
    listPullRequestChecks: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "checks",
          input.reference,
          "--json",
          "bucket,completedAt,description,event,link,name,startedAt,state,workflow",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            Schema.Array(RawGitHubPrCheckSchema),
            "listPullRequestChecks",
            "GitHub CLI returned invalid PR checks JSON.",
          ),
        ),
        Effect.map((checks) => checks.map(normalizePrCheck)),
      ),
  } satisfies GitHubCliShape;

  return service;
});

export const GitHubCliLive = Layer.effect(GitHubCli, makeGitHubCli);
