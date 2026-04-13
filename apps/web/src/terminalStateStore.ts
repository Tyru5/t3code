/**
 * Single Zustand store for terminal UI state keyed by scoped thread identity.
 *
 * Terminal transition helpers are intentionally private to keep the public
 * API constrained to store actions/selectors.
 */

import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime";
import { type ScopedThreadRef, type TerminalEvent, type ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "./lib/storage";
import { terminalRunningSubprocessFromEvent } from "./terminalActivity";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "./types";

interface ThreadTerminalState {
  terminalOpen: boolean;
  terminalHeight: number;
  terminalIds: string[];
  runningTerminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
}

export interface ThreadTerminalLaunchContext {
  cwd: string;
  worktreePath: string | null;
}

export interface TerminalEventEntry {
  id: number;
  event: TerminalEvent;
}

const TERMINAL_STATE_STORAGE_KEY = "t3code:terminal-state:v1";
const EMPTY_TERMINAL_EVENT_ENTRIES: ReadonlyArray<TerminalEventEntry> = [];
const MAX_TERMINAL_EVENT_BUFFER = 200;
type TerminalThreadRef = ScopedThreadRef | ThreadId;

interface PersistedTerminalStateStoreState {
  terminalStateByThreadKey?: Record<string, ThreadTerminalState>;
}

export function migratePersistedTerminalStateStoreState(
  persistedState: unknown,
  version: number,
): PersistedTerminalStateStoreState {
  if (version === 1 && persistedState && typeof persistedState === "object") {
    const candidate = persistedState as PersistedTerminalStateStoreState;
    const nextTerminalStateByThreadKey = Object.fromEntries(
      Object.entries(candidate.terminalStateByThreadKey ?? {}).filter(([threadKey]) =>
        parseScopedThreadKey(threadKey),
      ),
    );
    return { terminalStateByThreadKey: nextTerminalStateByThreadKey };
  }
  return { terminalStateByThreadKey: {} };
}

function createTerminalStateStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function normalizeTerminalIds(terminalIds: string[]): string[] {
  const ids = [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids : [DEFAULT_THREAD_TERMINAL_ID];
}

function normalizeRunningTerminalIds(
  runningTerminalIds: string[],
  terminalIds: string[],
): string[] {
  if (runningTerminalIds.length === 0) return [];
  const validTerminalIdSet = new Set(terminalIds);
  return [...new Set(runningTerminalIds)]
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && validTerminalIdSet.has(id));
}

function fallbackGroupId(terminalId: string): string {
  return `group-${terminalId}`;
}

function assignUniqueGroupId(baseId: string, usedGroupIds: Set<string>): string {
  let candidate = baseId;
  let index = 2;
  while (usedGroupIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }
  usedGroupIds.add(candidate);
  return candidate;
}

function findGroupIndexByTerminalId(
  terminalGroups: ThreadTerminalGroup[],
  terminalId: string,
): number {
  return terminalGroups.findIndex((group) => group.terminalIds.includes(terminalId));
}

function normalizeTerminalGroupIds(terminalIds: string[]): string[] {
  return [...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0))];
}

function normalizeTerminalGroups(
  terminalGroups: ThreadTerminalGroup[],
  terminalIds: string[],
): ThreadTerminalGroup[] {
  const validTerminalIdSet = new Set(terminalIds);
  const assignedTerminalIds = new Set<string>();
  const nextGroups: ThreadTerminalGroup[] = [];
  const usedGroupIds = new Set<string>();

  for (const group of terminalGroups) {
    const groupTerminalIds = normalizeTerminalGroupIds(group.terminalIds).filter((terminalId) => {
      if (!validTerminalIdSet.has(terminalId)) return false;
      if (assignedTerminalIds.has(terminalId)) return false;
      return true;
    });
    if (groupTerminalIds.length === 0) continue;
    for (const terminalId of groupTerminalIds) {
      assignedTerminalIds.add(terminalId);
    }
    const baseGroupId =
      group.id.trim().length > 0
        ? group.id.trim()
        : fallbackGroupId(groupTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
    nextGroups.push({
      id: assignUniqueGroupId(baseGroupId, usedGroupIds),
      terminalIds: groupTerminalIds,
    });
  }

  for (const terminalId of terminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextGroups.push({
      id: assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds),
      terminalIds: [terminalId],
    });
  }

  if (nextGroups.length === 0) {
    return [
      {
        id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
        terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
      },
    ];
  }

  return nextGroups;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function terminalGroupsEqual(left: ThreadTerminalGroup[], right: ThreadTerminalGroup[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftGroup = left[index];
    const rightGroup = right[index];
    if (!leftGroup || !rightGroup) return false;
    if (leftGroup.id !== rightGroup.id) return false;
    if (!arraysEqual(leftGroup.terminalIds, rightGroup.terminalIds)) return false;
  }
  return true;
}

function threadTerminalStateEqual(left: ThreadTerminalState, right: ThreadTerminalState): boolean {
  return (
    left.terminalOpen === right.terminalOpen &&
    left.terminalHeight === right.terminalHeight &&
    left.activeTerminalId === right.activeTerminalId &&
    left.activeTerminalGroupId === right.activeTerminalGroupId &&
    arraysEqual(left.terminalIds, right.terminalIds) &&
    arraysEqual(left.runningTerminalIds, right.runningTerminalIds) &&
    terminalGroupsEqual(left.terminalGroups, right.terminalGroups)
  );
}

const DEFAULT_THREAD_TERMINAL_STATE: ThreadTerminalState = Object.freeze({
  terminalOpen: false,
  terminalHeight: DEFAULT_THREAD_TERMINAL_HEIGHT,
  terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
  runningTerminalIds: [],
  activeTerminalId: DEFAULT_THREAD_TERMINAL_ID,
  terminalGroups: [
    {
      id: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
      terminalIds: [DEFAULT_THREAD_TERMINAL_ID],
    },
  ],
  activeTerminalGroupId: fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
});

function createDefaultThreadTerminalState(): ThreadTerminalState {
  return {
    ...DEFAULT_THREAD_TERMINAL_STATE,
    terminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.terminalIds],
    runningTerminalIds: [...DEFAULT_THREAD_TERMINAL_STATE.runningTerminalIds],
    terminalGroups: copyTerminalGroups(DEFAULT_THREAD_TERMINAL_STATE.terminalGroups),
  };
}

function getDefaultThreadTerminalState(): ThreadTerminalState {
  return DEFAULT_THREAD_TERMINAL_STATE;
}

function normalizeThreadTerminalState(state: ThreadTerminalState): ThreadTerminalState {
  const terminalIds = normalizeTerminalIds(state.terminalIds);
  const nextTerminalIds = terminalIds.length > 0 ? terminalIds : [DEFAULT_THREAD_TERMINAL_ID];
  const runningTerminalIds = normalizeRunningTerminalIds(state.runningTerminalIds, nextTerminalIds);
  const activeTerminalId = nextTerminalIds.includes(state.activeTerminalId)
    ? state.activeTerminalId
    : (nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);
  const terminalGroups = normalizeTerminalGroups(state.terminalGroups, nextTerminalIds);
  const activeGroupIdFromState = terminalGroups.some(
    (group) => group.id === state.activeTerminalGroupId,
  )
    ? state.activeTerminalGroupId
    : null;
  const activeGroupIdFromTerminal =
    terminalGroups.find((group) => group.terminalIds.includes(activeTerminalId))?.id ?? null;

  const normalized: ThreadTerminalState = {
    terminalOpen: state.terminalOpen,
    terminalHeight:
      Number.isFinite(state.terminalHeight) && state.terminalHeight > 0
        ? state.terminalHeight
        : DEFAULT_THREAD_TERMINAL_HEIGHT,
    terminalIds: nextTerminalIds,
    runningTerminalIds,
    activeTerminalId,
    terminalGroups,
    activeTerminalGroupId:
      activeGroupIdFromState ??
      activeGroupIdFromTerminal ??
      terminalGroups[0]?.id ??
      fallbackGroupId(DEFAULT_THREAD_TERMINAL_ID),
  };
  return threadTerminalStateEqual(state, normalized) ? state : normalized;
}

function isDefaultThreadTerminalState(state: ThreadTerminalState): boolean {
  const normalized = normalizeThreadTerminalState(state);
  return threadTerminalStateEqual(normalized, DEFAULT_THREAD_TERMINAL_STATE);
}

function isValidTerminalId(terminalId: string): boolean {
  return terminalId.trim().length > 0;
}

function terminalThreadKey(
  threadRef: TerminalThreadRef,
  existingThreadKeys?: Iterable<string>,
): string {
  if (typeof threadRef !== "string") {
    return scopedThreadKey(threadRef);
  }

  const directThreadKey = threadRef.trim();
  if (!existingThreadKeys) {
    return directThreadKey;
  }

  for (const candidateKey of existingThreadKeys) {
    const parsed = parseScopedThreadKey(candidateKey);
    if (parsed?.threadId === directThreadKey) {
      return candidateKey;
    }
  }

  return directThreadKey;
}

function terminalEventBufferKey(threadRef: ScopedThreadRef, terminalId: string): string {
  return `${terminalThreadKey(threadRef)}\u0000${terminalId}`;
}

function copyTerminalGroups(groups: ThreadTerminalGroup[]): ThreadTerminalGroup[] {
  return groups.map((group) => ({
    id: group.id,
    terminalIds: [...group.terminalIds],
  }));
}

function appendTerminalEventEntry(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  nextTerminalEventId: number,
  threadRef: ScopedThreadRef,
  event: TerminalEvent,
) {
  const key = terminalEventBufferKey(threadRef, event.terminalId);
  const currentEntries = terminalEventEntriesByKey[key] ?? EMPTY_TERMINAL_EVENT_ENTRIES;
  const nextEntry: TerminalEventEntry = {
    id: nextTerminalEventId,
    event,
  };
  const nextEntries =
    currentEntries.length >= MAX_TERMINAL_EVENT_BUFFER
      ? [...currentEntries.slice(1), nextEntry]
      : [...currentEntries, nextEntry];

  return {
    terminalEventEntriesByKey: {
      ...terminalEventEntriesByKey,
      [key]: nextEntries,
    },
    nextTerminalEventId: nextTerminalEventId + 1,
  };
}

function launchContextFromStartEvent(
  event: Extract<TerminalEvent, { type: "started" | "restarted" }>,
): ThreadTerminalLaunchContext {
  return {
    cwd: event.snapshot.cwd,
    worktreePath: event.snapshot.worktreePath,
  };
}

function upsertTerminalIntoGroups(
  state: ThreadTerminalState,
  terminalId: string,
  mode: "split" | "new",
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!isValidTerminalId(terminalId)) {
    return normalized;
  }

  const isNewTerminal = !normalized.terminalIds.includes(terminalId);
  const terminalIds = isNewTerminal
    ? [...normalized.terminalIds, terminalId]
    : normalized.terminalIds;
  const terminalGroups = copyTerminalGroups(normalized.terminalGroups);

  const existingGroupIndex = findGroupIndexByTerminalId(terminalGroups, terminalId);
  if (existingGroupIndex >= 0) {
    terminalGroups[existingGroupIndex]!.terminalIds = terminalGroups[
      existingGroupIndex
    ]!.terminalIds.filter((id) => id !== terminalId);
    if (terminalGroups[existingGroupIndex]!.terminalIds.length === 0) {
      terminalGroups.splice(existingGroupIndex, 1);
    }
  }

  if (mode === "new") {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(fallbackGroupId(terminalId), usedGroupIds);
    terminalGroups.push({ id: nextGroupId, terminalIds: [terminalId] });
    return normalizeThreadTerminalState({
      ...normalized,
      terminalOpen: true,
      terminalIds,
      activeTerminalId: terminalId,
      terminalGroups,
      activeTerminalGroupId: nextGroupId,
    });
  }

  let activeGroupIndex = terminalGroups.findIndex(
    (group) => group.id === normalized.activeTerminalGroupId,
  );
  if (activeGroupIndex < 0) {
    activeGroupIndex = findGroupIndexByTerminalId(terminalGroups, normalized.activeTerminalId);
  }
  if (activeGroupIndex < 0) {
    const usedGroupIds = new Set(terminalGroups.map((group) => group.id));
    const nextGroupId = assignUniqueGroupId(
      fallbackGroupId(normalized.activeTerminalId),
      usedGroupIds,
    );
    terminalGroups.push({ id: nextGroupId, terminalIds: [normalized.activeTerminalId] });
    activeGroupIndex = terminalGroups.length - 1;
  }

  const destinationGroup = terminalGroups[activeGroupIndex];
  if (!destinationGroup) {
    return normalized;
  }

  if (
    isNewTerminal &&
    !destinationGroup.terminalIds.includes(terminalId) &&
    destinationGroup.terminalIds.length >= MAX_TERMINALS_PER_GROUP
  ) {
    return normalized;
  }

  if (!destinationGroup.terminalIds.includes(terminalId)) {
    const anchorIndex = destinationGroup.terminalIds.indexOf(normalized.activeTerminalId);
    if (anchorIndex >= 0) {
      destinationGroup.terminalIds.splice(anchorIndex + 1, 0, terminalId);
    } else {
      destinationGroup.terminalIds.push(terminalId);
    }
  }

  return normalizeThreadTerminalState({
    ...normalized,
    terminalOpen: true,
    terminalIds,
    activeTerminalId: terminalId,
    terminalGroups,
    activeTerminalGroupId: destinationGroup.id,
  });
}

function setThreadTerminalOpen(state: ThreadTerminalState, open: boolean): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (normalized.terminalOpen === open) return normalized;
  return { ...normalized, terminalOpen: open };
}

function setThreadTerminalHeight(state: ThreadTerminalState, height: number): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!Number.isFinite(height) || height <= 0 || normalized.terminalHeight === height) {
    return normalized;
  }
  return { ...normalized, terminalHeight: height };
}

function splitThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "split");
}

function newThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  return upsertTerminalIntoGroups(state, terminalId, "new");
}

function setThreadActiveTerminal(
  state: ThreadTerminalState,
  terminalId: string,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const activeTerminalGroupId =
    normalized.terminalGroups.find((group) => group.terminalIds.includes(terminalId))?.id ??
    normalized.activeTerminalGroupId;
  if (
    normalized.activeTerminalId === terminalId &&
    normalized.activeTerminalGroupId === activeTerminalGroupId
  ) {
    return normalized;
  }
  return {
    ...normalized,
    activeTerminalId: terminalId,
    activeTerminalGroupId,
  };
}

function closeThreadTerminal(state: ThreadTerminalState, terminalId: string): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }

  const remainingTerminalIds = normalized.terminalIds.filter((id) => id !== terminalId);
  if (remainingTerminalIds.length === 0) {
    return createDefaultThreadTerminalState();
  }

  const closedTerminalIndex = normalized.terminalIds.indexOf(terminalId);
  const nextActiveTerminalId =
    normalized.activeTerminalId === terminalId
      ? (remainingTerminalIds[Math.min(closedTerminalIndex, remainingTerminalIds.length - 1)] ??
        remainingTerminalIds[0] ??
        DEFAULT_THREAD_TERMINAL_ID)
      : normalized.activeTerminalId;

  const terminalGroups = normalized.terminalGroups
    .map((group) => ({
      ...group,
      terminalIds: group.terminalIds.filter((id) => id !== terminalId),
    }))
    .filter((group) => group.terminalIds.length > 0);

  const nextActiveTerminalGroupId =
    terminalGroups.find((group) => group.terminalIds.includes(nextActiveTerminalId))?.id ??
    terminalGroups[0]?.id ??
    fallbackGroupId(nextActiveTerminalId);

  return normalizeThreadTerminalState({
    terminalOpen: normalized.terminalOpen,
    terminalHeight: normalized.terminalHeight,
    terminalIds: remainingTerminalIds,
    runningTerminalIds: normalized.runningTerminalIds.filter((id) => id !== terminalId),
    activeTerminalId: nextActiveTerminalId,
    terminalGroups,
    activeTerminalGroupId: nextActiveTerminalGroupId,
  });
}

function setThreadTerminalActivity(
  state: ThreadTerminalState,
  terminalId: string,
  hasRunningSubprocess: boolean,
): ThreadTerminalState {
  const normalized = normalizeThreadTerminalState(state);
  if (!normalized.terminalIds.includes(terminalId)) {
    return normalized;
  }
  const alreadyRunning = normalized.runningTerminalIds.includes(terminalId);
  if (hasRunningSubprocess === alreadyRunning) {
    return normalized;
  }
  const runningTerminalIds = new Set(normalized.runningTerminalIds);
  if (hasRunningSubprocess) {
    runningTerminalIds.add(terminalId);
  } else {
    runningTerminalIds.delete(terminalId);
  }
  return { ...normalized, runningTerminalIds: [...runningTerminalIds] };
}

export function selectThreadTerminalState(
  terminalStateByThreadKey: Record<string, ThreadTerminalState>,
  threadRef: ScopedThreadRef | ThreadId | null | undefined,
): ThreadTerminalState {
  if (!threadRef) {
    return getDefaultThreadTerminalState();
  }
  if (typeof threadRef === "string") {
    if (threadRef.length === 0) {
      return getDefaultThreadTerminalState();
    }
    const directState = terminalStateByThreadKey[threadRef];
    if (directState) {
      return directState;
    }
    const matchedEntry = Object.entries(terminalStateByThreadKey).find(([threadKey]) => {
      const parsed = parseScopedThreadKey(threadKey);
      return parsed?.threadId === threadRef;
    });
    return matchedEntry?.[1] ?? getDefaultThreadTerminalState();
  }
  if (threadRef.threadId.length === 0) {
    return getDefaultThreadTerminalState();
  }
  return terminalStateByThreadKey[terminalThreadKey(threadRef)] ?? getDefaultThreadTerminalState();
}

export function selectThreadTerminalLaunchContext(
  terminalLaunchContextByThreadKey: Record<string, ThreadTerminalLaunchContext>,
  threadRef: ScopedThreadRef | ThreadId | null | undefined,
): ThreadTerminalLaunchContext | null {
  if (!threadRef) {
    return null;
  }
  if (typeof threadRef === "string") {
    if (threadRef.length === 0) {
      return null;
    }
    const directContext = terminalLaunchContextByThreadKey[threadRef];
    if (directContext) {
      return directContext;
    }
    const matchedEntry = Object.entries(terminalLaunchContextByThreadKey).find(([threadKey]) => {
      const parsed = parseScopedThreadKey(threadKey);
      return parsed?.threadId === threadRef;
    });
    return matchedEntry?.[1] ?? null;
  }
  if (threadRef.threadId.length === 0) {
    return null;
  }
  return terminalLaunchContextByThreadKey[terminalThreadKey(threadRef)] ?? null;
}

function updateTerminalStateByThreadKey(
  terminalStateByThreadKey: Record<string, ThreadTerminalState>,
  threadRef: TerminalThreadRef,
  updater: (state: ThreadTerminalState) => ThreadTerminalState,
): Record<string, ThreadTerminalState> {
  if (typeof threadRef !== "string" && threadRef.threadId.length === 0) {
    return terminalStateByThreadKey;
  }

  const threadKey = terminalThreadKey(threadRef, Object.keys(terminalStateByThreadKey));
  const current = selectThreadTerminalState(terminalStateByThreadKey, threadRef);
  const next = updater(current);
  if (next === current) {
    return terminalStateByThreadKey;
  }

  if (isDefaultThreadTerminalState(next)) {
    if (terminalStateByThreadKey[threadKey] === undefined) {
      return terminalStateByThreadKey;
    }
    const { [threadKey]: _removed, ...rest } = terminalStateByThreadKey;
    return rest;
  }

  return {
    ...terminalStateByThreadKey,
    [threadKey]: next,
  };
}

export function selectTerminalEventEntries(
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>,
  threadRef: ScopedThreadRef | null | undefined,
  terminalId: string,
): ReadonlyArray<TerminalEventEntry> {
  if (!threadRef || threadRef.threadId.length === 0 || terminalId.trim().length === 0) {
    return EMPTY_TERMINAL_EVENT_ENTRIES;
  }
  return (
    terminalEventEntriesByKey[terminalEventBufferKey(threadRef, terminalId)] ??
    EMPTY_TERMINAL_EVENT_ENTRIES
  );
}

interface TerminalStateStoreState {
  terminalStateByThreadKey: Record<string, ThreadTerminalState>;
  readonly terminalStateByThreadId: Record<string, ThreadTerminalState>;
  terminalLaunchContextByThreadKey: Record<string, ThreadTerminalLaunchContext>;
  readonly terminalLaunchContextByThreadId: Record<string, ThreadTerminalLaunchContext>;
  terminalEventEntriesByKey: Record<string, ReadonlyArray<TerminalEventEntry>>;
  nextTerminalEventId: number;
  setTerminalOpen: (threadRef: TerminalThreadRef, open: boolean) => void;
  setTerminalHeight: (threadRef: TerminalThreadRef, height: number) => void;
  splitTerminal: (threadRef: TerminalThreadRef, terminalId: string) => void;
  newTerminal: (threadRef: TerminalThreadRef, terminalId: string) => void;
  ensureTerminal: (
    threadRef: TerminalThreadRef,
    terminalId: string,
    options?: { open?: boolean; active?: boolean },
  ) => void;
  setActiveTerminal: (threadRef: TerminalThreadRef, terminalId: string) => void;
  closeTerminal: (threadRef: TerminalThreadRef, terminalId: string) => void;
  setTerminalLaunchContext: (
    threadRef: TerminalThreadRef,
    context: ThreadTerminalLaunchContext,
  ) => void;
  clearTerminalLaunchContext: (threadRef: TerminalThreadRef) => void;
  setTerminalActivity: (
    threadRef: TerminalThreadRef,
    terminalId: string,
    hasRunningSubprocess: boolean,
  ) => void;
  recordTerminalEvent: (threadRef: ScopedThreadRef, event: TerminalEvent) => void;
  applyTerminalEvent: (threadRef: ScopedThreadRef, event: TerminalEvent) => void;
  clearTerminalState: (threadRef: TerminalThreadRef) => void;
  removeTerminalState: (threadRef: TerminalThreadRef) => void;
  removeOrphanedTerminalStates: (activeThreadKeys: Set<string>) => void;
}

export const useTerminalStateStore = create<TerminalStateStoreState>()(
  persist(
    (set) => {
      const updateTerminal = (
        threadRef: TerminalThreadRef,
        updater: (state: ThreadTerminalState) => ThreadTerminalState,
      ) => {
        set((state) => {
          const nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
            state.terminalStateByThreadKey,
            threadRef,
            updater,
          );
          if (nextTerminalStateByThreadKey === state.terminalStateByThreadKey) {
            return state;
          }
          return {
            terminalStateByThreadKey: nextTerminalStateByThreadKey,
          };
        });
      };

      return {
        terminalStateByThreadKey: {},
        get terminalStateByThreadId() {
          return Object.fromEntries(
            Object.entries(this.terminalStateByThreadKey).map(([threadKey, state]) => [
              parseScopedThreadKey(threadKey)?.threadId ?? threadKey,
              state,
            ]),
          ) as Record<string, ThreadTerminalState>;
        },
        terminalLaunchContextByThreadKey: {},
        get terminalLaunchContextByThreadId() {
          return Object.fromEntries(
            Object.entries(this.terminalLaunchContextByThreadKey).map(([threadKey, context]) => [
              parseScopedThreadKey(threadKey)?.threadId ?? threadKey,
              context,
            ]),
          ) as Record<string, ThreadTerminalLaunchContext>;
        },
        terminalEventEntriesByKey: {},
        nextTerminalEventId: 1,
        setTerminalOpen: (threadRef, open) =>
          updateTerminal(threadRef, (state) => setThreadTerminalOpen(state, open)),
        setTerminalHeight: (threadRef, height) =>
          updateTerminal(threadRef, (state) => setThreadTerminalHeight(state, height)),
        splitTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => splitThreadTerminal(state, terminalId)),
        newTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => newThreadTerminal(state, terminalId)),
        ensureTerminal: (threadRef, terminalId, options) =>
          updateTerminal(threadRef, (state) => {
            let nextState = state;
            if (!state.terminalIds.includes(terminalId)) {
              nextState = newThreadTerminal(nextState, terminalId);
            }
            if (options?.active === false) {
              nextState = {
                ...nextState,
                activeTerminalId: state.activeTerminalId,
                activeTerminalGroupId: state.activeTerminalGroupId,
              };
            }
            if (options?.active ?? true) {
              nextState = setThreadActiveTerminal(nextState, terminalId);
            }
            if (options?.open) {
              nextState = setThreadTerminalOpen(nextState, true);
            }
            return normalizeThreadTerminalState(nextState);
          }),
        setActiveTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => setThreadActiveTerminal(state, terminalId)),
        closeTerminal: (threadRef, terminalId) =>
          updateTerminal(threadRef, (state) => closeThreadTerminal(state, terminalId)),
        setTerminalLaunchContext: (threadRef, context) =>
          set((state) => {
            const threadKey = terminalThreadKey(
              threadRef,
              Object.keys(state.terminalLaunchContextByThreadKey),
            );
            return {
              terminalLaunchContextByThreadKey: {
                ...state.terminalLaunchContextByThreadKey,
                [threadKey]: context,
              },
            };
          }),
        clearTerminalLaunchContext: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(
              threadRef,
              Object.keys(state.terminalLaunchContextByThreadKey),
            );
            if (!state.terminalLaunchContextByThreadKey[threadKey]) {
              return state;
            }
            const { [threadKey]: _removed, ...rest } = state.terminalLaunchContextByThreadKey;
            return { terminalLaunchContextByThreadKey: rest };
          }),
        setTerminalActivity: (threadRef, terminalId, hasRunningSubprocess) =>
          updateTerminal(threadRef, (state) =>
            setThreadTerminalActivity(state, terminalId, hasRunningSubprocess),
          ),
        recordTerminalEvent: (threadRef, event) =>
          set((state) =>
            appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              threadRef,
              event,
            ),
          ),
        applyTerminalEvent: (threadRef, event) =>
          set((state) => {
            const threadKey = terminalThreadKey(
              threadRef,
              Object.keys(state.terminalLaunchContextByThreadKey),
            );
            let nextTerminalStateByThreadKey = state.terminalStateByThreadKey;
            let nextTerminalLaunchContextByThreadKey = state.terminalLaunchContextByThreadKey;

            if (event.type === "started" || event.type === "restarted") {
              nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
                nextTerminalStateByThreadKey,
                threadRef,
                (current) => {
                  let nextState = current;
                  if (!current.terminalIds.includes(event.terminalId)) {
                    nextState = newThreadTerminal(nextState, event.terminalId);
                  }
                  nextState = setThreadActiveTerminal(nextState, event.terminalId);
                  nextState = setThreadTerminalOpen(nextState, true);
                  return normalizeThreadTerminalState(nextState);
                },
              );
              nextTerminalLaunchContextByThreadKey = {
                ...nextTerminalLaunchContextByThreadKey,
                [threadKey]: launchContextFromStartEvent(event),
              };
            }

            const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
            if (hasRunningSubprocess !== null) {
              nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
                nextTerminalStateByThreadKey,
                threadRef,
                (current) =>
                  setThreadTerminalActivity(current, event.terminalId, hasRunningSubprocess),
              );
            }

            const nextEventState = appendTerminalEventEntry(
              state.terminalEventEntriesByKey,
              state.nextTerminalEventId,
              threadRef,
              event,
            );

            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextTerminalLaunchContextByThreadKey,
              ...nextEventState,
            };
          }),
        clearTerminalState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef, [
              ...Object.keys(state.terminalStateByThreadKey),
              ...Object.keys(state.terminalLaunchContextByThreadKey),
            ]);
            const nextTerminalStateByThreadKey = updateTerminalStateByThreadKey(
              state.terminalStateByThreadKey,
              threadRef,
              () => createDefaultThreadTerminalState(),
            );
            const hadLaunchContext =
              state.terminalLaunchContextByThreadKey[threadKey] !== undefined;
            const { [threadKey]: _removed, ...remainingLaunchContexts } =
              state.terminalLaunchContextByThreadKey;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${threadKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              nextTerminalStateByThreadKey === state.terminalStateByThreadKey &&
              !hadLaunchContext &&
              !removedEventEntries
            ) {
              return state;
            }
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: remainingLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeTerminalState: (threadRef) =>
          set((state) => {
            const threadKey = terminalThreadKey(threadRef, [
              ...Object.keys(state.terminalStateByThreadKey),
              ...Object.keys(state.terminalLaunchContextByThreadKey),
            ]);
            const hadTerminalState = state.terminalStateByThreadKey[threadKey] !== undefined;
            const hadLaunchContext =
              state.terminalLaunchContextByThreadKey[threadKey] !== undefined;
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              if (key.startsWith(`${threadKey}\u0000`)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (!hadTerminalState && !hadLaunchContext && !removedEventEntries) {
              return state;
            }
            const nextTerminalStateByThreadKey = { ...state.terminalStateByThreadKey };
            delete nextTerminalStateByThreadKey[threadKey];
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            delete nextLaunchContexts[threadKey];
            return {
              terminalStateByThreadKey: nextTerminalStateByThreadKey,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
        removeOrphanedTerminalStates: (activeThreadKeys) =>
          set((state) => {
            const orphanedIds = Object.keys(state.terminalStateByThreadKey).filter(
              (key) => !activeThreadKeys.has(key),
            );
            const orphanedLaunchContextIds = Object.keys(
              state.terminalLaunchContextByThreadKey,
            ).filter((key) => !activeThreadKeys.has(key));
            const nextTerminalEventEntriesByKey = { ...state.terminalEventEntriesByKey };
            let removedEventEntries = false;
            for (const key of Object.keys(nextTerminalEventEntriesByKey)) {
              const [threadKey] = key.split("\u0000");
              if (threadKey && !activeThreadKeys.has(threadKey)) {
                delete nextTerminalEventEntriesByKey[key];
                removedEventEntries = true;
              }
            }
            if (
              orphanedIds.length === 0 &&
              orphanedLaunchContextIds.length === 0 &&
              !removedEventEntries
            ) {
              return state;
            }
            const next = { ...state.terminalStateByThreadKey };
            for (const id of orphanedIds) {
              delete next[id];
            }
            const nextLaunchContexts = { ...state.terminalLaunchContextByThreadKey };
            for (const id of orphanedLaunchContextIds) {
              delete nextLaunchContexts[id];
            }
            return {
              terminalStateByThreadKey: next,
              terminalLaunchContextByThreadKey: nextLaunchContexts,
              terminalEventEntriesByKey: nextTerminalEventEntriesByKey,
            };
          }),
      };
    },
    {
      name: TERMINAL_STATE_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(createTerminalStateStorage),
      migrate: migratePersistedTerminalStateStoreState,
      partialize: (state) => ({
        terminalStateByThreadKey: state.terminalStateByThreadKey,
      }),
    },
  ),
);
