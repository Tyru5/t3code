import { type ScopedThreadRef } from "@t3tools/contracts";
import type {
  GitActionProgressEvent,
  GitCiCheck,
  GitRunStackedActionResult,
  GitStackedAction,
  GitStatusResult,
} from "@t3tools/contracts";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Clock3Icon,
  CloudUploadIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";
import { GitHubIcon } from "./Icons";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  describeGitCiOutcome,
  formatGitCiCheckStatus,
  formatGitCiLabel,
  formatGitCiTooltipSummary,
  getGitCiCheckBadgeVariant,
  getGitCiCheckToneClassName,
  getGitCiToneClassName,
  type GitActionIconName,
  type GitActionMenuItem,
  type GitQuickAction,
  type DefaultBranchConfirmableAction,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveLiveThreadBranchUpdate,
  resolveQuickAction,
  resolveThreadBranchUpdate,
} from "./GitActionsControl.logic";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import { toastManager, type ThreadToastData } from "~/components/ui/toast";
import { openInPreferredEditor } from "~/editorPreferences";
import {
  gitInitMutationOptions,
  gitMergePullRequestMutationOptions,
  gitMutationKeys,
  gitPullMutationOptions,
  gitRunStackedActionMutationOptions,
} from "~/lib/gitReactQuery";
import {
  formatGitCiSourceLabel,
  getRelevantGitCiChecks,
  resolveThreadGitCi,
  sortGitCiChecks,
} from "~/lib/gitCi";
import { refreshGitStatus, useGitStatus } from "~/lib/gitStatusState";
import { cn, newCommandId, randomUUID } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { resolvePathLinkTarget } from "~/terminal-links";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { readEnvironmentApi } from "~/environmentApi";
import { readLocalApi } from "~/localApi";
import { useStore } from "~/store";
import { createThreadSelectorByRef } from "~/storeSelectors";

interface GitActionsControlProps {
  gitCwd: string | null;
  activeThreadRef: ScopedThreadRef | null;
  draftId?: DraftId;
}

interface PendingDefaultBranchAction {
  action: DefaultBranchConfirmableAction;
  branchName: string;
  includesCommit: boolean;
  commitMessage?: string;
  onConfirmed?: () => void;
  filePaths?: string[];
}

type GitActionToastId = ReturnType<typeof toastManager.add>;

interface ActiveGitActionProgress {
  toastId: GitActionToastId;
  toastData: ThreadToastData | undefined;
  actionId: string;
  title: string;
  phaseStartedAtMs: number | null;
  hookStartedAtMs: number | null;
  hookName: string | null;
  lastOutputLine: string | null;
  currentPhaseLabel: string | null;
}

interface RunGitActionWithToastInput {
  action: GitStackedAction;
  commitMessage?: string;
  onConfirmed?: () => void;
  skipDefaultBranchPrompt?: boolean;
  statusOverride?: GitStatusResult | null;
  featureBranch?: boolean;
  progressToastId?: GitActionToastId;
  filePaths?: string[];
}

const GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS = 250;

function formatElapsedDescription(startedAtMs: number | null): string | undefined {
  if (startedAtMs === null) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `Running for ${elapsedSeconds}s`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `Running for ${minutes}m ${seconds}s`;
}

function resolveProgressDescription(progress: ActiveGitActionProgress): string | undefined {
  if (progress.lastOutputLine) {
    return progress.lastOutputLine;
  }
  return formatElapsedDescription(progress.hookStartedAtMs ?? progress.phaseStartedAtMs);
}

function getMenuActionDisabledReason({
  item,
  gitStatus,
  isBusy,
  hasOriginRemote,
}: {
  item: GitActionMenuItem;
  gitStatus: GitStatusResult | null;
  isBusy: boolean;
  hasOriginRemote: boolean;
}): string | null {
  if (!item.disabled) return null;
  if (isBusy) return "Git action in progress.";
  if (!gitStatus) return "Git status is unavailable.";

  const hasBranch = gitStatus.branch !== null;
  const hasChanges = gitStatus.hasWorkingTreeChanges;
  const hasOpenPr = gitStatus.pr?.state === "open";
  const isAhead = gitStatus.aheadCount > 0;
  const isBehind = gitStatus.behindCount > 0;

  if (item.id === "commit") {
    if (!hasChanges) {
      return "Worktree is clean. Make changes before committing.";
    }
    return "Commit is currently unavailable.";
  }

  if (item.id === "push") {
    if (!hasBranch) {
      return "Detached HEAD: checkout a branch before pushing.";
    }
    if (hasChanges) {
      return "Commit or stash local changes before pushing.";
    }
    if (isBehind) {
      return "Branch is behind upstream. Pull/rebase before pushing.";
    }
    if (!gitStatus.hasUpstream && !hasOriginRemote) {
      return 'Add an "origin" remote before pushing.';
    }
    if (!isAhead) {
      return "No local commits to push.";
    }
    return "Push is currently unavailable.";
  }

  if (item.id === "merge_pr") {
    if (!hasOpenPr) {
      return "No open PR to merge.";
    }
    return "Merge PR is currently unavailable.";
  }

  if (hasOpenPr) {
    return "View PR is currently unavailable.";
  }
  if (!hasBranch) {
    return "Detached HEAD: checkout a branch before creating a PR.";
  }
  if (hasChanges) {
    return "Commit local changes before creating a PR.";
  }
  if (!gitStatus.hasUpstream && !hasOriginRemote) {
    return 'Add an "origin" remote before creating a PR.';
  }
  if (!isAhead) {
    return "No local commits to include in a PR.";
  }
  if (isBehind) {
    return "Branch is behind upstream. Pull/rebase before creating a PR.";
  }
  return "Create PR is currently unavailable.";
}

const COMMIT_DIALOG_TITLE = "Commit changes";
const COMMIT_DIALOG_DESCRIPTION =
  "Review and confirm your commit. Leave the message blank to auto-generate one.";

function GitActionItemIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === "commit") return <GitCommitIcon />;
  if (icon === "push") return <CloudUploadIcon />;
  return <GitHubIcon />;
}

function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const iconClassName = "size-3.5";
  if (quickAction.kind === "open_pr") return <GitHubIcon className={iconClassName} />;
  if (quickAction.kind === "run_pull") return <InfoIcon className={iconClassName} />;
  if (quickAction.kind === "run_action") {
    if (quickAction.action === "commit") return <GitCommitIcon className={iconClassName} />;
    if (quickAction.action === "push" || quickAction.action === "commit_push") {
      return <CloudUploadIcon className={iconClassName} />;
    }
    return <GitHubIcon className={iconClassName} />;
  }
  if (quickAction.label === "Commit") return <GitCommitIcon className={iconClassName} />;
  return <InfoIcon className={iconClassName} />;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function formatCiAbsoluteTimestamp(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoDate));
}

function formatShortSha(sha: string): string {
  return sha.slice(0, 8);
}

function GitCiStateIcon({
  overallState,
  className,
}: {
  overallState: "success" | "failure" | "pending" | "neutral" | "none";
  className?: string;
}) {
  if (overallState === "failure") {
    return <XCircleIcon className={cn("size-4", className)} />;
  }
  if (overallState === "pending") {
    return <LoaderCircleIcon className={cn("size-4 animate-spin", className)} />;
  }
  if (overallState === "success") {
    return <CheckCircle2Icon className={cn("size-4", className)} />;
  }
  return <ShieldCheckIcon className={cn("size-4", className)} />;
}

function GitCiStatCard(props: {
  label: string;
  value: string;
  tone?: "default" | "failure" | "pending" | "success" | undefined;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-3 shadow-xs backdrop-blur",
        props.tone === "failure" &&
          "border-destructive/18 bg-destructive/[0.06] text-destructive-foreground",
        props.tone === "pending" && "border-warning/18 bg-warning/[0.07] text-warning-foreground",
        props.tone === "success" && "border-success/18 bg-success/[0.07] text-success-foreground",
        props.tone === "default" && "border-border/70 bg-background/72 text-foreground",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-70">
        {props.label}
      </div>
      <div className="mt-2 font-mono text-lg tracking-tight">{props.value}</div>
    </div>
  );
}

function GitCiMetaFact(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/72 px-3 py-2 shadow-xs">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {props.label}
      </div>
      <div className={cn("mt-1 text-sm text-foreground", props.mono && "font-mono")}>
        {props.value}
      </div>
    </div>
  );
}

function GitCiActionTile(props: {
  eyebrow: string;
  title: string;
  description: string;
  buttonLabel?: string | undefined;
  buttonVariant?: "default" | "outline" | "secondary" | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.35rem] border border-border/70 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-background)_86%,white),color-mix(in_oklab,var(--color-muted)_76%,transparent))] p-4 shadow-xs">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_34%)]" />
      <div className="relative space-y-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {props.eyebrow}
        </div>
        <div>
          <div className="font-heading text-base leading-tight">{props.title}</div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{props.description}</p>
        </div>
        {props.buttonLabel ? (
          <Button
            size="sm"
            variant={props.buttonVariant ?? "outline"}
            disabled={props.disabled}
            onClick={props.onClick}
            className="justify-between"
          >
            <span>{props.buttonLabel}</span>
            <ArrowUpRightIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function GitCiCheckStatusBadge({ check }: { check: GitCiCheck }) {
  return (
    <Badge variant={getGitCiCheckBadgeVariant(check)} size="sm" className="gap-1">
      <span className={getGitCiCheckToneClassName(check)}>
        <GitCiStateIcon
          overallState={
            check.bucket === "fail"
              ? "failure"
              : check.bucket === "pending"
                ? "pending"
                : check.bucket === "pass"
                  ? "success"
                  : "neutral"
          }
          className="size-3"
        />
      </span>
      {formatGitCiCheckStatus(check)}
    </Badge>
  );
}

export default function GitActionsControl({
  gitCwd,
  activeThreadRef,
  draftId,
}: GitActionsControlProps) {
  const activeEnvironmentId = activeThreadRef?.environmentId ?? null;
  const threadToastData = useMemo<ThreadToastData | undefined>(
    () => (activeThreadRef ? { threadRef: activeThreadRef } : undefined),
    [activeThreadRef],
  );
  const activeServerThreadSelector = useMemo(
    () => createThreadSelectorByRef(activeThreadRef),
    [activeThreadRef],
  );
  const activeServerThread = useStore(activeServerThreadSelector);
  const activeDraftThread = useComposerDraftStore((store) =>
    draftId
      ? store.getDraftSession(draftId)
      : activeThreadRef
        ? store.getDraftThreadByRef(activeThreadRef)
        : null,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const setThreadBranch = useStore((store) => store.setThreadBranch);
  const queryClient = useQueryClient();
  const [isCommitDialogOpen, setIsCommitDialogOpen] = useState(false);
  const [isCiSheetOpen, setIsCiSheetOpen] = useState(false);
  const [dialogCommitMessage, setDialogCommitMessage] = useState("");
  const [excludedFiles, setExcludedFiles] = useState<ReadonlySet<string>>(new Set());
  const [isEditingFiles, setIsEditingFiles] = useState(false);
  const [pendingDefaultBranchAction, setPendingDefaultBranchAction] =
    useState<PendingDefaultBranchAction | null>(null);
  const activeGitActionProgressRef = useRef<ActiveGitActionProgress | null>(null);
  let runGitActionWithToast: (input: RunGitActionWithToastInput) => Promise<void>;

  const updateActiveProgressToast = useCallback(() => {
    const progress = activeGitActionProgressRef.current;
    if (!progress) {
      return;
    }
    toastManager.update(progress.toastId, {
      type: "loading",
      title: progress.title,
      description: resolveProgressDescription(progress),
      timeout: 0,
      data: progress.toastData,
    });
  }, []);

  const persistThreadBranchSync = useCallback(
    (branch: string | null) => {
      if (!activeThreadRef) {
        return;
      }

      if (activeServerThread) {
        if (activeServerThread.branch === branch) {
          return;
        }

        const worktreePath = activeServerThread.worktreePath;
        const api = readEnvironmentApi(activeThreadRef.environmentId);
        if (api) {
          void api.orchestration
            .dispatchCommand({
              type: "thread.meta.update",
              commandId: newCommandId(),
              threadId: activeThreadRef.threadId,
              branch,
              worktreePath,
            })
            .catch(() => undefined);
        }

        setThreadBranch(activeThreadRef, branch, worktreePath);
        return;
      }

      if (!activeDraftThread || activeDraftThread.branch === branch) {
        return;
      }

      setDraftThreadContext(draftId ?? activeThreadRef, {
        branch,
        worktreePath: activeDraftThread.worktreePath,
      });
    },
    [
      activeDraftThread,
      activeServerThread,
      activeThreadRef,
      draftId,
      setDraftThreadContext,
      setThreadBranch,
    ],
  );

  const syncThreadBranchAfterGitAction = useCallback(
    (result: GitRunStackedActionResult) => {
      const branchUpdate = resolveThreadBranchUpdate(result);
      if (!branchUpdate) {
        return;
      }

      persistThreadBranchSync(branchUpdate.branch);
    },
    [persistThreadBranchSync],
  );

  const { data: gitStatus = null, error: gitStatusError } = useGitStatus({
    environmentId: activeEnvironmentId,
    cwd: gitCwd,
  });
  // Default to true while loading so we don't flash init controls.
  const isRepo = gitStatus?.isRepo ?? true;
  const hasOriginRemote = gitStatus?.hasOriginRemote ?? false;
  const gitStatusForActions = gitStatus;
  const threadCi = resolveThreadGitCi(
    activeServerThread?.branch ?? activeDraftThread?.branch ?? null,
    gitStatusForActions,
  );
  const relevantThreadCiChecks = useMemo(
    () => (threadCi ? getRelevantGitCiChecks(threadCi) : []),
    [threadCi],
  );
  const sortedThreadCiChecks = useMemo(
    () => (threadCi ? sortGitCiChecks(threadCi.checks) : []),
    [threadCi],
  );
  const failingThreadCiChecks = useMemo(
    () => sortedThreadCiChecks.filter((check) => check.bucket === "fail"),
    [sortedThreadCiChecks],
  );
  const pendingThreadCiChecks = useMemo(
    () => sortedThreadCiChecks.filter((check) => check.bucket === "pending"),
    [sortedThreadCiChecks],
  );

  const allFiles = gitStatusForActions?.workingTree.files ?? [];
  const selectedFiles = allFiles.filter((f) => !excludedFiles.has(f.path));
  const allSelected = excludedFiles.size === 0;
  const noneSelected = selectedFiles.length === 0;

  const initMutation = useMutation(
    gitInitMutationOptions({ environmentId: activeEnvironmentId, cwd: gitCwd, queryClient }),
  );

  const runImmediateGitActionMutation = useMutation(
    gitRunStackedActionMutationOptions({
      environmentId: activeEnvironmentId,
      cwd: gitCwd,
      queryClient,
    }),
  );
  const pullMutation = useMutation(
    gitPullMutationOptions({ environmentId: activeEnvironmentId, cwd: gitCwd, queryClient }),
  );
  const mergePullRequestMutation = useMutation(
    gitMergePullRequestMutationOptions({
      environmentId: activeEnvironmentId,
      cwd: gitCwd,
      queryClient,
    }),
  );

  const isRunStackedActionRunning =
    useIsMutating({
      mutationKey: gitMutationKeys.runStackedAction(activeEnvironmentId, gitCwd),
    }) > 0;
  const isPullRunning =
    useIsMutating({ mutationKey: gitMutationKeys.pull(activeEnvironmentId, gitCwd) }) > 0;
  const isMergePullRequestRunning =
    useIsMutating({
      mutationKey: gitMutationKeys.mergePullRequest(activeEnvironmentId, gitCwd),
    }) > 0;
  const isGitActionRunning =
    isRunStackedActionRunning || isPullRunning || isMergePullRequestRunning;
  const isSelectingWorktreeBase =
    !activeServerThread &&
    activeDraftThread?.envMode === "worktree" &&
    activeDraftThread.worktreePath === null;

  useEffect(() => {
    if (isGitActionRunning || isSelectingWorktreeBase) {
      return;
    }

    const branchUpdate = resolveLiveThreadBranchUpdate({
      threadBranch: activeServerThread?.branch ?? activeDraftThread?.branch ?? null,
      gitStatus: gitStatusForActions,
    });
    if (!branchUpdate) {
      return;
    }

    persistThreadBranchSync(branchUpdate.branch);
  }, [
    activeServerThread?.branch,
    activeDraftThread?.branch,
    gitStatusForActions,
    isGitActionRunning,
    isSelectingWorktreeBase,
    persistThreadBranchSync,
  ]);

  const isDefaultBranch = useMemo(() => {
    return gitStatusForActions?.isDefaultBranch ?? false;
  }, [gitStatusForActions?.isDefaultBranch]);

  const gitActionMenuItems = useMemo(
    () => buildMenuItems(gitStatusForActions, isGitActionRunning, hasOriginRemote),
    [gitStatusForActions, hasOriginRemote, isGitActionRunning],
  );
  const quickAction = useMemo(
    () =>
      resolveQuickAction(gitStatusForActions, isGitActionRunning, isDefaultBranch, hasOriginRemote),
    [gitStatusForActions, hasOriginRemote, isDefaultBranch, isGitActionRunning],
  );
  const quickActionDisabledReason = quickAction.disabled
    ? (quickAction.hint ?? "This action is currently unavailable.")
    : null;
  const ciOverviewBadges = useMemo(() => {
    if (!gitStatusForActions) {
      return [];
    }

    const badges: Array<{
      label: string;
      variant: "outline" | "warning" | "error" | "success" | "secondary";
    }> = [];

    badges.push({
      label: gitStatusForActions.branch ?? "Detached HEAD",
      variant: gitStatusForActions.branch ? "outline" : "warning",
    });

    if (gitStatusForActions.isDefaultBranch) {
      badges.push({ label: "Default branch", variant: "warning" });
    }
    if (gitStatusForActions.hasWorkingTreeChanges) {
      badges.push({ label: "Uncommitted changes", variant: "warning" });
    }
    if (gitStatusForActions.aheadCount > 0) {
      badges.push({
        label: `${gitStatusForActions.aheadCount} ahead`,
        variant: "success",
      });
    }
    if (gitStatusForActions.behindCount > 0) {
      badges.push({
        label: `${gitStatusForActions.behindCount} behind`,
        variant: "warning",
      });
    }
    if (!gitStatusForActions.hasUpstream) {
      badges.push({ label: "No upstream", variant: "secondary" });
    }
    if (gitStatusForActions.pr?.state === "open") {
      badges.push({ label: `PR #${gitStatusForActions.pr.number}`, variant: "success" });
    }

    return badges;
  }, [gitStatusForActions]);
  const pendingDefaultBranchActionCopy = pendingDefaultBranchAction
    ? resolveDefaultBranchActionDialogCopy({
        action: pendingDefaultBranchAction.action,
        branchName: pendingDefaultBranchAction.branchName,
        includesCommit: pendingDefaultBranchAction.includesCommit,
      })
    : null;

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!activeGitActionProgressRef.current) {
        return;
      }
      updateActiveProgressToast();
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [updateActiveProgressToast]);

  useEffect(() => {
    if (gitCwd === null) {
      return;
    }

    let refreshTimeout: number | null = null;
    const scheduleRefreshCurrentGitStatus = () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        void refreshGitStatus({ environmentId: activeEnvironmentId, cwd: gitCwd }).catch(
          () => undefined,
        );
      }, GIT_STATUS_WINDOW_REFRESH_DEBOUNCE_MS);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefreshCurrentGitStatus();
      }
    };

    window.addEventListener("focus", scheduleRefreshCurrentGitStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (refreshTimeout !== null) {
        window.clearTimeout(refreshTimeout);
      }
      window.removeEventListener("focus", scheduleRefreshCurrentGitStatus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeEnvironmentId, gitCwd]);

  const openExistingPr = useCallback(async () => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
        data: threadToastData,
      });
      return;
    }
    const prUrl = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr.url : null;
    if (!prUrl) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: threadToastData,
      });
      return;
    }
    void api.shell.openExternal(prUrl).catch((err: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: err instanceof Error ? err.message : "An error occurred.",
        data: threadToastData,
      });
    });
  }, [gitStatusForActions, threadToastData]);

  const openExternalLink = useCallback(
    (url: string | null | undefined, failureTitle: string) => {
      if (!url) {
        return;
      }
      const api = readLocalApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Link opening is unavailable.",
          data: threadToastData,
        });
        return;
      }

      void api.shell.openExternal(url).catch((err: unknown) => {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: err instanceof Error ? err.message : "An error occurred.",
          data: threadToastData,
        });
      });
    },
    [threadToastData],
  );

  const mergeOpenPullRequest = useCallback(() => {
    const openPr = gitStatusForActions?.pr?.state === "open" ? gitStatusForActions.pr : null;
    if (!openPr) {
      toastManager.add({
        type: "error",
        title: "No open PR found.",
        data: threadToastData,
      });
      return;
    }

    const promise = mergePullRequestMutation.mutateAsync(openPr.number);
    toastManager.promise(promise, {
      loading: {
        title: `Merging PR #${openPr.number}...`,
        data: threadToastData,
      },
      success: (result) => ({
        title: `Merged PR #${result.prNumber}`,
        description: "Squash merged and deleted branch.",
        data: threadToastData
          ? {
              ...threadToastData,
              dismissAfterVisibleMs: 10_000,
            }
          : {
              dismissAfterVisibleMs: 10_000,
            },
        actionProps: {
          children: "View PR",
          onClick: () => {
            const api = readLocalApi();
            if (!api) {
              return;
            }
            void api.shell.openExternal(result.prUrl);
          },
        },
      }),
      error: (err) => ({
        title: "Merge failed",
        description: err instanceof Error ? err.message : "An error occurred.",
        data: threadToastData,
      }),
    });
    void promise.catch(() => undefined);
  }, [gitStatusForActions?.pr, mergePullRequestMutation, threadToastData]);

  const openGitCiTarget = useCallback(() => {
    openExternalLink(threadCi?.targetUrl, "Unable to open CI link");
  }, [openExternalLink, threadCi?.targetUrl]);

  const openGitCiCheckLink = useCallback(
    (check: GitCiCheck) => {
      openExternalLink(check.link, "Unable to open check link");
    },
    [openExternalLink],
  );

  const openCiSheet = useCallback(() => {
    setIsCiSheetOpen(true);
    if (!gitCwd) {
      return;
    }
    void refreshGitStatus({ environmentId: activeEnvironmentId, cwd: gitCwd }).catch(
      () => undefined,
    );
  }, [activeEnvironmentId, gitCwd]);

  const refreshCiSheet = useCallback(() => {
    if (!gitCwd) {
      return;
    }
    void refreshGitStatus({ environmentId: activeEnvironmentId, cwd: gitCwd }).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to refresh CI status",
        description: error instanceof Error ? error.message : "An error occurred.",
        data: threadToastData,
      });
    });
  }, [activeEnvironmentId, gitCwd, threadToastData]);

  const openFirstFailingCheck = useCallback(() => {
    const firstFailingCheck = failingThreadCiChecks[0];
    if (!firstFailingCheck) {
      openGitCiTarget();
      return;
    }
    openGitCiCheckLink(firstFailingCheck);
  }, [failingThreadCiChecks, openGitCiCheckLink, openGitCiTarget]);

  const openFirstPendingCheck = useCallback(() => {
    const firstPendingCheck = pendingThreadCiChecks[0];
    if (!firstPendingCheck) {
      openGitCiTarget();
      return;
    }
    openGitCiCheckLink(firstPendingCheck);
  }, [openGitCiCheckLink, openGitCiTarget, pendingThreadCiChecks]);

  runGitActionWithToast = useEffectEvent(
    async ({
      action,
      commitMessage,
      onConfirmed,
      skipDefaultBranchPrompt = false,
      statusOverride,
      featureBranch = false,
      progressToastId,
      filePaths,
    }: RunGitActionWithToastInput) => {
      const actionStatus = statusOverride ?? gitStatusForActions;
      const actionBranch = actionStatus?.branch ?? null;
      const actionIsDefaultBranch = featureBranch ? false : isDefaultBranch;
      const actionCanCommit =
        action === "commit" || action === "commit_push" || action === "commit_push_pr";
      const includesCommit =
        actionCanCommit &&
        (action === "commit" || !!actionStatus?.hasWorkingTreeChanges || featureBranch);
      if (
        !skipDefaultBranchPrompt &&
        requiresDefaultBranchConfirmation(action, actionIsDefaultBranch) &&
        actionBranch
      ) {
        if (
          action !== "push" &&
          action !== "create_pr" &&
          action !== "commit_push" &&
          action !== "commit_push_pr"
        ) {
          return;
        }
        setPendingDefaultBranchAction({
          action,
          branchName: actionBranch,
          includesCommit,
          ...(commitMessage ? { commitMessage } : {}),
          ...(onConfirmed ? { onConfirmed } : {}),
          ...(filePaths ? { filePaths } : {}),
        });
        return;
      }
      onConfirmed?.();

      const progressStages = buildGitActionProgressStages({
        action,
        hasCustomCommitMessage: !!commitMessage?.trim(),
        hasWorkingTreeChanges: !!actionStatus?.hasWorkingTreeChanges,
        featureBranch,
        shouldPushBeforePr:
          action === "create_pr" &&
          (!actionStatus?.hasUpstream || (actionStatus?.aheadCount ?? 0) > 0),
      });
      const scopedToastData = threadToastData ? { ...threadToastData } : undefined;
      const actionId = randomUUID();
      const resolvedProgressToastId =
        progressToastId ??
        toastManager.add({
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });

      activeGitActionProgressRef.current = {
        toastId: resolvedProgressToastId,
        toastData: scopedToastData,
        actionId,
        title: progressStages[0] ?? "Running git action...",
        phaseStartedAtMs: null,
        hookStartedAtMs: null,
        hookName: null,
        lastOutputLine: null,
        currentPhaseLabel: progressStages[0] ?? "Running git action...",
      };

      if (progressToastId) {
        toastManager.update(progressToastId, {
          type: "loading",
          title: progressStages[0] ?? "Running git action...",
          description: "Waiting for Git...",
          timeout: 0,
          data: scopedToastData,
        });
      }

      const applyProgressEvent = (event: GitActionProgressEvent) => {
        const progress = activeGitActionProgressRef.current;
        if (!progress) {
          return;
        }
        if (gitCwd && event.cwd !== gitCwd) {
          return;
        }
        if (progress.actionId !== event.actionId) {
          return;
        }

        const now = Date.now();
        switch (event.kind) {
          case "action_started":
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "phase_started":
            progress.title = event.label;
            progress.currentPhaseLabel = event.label;
            progress.phaseStartedAtMs = now;
            progress.hookStartedAtMs = null;
            progress.hookName = null;
            progress.lastOutputLine = null;
            break;
          case "hook_started":
            progress.title = `Running ${event.hookName}...`;
            progress.hookName = event.hookName;
            progress.hookStartedAtMs = now;
            progress.lastOutputLine = null;
            break;
          case "hook_output":
            progress.lastOutputLine = event.text;
            break;
          case "hook_finished":
            progress.title = progress.currentPhaseLabel ?? "Committing...";
            progress.hookName = null;
            progress.hookStartedAtMs = null;
            progress.lastOutputLine = null;
            break;
          case "action_finished":
            // Let the resolved mutation update the toast so we keep the
            // elapsed description visible until the final success state renders.
            return;
          case "action_failed":
            // Let the rejected mutation publish the error toast to avoid a
            // transient intermediate state before the final failure message.
            return;
        }

        updateActiveProgressToast();
      };

      const promise = runImmediateGitActionMutation.mutateAsync({
        actionId,
        action,
        ...(commitMessage ? { commitMessage } : {}),
        ...(featureBranch ? { featureBranch } : {}),
        ...(filePaths ? { filePaths } : {}),
        onProgress: applyProgressEvent,
      });

      try {
        const result = await promise;
        activeGitActionProgressRef.current = null;
        syncThreadBranchAfterGitAction(result);
        const closeResultToast = () => {
          toastManager.close(resolvedProgressToastId);
        };

        const toastCta = result.toast.cta;
        let toastActionProps: {
          children: string;
          onClick: () => void;
        } | null = null;
        if (toastCta.kind === "run_action") {
          toastActionProps = {
            children: toastCta.label,
            onClick: () => {
              closeResultToast();
              void runGitActionWithToast({
                action: toastCta.action.kind,
              });
            },
          };
        } else if (toastCta.kind === "open_pr") {
          toastActionProps = {
            children: toastCta.label,
            onClick: () => {
              const api = readLocalApi();
              if (!api) return;
              closeResultToast();
              void api.shell.openExternal(toastCta.url);
            },
          };
        }

        const successToastBase = {
          type: "success",
          title: result.toast.title,
          description: result.toast.description,
          timeout: 0,
          data: {
            ...scopedToastData,
            dismissAfterVisibleMs: 10_000,
          },
        } as const;

        if (toastActionProps) {
          toastManager.update(resolvedProgressToastId, {
            ...successToastBase,
            actionProps: toastActionProps,
          });
        } else {
          toastManager.update(resolvedProgressToastId, successToastBase);
        }
      } catch (err) {
        activeGitActionProgressRef.current = null;
        toastManager.update(resolvedProgressToastId, {
          type: "error",
          title: "Action failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: scopedToastData,
        });
      }
    },
  );

  const continuePendingDefaultBranchAction = () => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      skipDefaultBranchPrompt: true,
    });
  };

  const checkoutFeatureBranchAndContinuePendingAction = () => {
    if (!pendingDefaultBranchAction) return;
    const { action, commitMessage, onConfirmed, filePaths } = pendingDefaultBranchAction;
    setPendingDefaultBranchAction(null);
    void runGitActionWithToast({
      action,
      ...(commitMessage ? { commitMessage } : {}),
      ...(onConfirmed ? { onConfirmed } : {}),
      ...(filePaths ? { filePaths } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  };

  const runDialogActionOnNewBranch = () => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();

    setIsCommitDialogOpen(false);
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);

    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
      featureBranch: true,
      skipDefaultBranchPrompt: true,
    });
  };

  const runQuickAction = useCallback(() => {
    if (quickAction.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (quickAction.kind === "run_pull") {
      const promise = pullMutation.mutateAsync();
      toastManager.promise(promise, {
        loading: { title: "Pulling...", data: threadToastData },
        success: (result) => ({
          title: result.status === "pulled" ? "Pulled" : "Already up to date",
          description:
            result.status === "pulled"
              ? `Updated ${result.branch} from ${result.upstreamBranch ?? "upstream"}`
              : `${result.branch} is already synchronized.`,
          data: threadToastData,
        }),
        error: (err) => ({
          title: "Pull failed",
          description: err instanceof Error ? err.message : "An error occurred.",
          data: threadToastData,
        }),
      });
      void promise.catch(() => undefined);
      return;
    }
    if (quickAction.kind === "show_hint") {
      toastManager.add({
        type: "info",
        title: quickAction.label,
        description: quickAction.hint,
        data: threadToastData,
      });
      return;
    }
    if (quickAction.action) {
      void runGitActionWithToast({ action: quickAction.action });
    }
  }, [openExistingPr, pullMutation, quickAction, runGitActionWithToast, threadToastData]);

  const ciActionTiles = useMemo(() => {
    if (!threadCi) {
      return [];
    }

    const items: Array<{
      id: string;
      eyebrow: string;
      title: string;
      description: string;
      buttonLabel?: string;
      buttonVariant?: "default" | "outline" | "secondary";
      disabled?: boolean;
      onClick?: () => void;
    }> = [];

    if (!quickAction.disabled) {
      items.push({
        id: "recommended",
        eyebrow: "Recommended",
        title: quickAction.label,
        description:
          quickAction.kind === "run_pull"
            ? "Sync the branch before judging CI against stale commits."
            : "Continue the branch flow directly from the CI panel.",
        buttonLabel: quickAction.label,
        buttonVariant: "default",
        onClick: runQuickAction,
      });
    } else {
      items.push({
        id: "recommended-disabled",
        eyebrow: "Recommended",
        title: quickAction.label,
        description: quickActionDisabledReason ?? "No git action is currently available.",
      });
    }

    if (threadCi.targetUrl) {
      items.push({
        id: "provider-run",
        eyebrow: "Provider",
        title: "Open CI provider view",
        description: "Inspect the canonical run page, annotations, and provider-native logs.",
        buttonLabel: "Open run",
        onClick: openGitCiTarget,
      });
    }

    if (failingThreadCiChecks.length > 0) {
      const firstFailure = failingThreadCiChecks[0]!;
      items.push({
        id: "failing-check",
        eyebrow: "Failing check",
        title: firstFailure.name,
        description:
          firstFailure.description ??
          "Jump directly to the first failing check and inspect the provider logs.",
        buttonLabel: firstFailure.link ? "Open failing check" : "Open run",
        buttonVariant: "outline",
        onClick: openFirstFailingCheck,
      });
    } else if (pendingThreadCiChecks.length > 0) {
      const firstPending = pendingThreadCiChecks[0]!;
      items.push({
        id: "pending-check",
        eyebrow: "Live status",
        title: firstPending.name,
        description:
          firstPending.description ??
          "Checks are still running. Follow the live job instead of waiting blind.",
        buttonLabel: firstPending.link ? "Open live check" : "Open run",
        buttonVariant: "secondary",
        onClick: openFirstPendingCheck,
      });
    }

    if (gitStatusForActions?.pr?.state === "open") {
      items.push({
        id: "open-pr",
        eyebrow: "Pull request",
        title: gitStatusForActions.pr.title,
        description: `Review PR #${gitStatusForActions.pr.number} or merge it from the action menu.`,
        buttonLabel: "Open PR",
        onClick: () => {
          void openExistingPr();
        },
      });
    }

    return items.slice(0, 4);
  }, [
    failingThreadCiChecks,
    gitStatusForActions?.pr,
    openExistingPr,
    openFirstFailingCheck,
    openFirstPendingCheck,
    openGitCiTarget,
    pendingThreadCiChecks,
    quickAction,
    quickActionDisabledReason,
    runQuickAction,
    threadCi,
  ]);

  const openDialogForMenuItem = (item: GitActionMenuItem) => {
    if (item.disabled) return;
    if (item.kind === "open_pr") {
      void openExistingPr();
      return;
    }
    if (item.dialogAction === "push") {
      void runGitActionWithToast({ action: "push" });
      return;
    }
    if (item.dialogAction === "create_pr") {
      void runGitActionWithToast({ action: "create_pr" });
      return;
    }
    if (item.dialogAction === "merge_pr") {
      void mergeOpenPullRequest();
      return;
    }
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    setIsCommitDialogOpen(true);
  };

  const runDialogAction = () => {
    if (!isCommitDialogOpen) return;
    const commitMessage = dialogCommitMessage.trim();
    setIsCommitDialogOpen(false);
    setDialogCommitMessage("");
    setExcludedFiles(new Set());
    setIsEditingFiles(false);
    void runGitActionWithToast({
      action: "commit",
      ...(commitMessage ? { commitMessage } : {}),
      ...(!allSelected ? { filePaths: selectedFiles.map((f) => f.path) } : {}),
    });
  };

  const openChangedFileInEditor = useCallback(
    (filePath: string) => {
      const api = readLocalApi();
      if (!api || !gitCwd) {
        toastManager.add({
          type: "error",
          title: "Editor opening is unavailable.",
          data: threadToastData,
        });
        return;
      }
      const target = resolvePathLinkTarget(filePath, gitCwd);
      void openInPreferredEditor(api, target).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
          data: threadToastData,
        });
      });
    },
    [gitCwd, threadToastData],
  );

  if (!gitCwd) return null;

  return (
    <>
      {!isRepo ? (
        <Button
          variant="outline"
          size="xs"
          disabled={initMutation.isPending}
          onClick={() => initMutation.mutate()}
        >
          {initMutation.isPending ? "Initializing..." : "Initialize Git"}
        </Button>
      ) : (
        <Group aria-label="Git actions" className="shrink-0">
          {quickActionDisabledReason ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                render={
                  <Button
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-e-none border-e-0 opacity-64 before:rounded-e-none"
                    size="xs"
                    variant="outline"
                  />
                }
              >
                <GitQuickActionIcon quickAction={quickAction} />
                <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                  {quickAction.label}
                </span>
              </PopoverTrigger>
              <PopoverPopup tooltipStyle side="bottom" align="start">
                {quickActionDisabledReason}
              </PopoverPopup>
            </Popover>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={isGitActionRunning || quickAction.disabled}
              onClick={runQuickAction}
            >
              <GitQuickActionIcon quickAction={quickAction} />
              <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
                {quickAction.label}
              </span>
            </Button>
          )}
          {threadCi && (
            <>
              <GroupSeparator className="hidden @3xl/header-actions:block" />
              <Popover>
                <PopoverTrigger
                  openOnHover
                  render={
                    <Button
                      variant="outline"
                      size="xs"
                      className={cn(
                        "relative overflow-hidden border-current/20 bg-background/80",
                        getGitCiToneClassName(threadCi),
                      )}
                      onClick={openCiSheet}
                    />
                  }
                >
                  {formatGitCiLabel(threadCi)}
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="bottom" align="start" className="max-w-xs">
                  <div className="space-y-2 text-xs">
                    <div className="font-medium">{formatGitCiSourceLabel(threadCi)}</div>
                    <div className="text-muted-foreground">
                      {formatGitCiTooltipSummary(threadCi)}
                    </div>
                    {relevantThreadCiChecks.length > 0 && (
                      <div className="space-y-1">
                        {relevantThreadCiChecks.map((check) => (
                          <div
                            key={`${check.name}-${check.link ?? check.state}`}
                            className="space-y-0.5"
                          >
                            <div className="font-medium">{check.name}</div>
                            <div className="text-muted-foreground">
                              {check.description ?? check.state}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </PopoverPopup>
              </Popover>
            </>
          )}
          <GroupSeparator className="hidden @3xl/header-actions:block" />
          <Menu
            onOpenChange={(open) => {
              if (open) {
                void refreshGitStatus({
                  environmentId: activeEnvironmentId,
                  cwd: gitCwd,
                }).catch(() => undefined);
              }
            }}
          >
            <MenuTrigger
              render={<Button aria-label="Git action options" size="icon-xs" variant="outline" />}
              disabled={isGitActionRunning}
            >
              <ChevronDownIcon aria-hidden="true" className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-full">
              {gitActionMenuItems.map((item) => {
                const disabledReason = getMenuActionDisabledReason({
                  item,
                  gitStatus: gitStatusForActions,
                  isBusy: isGitActionRunning,
                  hasOriginRemote,
                });
                if (item.disabled && disabledReason) {
                  return (
                    <Popover key={`${item.id}-${item.label}`}>
                      <PopoverTrigger
                        openOnHover
                        nativeButton={false}
                        render={<span className="block w-max cursor-not-allowed" />}
                      >
                        <MenuItem className="w-full" disabled>
                          <GitActionItemIcon icon={item.icon} />
                          {item.label}
                        </MenuItem>
                      </PopoverTrigger>
                      <PopoverPopup tooltipStyle side="left" align="center">
                        {disabledReason}
                      </PopoverPopup>
                    </Popover>
                  );
                }

                return (
                  <MenuItem
                    key={`${item.id}-${item.label}`}
                    disabled={item.disabled}
                    onClick={() => {
                      openDialogForMenuItem(item);
                    }}
                  >
                    <GitActionItemIcon icon={item.icon} />
                    {item.label}
                  </MenuItem>
                );
              })}
              {gitStatusForActions?.branch === null && (
                <p className="px-2 py-1.5 text-xs text-warning">
                  Detached HEAD: create and checkout a branch to enable push and PR actions.
                </p>
              )}
              {gitStatusForActions &&
                gitStatusForActions.branch !== null &&
                !gitStatusForActions.hasWorkingTreeChanges &&
                gitStatusForActions.behindCount > 0 &&
                gitStatusForActions.aheadCount === 0 && (
                  <p className="px-2 py-1.5 text-xs text-warning">
                    Behind upstream. Pull/rebase first.
                  </p>
                )}
              {gitStatusError && (
                <p className="px-2 py-1.5 text-xs text-destructive">{gitStatusError.message}</p>
              )}
            </MenuPopup>
          </Menu>
        </Group>
      )}

      {threadCi && (
        <Sheet open={isCiSheetOpen} onOpenChange={setIsCiSheetOpen}>
          <SheetPopup className="w-full max-w-3xl" side="right" variant="inset">
            <SheetHeader className="border-b border-border/70 pb-4">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      <GitCiStateIcon
                        overallState={threadCi.overallState}
                        className={getGitCiToneClassName(threadCi)}
                      />
                      CI / CD cockpit
                    </div>
                    <div>
                      <SheetTitle className="flex flex-wrap items-center gap-2 text-2xl leading-tight">
                        <span>{formatGitCiLabel(threadCi)}</span>
                        <Badge variant="outline">{formatGitCiSourceLabel(threadCi)}</Badge>
                      </SheetTitle>
                      <SheetDescription className="mt-2 max-w-3xl text-sm leading-relaxed">
                        {describeGitCiOutcome(threadCi)}
                      </SheetDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" onClick={refreshCiSheet}>
                      <RefreshCwIcon className="size-3.5" />
                      Refresh
                    </Button>
                    {threadCi.targetUrl && (
                      <Button size="sm" variant="outline" onClick={openGitCiTarget}>
                        <ExternalLinkIcon className="size-3.5" />
                        Open run
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ciOverviewBadges.map((badge) => (
                    <Badge key={badge.label} variant={badge.variant}>
                      {badge.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </SheetHeader>

            <SheetPanel className="space-y-5">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <GitCiStatCard
                  label="Checks"
                  value={`${threadCi.counts.total}`}
                  tone={threadCi.counts.total === 0 ? "default" : undefined}
                />
                <GitCiStatCard
                  label="Passed"
                  value={`${threadCi.counts.pass}`}
                  tone={threadCi.counts.pass > 0 ? "success" : "default"}
                />
                <GitCiStatCard
                  label="Pending"
                  value={`${threadCi.counts.pending}`}
                  tone={threadCi.counts.pending > 0 ? "pending" : "default"}
                />
                <GitCiStatCard
                  label="Failed"
                  value={`${threadCi.counts.fail}`}
                  tone={threadCi.counts.fail > 0 ? "failure" : "default"}
                />
                <GitCiStatCard
                  label="Updated"
                  value={formatRelativeTimeLabel(threadCi.updatedAt) ?? "Just now"}
                />
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <GitCiMetaFact label="Branch" value={threadCi.branch} mono />
                <GitCiMetaFact label="Head SHA" value={formatShortSha(threadCi.headSha)} mono />
                <GitCiMetaFact
                  label="Last update"
                  value={formatCiAbsoluteTimestamp(threadCi.updatedAt)}
                />
                <GitCiMetaFact label="Counts" value={formatGitCiTooltipSummary(threadCi)} />
              </section>

              {ciActionTiles.length > 0 && (
                <section className="space-y-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Next steps
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {ciActionTiles.map((item) => (
                      <GitCiActionTile
                        key={item.id}
                        eyebrow={item.eyebrow}
                        title={item.title}
                        description={item.description}
                        buttonLabel={item.buttonLabel}
                        buttonVariant={item.buttonVariant}
                        disabled={item.disabled}
                        onClick={item.onClick}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Check breakdown
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {threadCi.counts.total === 0
                        ? "No checks reported yet."
                        : `${threadCi.counts.total} ${pluralize(threadCi.counts.total, "check")} reported for this branch.`}
                    </p>
                  </div>
                  {gitStatusForActions?.pr?.state === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mergePullRequestMutation.isPending}
                      onClick={mergeOpenPullRequest}
                    >
                      <GitHubIcon className="size-3.5" />
                      Merge PR
                    </Button>
                  )}
                </div>

                {sortedThreadCiChecks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                    CI is connected, but the provider has not reported any checks yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {sortedThreadCiChecks.map((check) => (
                      <div
                        key={`${check.name}-${check.link ?? check.state}-${check.startedAt ?? "unknown"}`}
                        className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-medium">{check.name}</div>
                              <GitCiCheckStatusBadge check={check} />
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <GitBranchIcon className="size-3.5" />
                                {check.workflow}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <Clock3Icon className="size-3.5" />
                                {check.completedAt
                                  ? (formatRelativeTimeLabel(check.completedAt) ?? check.state)
                                  : check.startedAt
                                    ? (formatRelativeTimeLabel(check.startedAt) ?? check.state)
                                    : check.state}
                              </span>
                            </div>
                            {check.description && (
                              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                {check.description}
                              </p>
                            )}
                          </div>
                          {check.link && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openGitCiCheckLink(check)}
                            >
                              <ExternalLinkIcon className="size-3.5" />
                              Open
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {(threadCi.counts.fail > 0 || threadCi.counts.pending > 0) && (
                <section className="rounded-2xl border border-border/70 bg-muted/30 p-4">
                  <div className="flex items-start gap-3">
                    <TriangleAlertIcon
                      className={cn("mt-0.5 size-4 shrink-0", getGitCiToneClassName(threadCi))}
                    />
                    <div className="space-y-1">
                      <div className="font-medium">CI summary</div>
                      <p className="text-sm text-muted-foreground">
                        {formatGitCiTooltipSummary(threadCi)}
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </SheetPanel>
          </SheetPopup>
        </Sheet>
      )}

      <Dialog
        open={isCommitDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsCommitDialogOpen(false);
            setDialogCommitMessage("");
            setExcludedFiles(new Set());
            setIsEditingFiles(false);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{COMMIT_DIALOG_TITLE}</DialogTitle>
            <DialogDescription>{COMMIT_DIALOG_DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3 text-xs">
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
                <span className="text-muted-foreground">Branch</span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {gitStatusForActions?.branch ?? "(detached HEAD)"}
                  </span>
                  {isDefaultBranch && (
                    <span className="text-right text-warning text-xs">Warning: default branch</span>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isEditingFiles && allFiles.length > 0 && (
                      <Checkbox
                        checked={allSelected}
                        indeterminate={!allSelected && !noneSelected}
                        onCheckedChange={() => {
                          setExcludedFiles(
                            allSelected ? new Set(allFiles.map((f) => f.path)) : new Set(),
                          );
                        }}
                      />
                    )}
                    <span className="text-muted-foreground">Files</span>
                    {!allSelected && !isEditingFiles && (
                      <span className="text-muted-foreground">
                        ({selectedFiles.length} of {allFiles.length})
                      </span>
                    )}
                  </div>
                  {allFiles.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setIsEditingFiles((prev) => !prev)}
                    >
                      {isEditingFiles ? "Done" : "Edit"}
                    </Button>
                  )}
                </div>
                {!gitStatusForActions || allFiles.length === 0 ? (
                  <p className="font-medium">none</p>
                ) : (
                  <div className="space-y-2">
                    <ScrollArea className="h-44 rounded-md border border-input bg-background">
                      <div className="space-y-1 p-1">
                        {allFiles.map((file) => {
                          const isExcluded = excludedFiles.has(file.path);
                          return (
                            <div
                              key={file.path}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-accent/50"
                            >
                              {isEditingFiles && (
                                <Checkbox
                                  checked={!excludedFiles.has(file.path)}
                                  onCheckedChange={() => {
                                    setExcludedFiles((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(file.path)) {
                                        next.delete(file.path);
                                      } else {
                                        next.add(file.path);
                                      }
                                      return next;
                                    });
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                className="flex flex-1 items-center justify-between gap-3 text-left truncate"
                                onClick={() => openChangedFileInEditor(file.path)}
                              >
                                <span
                                  className={`truncate${isExcluded ? " text-muted-foreground" : ""}`}
                                >
                                  {file.path}
                                </span>
                                <span className="shrink-0">
                                  {isExcluded ? (
                                    <span className="text-muted-foreground">Excluded</span>
                                  ) : (
                                    <>
                                      <span className="text-success">+{file.insertions}</span>
                                      <span className="text-muted-foreground"> / </span>
                                      <span className="text-destructive">-{file.deletions}</span>
                                    </>
                                  )}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="flex justify-end font-mono">
                      <span className="text-success">
                        +{selectedFiles.reduce((sum, f) => sum + f.insertions, 0)}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-destructive">
                        -{selectedFiles.reduce((sum, f) => sum + f.deletions, 0)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium">Commit message (optional)</p>
              <Textarea
                value={dialogCommitMessage}
                onChange={(event) => setDialogCommitMessage(event.target.value)}
                placeholder="Leave empty to auto-generate"
                size="sm"
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsCommitDialogOpen(false);
                setDialogCommitMessage("");
                setExcludedFiles(new Set());
                setIsEditingFiles(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={noneSelected}
              onClick={runDialogActionOnNewBranch}
            >
              Commit on new branch
            </Button>
            <Button size="sm" disabled={noneSelected} onClick={runDialogAction}>
              Commit
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={pendingDefaultBranchAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDefaultBranchAction(null);
          }
        }}
      >
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {pendingDefaultBranchActionCopy?.title ?? "Run action on default branch?"}
            </DialogTitle>
            <DialogDescription>{pendingDefaultBranchActionCopy?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPendingDefaultBranchAction(null)}>
              Abort
            </Button>
            <Button variant="outline" size="sm" onClick={continuePendingDefaultBranchAction}>
              {pendingDefaultBranchActionCopy?.continueLabel ?? "Continue"}
            </Button>
            <Button size="sm" onClick={checkoutFeatureBranchAndContinuePendingAction}>
              Checkout feature branch & continue
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
