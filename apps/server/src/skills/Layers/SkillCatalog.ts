import * as NodePath from "node:path";
import * as OS from "node:os";
import {
  SkillCatalogError,
  type SkillCatalogEntry,
  type SkillCatalogSource,
  type SkillCatalogWarning,
} from "@t3tools/contracts";
import { Cache, Data, Duration, Effect, Exit, FileSystem, Layer } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { SkillCatalog, type SkillCatalogShape } from "../Services/SkillCatalog.ts";

const SKILL_CATALOG_CACHE_CAPACITY = 8;
const SKILL_CATALOG_CACHE_TTL = Duration.seconds(15);

const SOURCE_KIND_ORDER: Record<SkillCatalogSource["kind"], number> = {
  agents: 0,
  codex: 1,
  plugin: 2,
};

export interface SkillCatalogRootSpec {
  readonly kind: SkillCatalogSource["kind"];
  readonly label: string;
  readonly path: string;
}

interface SkillCatalogScanRecord {
  readonly name: string;
  readonly description: string;
  readonly source: SkillCatalogSource;
}

class SkillCatalogManifestParseError extends Data.TaggedError("SkillCatalogManifestParseError")<{
  readonly cause: unknown;
}> {}

function normalizeRootPathForMatch(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function normalizeSkillCatalogName(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeSkillCatalogDescription(description: string): string {
  return description.trim().replace(/\s+/g, " ");
}

function trimMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function slugifySkillCatalogIdPart(value: string): string {
  const normalized = normalizeSkillCatalogName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "skill";
}

function resolveDirectoryEntryPath(rootPath: string, entryPath: string): string {
  return NodePath.isAbsolute(entryPath) ? entryPath : NodePath.join(rootPath, entryPath);
}

function sourceSortKey(source: SkillCatalogSource): [number, string, string] {
  return [SOURCE_KIND_ORDER[source.kind], source.label.toLowerCase(), source.path.toLowerCase()];
}

function sortSkillCatalogSources(
  sources: ReadonlyArray<SkillCatalogSource>,
): ReadonlyArray<SkillCatalogSource> {
  return [...sources].toSorted((left, right) => {
    const leftKey = sourceSortKey(left);
    const rightKey = sourceSortKey(right);
    return (
      leftKey[0] - rightKey[0] ||
      leftKey[1].localeCompare(rightKey[1]) ||
      leftKey[2].localeCompare(rightKey[2])
    );
  });
}

function mergeSkillCatalogSources(
  sources: ReadonlyArray<SkillCatalogSource>,
): ReadonlyArray<SkillCatalogSource> {
  const unique = new Map<string, SkillCatalogSource>();
  for (const source of sources) {
    unique.set(`${source.kind}\u001f${source.label}\u001f${source.path}`, source);
  }
  return sortSkillCatalogSources([...unique.values()]);
}

function buildSkillCatalogWarning(
  kind: SkillCatalogWarning["kind"],
  pathValue: string,
  message: string,
): SkillCatalogWarning {
  return {
    kind,
    path: pathValue,
    message: message.trim(),
  };
}

function finalizeIdCollision(baseId: string, fallbackLabel: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }
  const fallbackId = `${baseId}-${slugifySkillCatalogIdPart(fallbackLabel)}`;
  if (!usedIds.has(fallbackId)) {
    usedIds.add(fallbackId);
    return fallbackId;
  }
  let suffix = 2;
  for (;;) {
    const nextId = `${fallbackId}-${suffix}`;
    if (!usedIds.has(nextId)) {
      usedIds.add(nextId);
      return nextId;
    }
    suffix += 1;
  }
}

function primarySourceKind(entry: Pick<SkillCatalogEntry, "sources">): SkillCatalogSource["kind"] {
  return sortSkillCatalogSources(entry.sources)[0]?.kind ?? "plugin";
}

export function resolveSkillCatalogCodexHome(input: {
  readonly settingsHomePath: string;
  readonly envCodexHome: string | undefined;
  readonly homeDir: string;
}): string {
  const configuredHome = input.settingsHomePath.trim();
  if (configuredHome.length > 0) {
    return configuredHome;
  }
  const envHome = input.envCodexHome?.trim();
  if (envHome && envHome.length > 0) {
    return envHome;
  }
  return NodePath.join(input.homeDir, ".codex");
}

export function buildSkillCatalogRootSpecs(input: {
  readonly userProfile: string;
  readonly codexHome: string;
}): SkillCatalogRootSpec[] {
  return [
    {
      kind: "agents",
      label: "Agents",
      path: NodePath.join(input.userProfile, ".agents", "skills"),
    },
    {
      kind: "agents",
      label: "Agents · gstack",
      path: NodePath.join(input.userProfile, ".agents", "skills", "gstack"),
    },
    {
      kind: "agents",
      label: "Agents · openclaw",
      path: NodePath.join(input.userProfile, ".agents", "skills", "gstack", "openclaw", "skills"),
    },
    {
      kind: "codex",
      label: "Codex",
      path: NodePath.join(input.codexHome, "skills"),
    },
    {
      kind: "codex",
      label: "Codex · system",
      path: NodePath.join(input.codexHome, "skills", ".system"),
    },
  ];
}

function parseYamlBlockValue(lines: ReadonlyArray<string>, startIndex: number) {
  const blockLines: string[] = [];
  let blockIndent: number | null = null;
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      if (blockIndent !== null) {
        blockLines.push("");
      }
      index += 1;
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (blockIndent === null) {
      if (indent === 0) {
        break;
      }
      blockIndent = indent;
    }

    if (indent < blockIndent) {
      break;
    }

    blockLines.push(line.slice(blockIndent));
    index += 1;
  }

  return {
    nextIndex: index,
    value: normalizeSkillCatalogDescription(blockLines.join("\n")),
  };
}

export function parseSkillFrontMatter(content: string): {
  readonly name: string | null;
  readonly description: string | null;
} {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { name: null, description: null };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex < 0) {
    return { name: null, description: null };
  }

  const frontMatterLines = lines.slice(1, closingIndex);
  let name: string | null = null;
  let description: string | null = null;

  for (let index = 0; index < frontMatterLines.length; index += 1) {
    const line = frontMatterLines[index]?.trimStart() ?? "";
    const nameMatch = /^name:\s*(.+)$/.exec(line);
    if (nameMatch?.[1]) {
      const parsedName = trimMatchingQuotes(nameMatch[1]);
      name = parsedName.length > 0 ? parsedName : null;
      continue;
    }

    const descriptionMatch = /^description:\s*(.*)$/.exec(line);
    if (!descriptionMatch) {
      continue;
    }

    const descriptionValue = descriptionMatch[1]?.trim() ?? "";
    if (descriptionValue === "|") {
      const blockValue = parseYamlBlockValue(frontMatterLines, index + 1);
      description = blockValue.value;
      index = blockValue.nextIndex - 1;
      continue;
    }

    description = normalizeSkillCatalogDescription(trimMatchingQuotes(descriptionValue));
  }

  return {
    name,
    description,
  };
}

export function mergeSkillCatalogRecords(
  records: ReadonlyArray<SkillCatalogScanRecord>,
): SkillCatalogEntry[] {
  const groupsByName = new Map<string, SkillCatalogScanRecord[]>();
  for (const record of records) {
    const normalizedName = normalizeSkillCatalogName(record.name);
    const existing = groupsByName.get(normalizedName) ?? [];
    existing.push(record);
    groupsByName.set(normalizedName, existing);
  }

  const usedIds = new Set<string>();
  const entries: SkillCatalogEntry[] = [];

  for (const recordsForName of groupsByName.values()) {
    const groupsByDescription = new Map<string, SkillCatalogScanRecord[]>();
    for (const record of recordsForName) {
      const normalizedDescription = normalizeSkillCatalogDescription(record.description);
      const existing = groupsByDescription.get(normalizedDescription) ?? [];
      existing.push(record);
      groupsByDescription.set(normalizedDescription, existing);
    }

    const hasConflictingDescriptions = groupsByDescription.size > 1;
    for (const recordsForDescription of groupsByDescription.values()) {
      const firstRecord = recordsForDescription[0];
      if (!firstRecord) {
        continue;
      }
      const sources = mergeSkillCatalogSources(
        recordsForDescription.map((record) => record.source),
      );
      const entryBaseId = slugifySkillCatalogIdPart(firstRecord.name);
      const conflictSuffix = primarySourceKind({ sources });
      const id = hasConflictingDescriptions
        ? finalizeIdCollision(
            `${entryBaseId}-${conflictSuffix}`,
            sources[0]?.label ?? firstRecord.name,
            usedIds,
          )
        : finalizeIdCollision(entryBaseId, firstRecord.name, usedIds);

      entries.push({
        id,
        name: firstRecord.name,
        description: firstRecord.description,
        sources,
      });
    }
  }

  return entries.toSorted((left, right) => {
    const leftKind = SOURCE_KIND_ORDER[primarySourceKind(left)];
    const rightKind = SOURCE_KIND_ORDER[primarySourceKind(right)];
    return (
      leftKind - rightKind ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id)
    );
  });
}

const readPluginManifestSkillRootSpecs = Effect.fn("readPluginManifestSkillRootSpecs")(function* (
  codexHome: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const pluginCacheRoot = NodePath.join(codexHome, "plugins", "cache");
  if (!(yield* fileSystem.exists(pluginCacheRoot).pipe(Effect.orElseSucceed(() => false)))) {
    return {
      roots: [],
      warnings: [],
    };
  }

  const pluginCacheEntries = yield* fileSystem
    .readDirectory(pluginCacheRoot, { recursive: true })
    .pipe(
      Effect.map((entries) =>
        entries.filter((entry) => {
          const normalized = normalizeRootPathForMatch(entry);
          return (
            normalized === ".codex-plugin/plugin.json" ||
            normalized.endsWith("/.codex-plugin/plugin.json")
          );
        }),
      ),
      Effect.catch((cause) =>
        Effect.succeed(
          buildSkillCatalogWarning(
            "root-unreadable",
            pluginCacheRoot,
            cause instanceof Error
              ? cause.message
              : "Failed to scan the Codex plugin cache for skill manifests.",
          ),
        ),
      ),
    );

  const roots: SkillCatalogRootSpec[] = [];
  const warnings: SkillCatalogWarning[] = [];

  if (!Array.isArray(pluginCacheEntries)) {
    warnings.push(pluginCacheEntries);
    return { roots, warnings };
  }

  for (const manifestEntry of pluginCacheEntries.toSorted()) {
    const manifestPath = resolveDirectoryEntryPath(pluginCacheRoot, manifestEntry);
    const manifestRaw = yield* fileSystem.readFileString(manifestPath).pipe(
      Effect.catch((cause) => {
        warnings.push(
          buildSkillCatalogWarning(
            "plugin-manifest-invalid",
            manifestPath,
            cause instanceof Error ? cause.message : "Failed to read plugin manifest.",
          ),
        );
        return Effect.succeed(null);
      }),
    );
    if (manifestRaw === null) {
      continue;
    }

    const manifest = yield* Effect.try({
      try: () => JSON.parse(manifestRaw) as Record<string, unknown>,
      catch: (cause) => new SkillCatalogManifestParseError({ cause }),
    }).pipe(
      Effect.catch((error) => {
        warnings.push(
          buildSkillCatalogWarning(
            "plugin-manifest-invalid",
            manifestPath,
            error.cause instanceof Error ? error.cause.message : "Invalid plugin manifest JSON.",
          ),
        );
        return Effect.succeed(null);
      }),
    );
    if (manifest === null) {
      continue;
    }

    const rawSkillsPath =
      typeof manifest.skills === "string" ? trimMatchingQuotes(manifest.skills) : "";
    if (rawSkillsPath.length === 0) {
      warnings.push(
        buildSkillCatalogWarning(
          "plugin-manifest-invalid",
          manifestPath,
          "Plugin manifest is missing a valid skills path.",
        ),
      );
      continue;
    }

    const pluginRoot = NodePath.dirname(NodePath.dirname(manifestPath));
    const manifestInterface =
      manifest.interface && typeof manifest.interface === "object"
        ? (manifest.interface as Record<string, unknown>)
        : null;
    const pluginDisplayName =
      typeof manifestInterface?.displayName === "string"
        ? trimMatchingQuotes((manifestInterface.displayName as string | undefined) ?? "")
        : typeof manifest.name === "string"
          ? trimMatchingQuotes(manifest.name)
          : NodePath.basename(pluginRoot);

    roots.push({
      kind: "plugin",
      label: `Plugin · ${pluginDisplayName || NodePath.basename(pluginRoot)}`,
      path: NodePath.resolve(pluginRoot, rawSkillsPath),
    });
  }

  return { roots, warnings };
});

const scanSkillCatalogRoot = Effect.fn("scanSkillCatalogRoot")(function* (
  root: SkillCatalogRootSpec,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  if (!(yield* fileSystem.exists(root.path).pipe(Effect.orElseSucceed(() => false)))) {
    return {
      records: [],
      warnings: [],
    };
  }

  const rootEntries = yield* fileSystem
    .readDirectory(root.path, { recursive: false })
    .pipe(
      Effect.catch((cause) =>
        Effect.succeed(
          buildSkillCatalogWarning(
            "root-unreadable",
            root.path,
            cause instanceof Error ? cause.message : "Failed to read skill root.",
          ),
        ),
      ),
    );

  if (!Array.isArray(rootEntries)) {
    return {
      records: [],
      warnings: [rootEntries],
    };
  }

  const records: SkillCatalogScanRecord[] = [];
  const warnings: SkillCatalogWarning[] = [];

  for (const childEntry of rootEntries.toSorted()) {
    const childPath = resolveDirectoryEntryPath(root.path, childEntry);
    const childStats = yield* fileSystem.stat(childPath).pipe(Effect.orElseSucceed(() => null));
    if (childStats?.type !== "Directory") {
      continue;
    }

    const skillFilePath = NodePath.join(childPath, "SKILL.md");
    if (!(yield* fileSystem.exists(skillFilePath).pipe(Effect.orElseSucceed(() => false)))) {
      continue;
    }

    const skillFile = yield* fileSystem.readFileString(skillFilePath).pipe(
      Effect.catch((cause) => {
        warnings.push(
          buildSkillCatalogWarning(
            "root-unreadable",
            skillFilePath,
            cause instanceof Error ? cause.message : "Failed to read skill metadata.",
          ),
        );
        return Effect.succeed(null);
      }),
    );
    if (skillFile === null) {
      continue;
    }

    const metadata = parseSkillFrontMatter(skillFile);
    records.push({
      name: metadata.name ?? NodePath.basename(childPath),
      description: metadata.description ?? "",
      source: {
        kind: root.kind,
        label: root.label,
        path: childPath,
      },
    });
  }

  return { records, warnings };
});

const readSkillCatalog = Effect.fn("readSkillCatalog")(function* (codexHome: string) {
  const userProfile = process.env.USERPROFILE?.trim() || OS.homedir();
  const baseRoots = buildSkillCatalogRootSpecs({
    userProfile,
    codexHome,
  });
  const pluginRootsResult = yield* readPluginManifestSkillRootSpecs(codexHome);
  const scanRoots = [...baseRoots, ...pluginRootsResult.roots];
  const warnings: SkillCatalogWarning[] = [...pluginRootsResult.warnings];
  const records: SkillCatalogScanRecord[] = [];

  for (const root of scanRoots) {
    const rootResult = yield* scanSkillCatalogRoot(root);
    warnings.push(...rootResult.warnings);
    records.push(...rootResult.records);
  }

  return {
    entries: mergeSkillCatalogRecords(records),
    warnings,
  };
});

const makeSkillCatalog = Effect.gen(function* () {
  const serverSettings = yield* ServerSettingsService;
  const catalogCache = yield* Cache.makeWith(readSkillCatalog, {
    capacity: SKILL_CATALOG_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? SKILL_CATALOG_CACHE_TTL : Duration.zero),
  });

  const getCatalog: SkillCatalogShape["getCatalog"] = serverSettings.getSettings.pipe(
    Effect.map((settings) =>
      resolveSkillCatalogCodexHome({
        settingsHomePath: settings.providers.codex.homePath,
        envCodexHome: process.env.CODEX_HOME,
        homeDir: OS.homedir(),
      }),
    ),
    Effect.flatMap((codexHome) => Cache.get(catalogCache, codexHome)),
    Effect.mapError(
      (cause) =>
        new SkillCatalogError({
          message:
            cause instanceof Error ? cause.message : "Failed to load the local skills catalog.",
          cause,
        }),
    ),
  );

  return {
    getCatalog,
  } satisfies SkillCatalogShape;
});

export const SkillCatalogLive = Layer.effect(SkillCatalog, makeSkillCatalog);
