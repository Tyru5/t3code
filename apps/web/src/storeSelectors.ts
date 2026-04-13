import {
  type ProjectId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { selectEnvironmentState, type AppState, type EnvironmentState, useStore } from "./store";
import { type Project, type SidebarThreadSummary, type Thread, type ThreadShell } from "./types";
import { getThreadFromEnvironmentState } from "./threadDerivation";

export function createProjectSelectorByRef(
  ref: ScopedProjectRef | null | undefined,
): (state: AppState) => Project | undefined {
  return (state) =>
    ref ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId] : undefined;
}

function createScopedThreadSelector(
  resolveRef: (state: AppState) => ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  let previousEnvironmentState: EnvironmentState | undefined;
  let previousThreadId: ThreadId | undefined;
  let previousThread: Thread | undefined;

  return (state) => {
    const ref = resolveRef(state);
    if (!ref) {
      return undefined;
    }

    const environmentState = selectEnvironmentState(state, ref.environmentId);
    if (
      previousThread &&
      previousEnvironmentState === environmentState &&
      previousThreadId === ref.threadId
    ) {
      return previousThread;
    }

    previousEnvironmentState = environmentState;
    previousThreadId = ref.threadId;
    previousThread = getThreadFromEnvironmentState(environmentState, ref.threadId);
    return previousThread;
  };
}

export function createThreadSelectorByRef(
  ref: ScopedThreadRef | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector(() => ref);
}

export function createThreadSelectorAcrossEnvironments(
  threadId: ThreadId | null | undefined,
): (state: AppState) => Thread | undefined {
  return createScopedThreadSelector((state) => {
    if (!threadId) {
      return undefined;
    }

    for (const [environmentId, environmentState] of Object.entries(
      state.environmentStateById,
    ) as Array<[ScopedThreadRef["environmentId"], EnvironmentState]>) {
      if (environmentState.threadShellById[threadId]) {
        return {
          environmentId,
          threadId,
        };
      }
    }
    return undefined;
  });
}

function selectProjectAcrossEnvironments(
  state: AppState,
  projectId: ProjectId | null | undefined,
): Project | undefined {
  if (!projectId) {
    return undefined;
  }
  const activeEnvironmentId = state.activeEnvironmentId;
  if (activeEnvironmentId) {
    const activeProject = selectEnvironmentState(state, activeEnvironmentId).projectById[projectId];
    if (activeProject) {
      return activeProject;
    }
  }
  for (const environmentState of Object.values(state.environmentStateById)) {
    const project = environmentState.projectById[projectId];
    if (project) {
      return project;
    }
  }
  return undefined;
}

function findThreadRefAcrossEnvironments(
  state: AppState,
  threadId: ThreadId | null | undefined,
): ScopedThreadRef | undefined {
  if (!threadId) {
    return undefined;
  }

  const activeEnvironmentId = state.activeEnvironmentId;
  if (activeEnvironmentId) {
    const activeEnvironmentState = selectEnvironmentState(state, activeEnvironmentId);
    if (activeEnvironmentState.threadShellById[threadId]) {
      return { environmentId: activeEnvironmentId, threadId };
    }
  }

  for (const [environmentId, environmentState] of Object.entries(
    state.environmentStateById,
  ) as Array<[ScopedThreadRef["environmentId"], EnvironmentState]>) {
    if ((environmentState.threadShellById as Record<string, ThreadShell | undefined>)[threadId]) {
      return { environmentId, threadId };
    }
  }

  return undefined;
}

export function useProjectById(projectId: ProjectId | null | undefined): Project | undefined {
  return useStore((state) => selectProjectAcrossEnvironments(state, projectId));
}

export function useThreadById(threadId: ThreadId | null | undefined): Thread | undefined {
  return useStore((state) => {
    const threadRef = findThreadRefAcrossEnvironments(state, threadId);
    return threadRef
      ? getThreadFromEnvironmentState(
          selectEnvironmentState(state, threadRef.environmentId),
          threadRef.threadId,
        )
      : undefined;
  });
}
