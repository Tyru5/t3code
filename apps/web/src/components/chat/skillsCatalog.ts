import type {
  ProviderKind,
  SkillCatalogEntry,
  SkillCatalogResult,
  SkillCatalogSource,
  ThreadId,
} from "@t3tools/contracts";

export interface TransientSkillsCatalogCardState {
  id: string;
  threadId: ThreadId;
  createdAt: string;
  provider: ProviderKind;
  status: "loading" | "ready" | "error";
  result: SkillCatalogResult | null;
  errorMessage: string | null;
  isRefreshing: boolean;
}

export const SKILL_CATALOG_SOURCE_GROUP_LABELS: Record<SkillCatalogSource["kind"], string> = {
  agents: "Agents",
  codex: "Codex",
  plugin: "Plugins",
};

export function primarySkillCatalogSourceKind(
  entry: Pick<SkillCatalogEntry, "sources">,
): SkillCatalogSource["kind"] {
  return entry.sources[0]?.kind ?? "plugin";
}

export function filterSkillCatalogEntries(
  entries: ReadonlyArray<SkillCatalogEntry>,
  query: string,
): SkillCatalogEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [...entries];
  }

  return entries.filter((entry) => {
    const haystack = [entry.name, entry.description, ...entry.sources.map((source) => source.label)]
      .join("\n")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function groupSkillCatalogEntries(entries: ReadonlyArray<SkillCatalogEntry>) {
  const grouped = new Map<SkillCatalogSource["kind"], SkillCatalogEntry[]>();
  for (const entry of entries) {
    const kind = primarySkillCatalogSourceKind(entry);
    const existing = grouped.get(kind) ?? [];
    existing.push(entry);
    grouped.set(kind, existing);
  }

  return (["agents", "codex", "plugin"] as const).flatMap((kind) => {
    const groupEntries = grouped.get(kind);
    if (!groupEntries || groupEntries.length === 0) {
      return [];
    }
    return [
      {
        kind,
        label: SKILL_CATALOG_SOURCE_GROUP_LABELS[kind],
        entries: groupEntries,
      },
    ];
  });
}
