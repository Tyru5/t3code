import type { ServerProviderSkill } from "@t3tools/contracts";

export interface IrisWorkflowSkillEntry {
  id: string;
  name: string;
  description: string;
  whyUseIt: string;
  isAvailableLocally: boolean;
}

interface CuratedIrisWorkflowSkillDefinition {
  name: string;
  description: string;
  whyUseIt: string;
}

const CURATED_IRIS_WORKFLOW_SKILLS: ReadonlyArray<CuratedIrisWorkflowSkillDefinition> = [
  {
    name: "iris-audit",
    description:
      "Audit code changes before shipping across rules, security, design, and code quality.",
    whyUseIt:
      "Use this before merge when you want a structured pre-ship check instead of manually reviewing the diff from scratch.",
  },
  {
    name: "iris-auto",
    description: "Run the full autonomous pipeline from spec through QA and shipping.",
    whyUseIt:
      "Use this when you want the job taken end-to-end without handholding each intermediate workflow.",
  },
  {
    name: "iris-clone",
    description:
      "Clone repositories from the tryiris-ai GitHub organization by repo name or category.",
    whyUseIt:
      "Use this when the repo you need is not on disk yet and you want the standard Iris source layout pulled down quickly.",
  },
  {
    name: "iris-debug",
    description:
      "Build Iris locally, run targeted repros, and investigate failing tests or reported bugs.",
    whyUseIt:
      "Use this when a bug needs an actual repro and root-cause analysis, not just static code inspection.",
  },
  {
    name: "iris-handoff",
    description:
      "Package a PM spec, plan, and optional diff into a structured engineering handoff.",
    whyUseIt:
      "Use this when product work is ready for engineering pickup and you want a consistent handoff artifact instead of ad hoc notes.",
  },
  {
    name: "iris-install",
    description:
      "Install standardized `AGENTS.md` and `CLAUDE.md` templates into Iris repositories.",
    whyUseIt:
      "Use this when a repo is missing the team’s agent guidance and you want the baseline templates applied correctly.",
  },
  {
    name: "iris-learn",
    description:
      "Add or update repo or domain knowledge in the `ai.knowledge` repository on the contributions branch.",
    whyUseIt:
      "Use this when a decision, integration detail, or hard-won context should become shared knowledge for future agents.",
  },
  {
    name: "iris-load",
    description:
      "Load the Iris rules and knowledge indexes so the active session has the right repo context.",
    whyUseIt:
      "Use this at the start of Iris work when you need the current rules and knowledge in scope before making decisions.",
  },
  {
    name: "iris-migrate-pr",
    description:
      "Port a PR from a legacy Iris repo into the `platform` monorepo and reconcile path changes.",
    whyUseIt:
      "Use this when work already exists in an old repo and needs to be replayed into the monorepo without manual diff surgery.",
  },
  {
    name: "iris-onboard",
    description:
      "Set up a new engineer’s machine for the Iris AI workflow, tooling, and local knowledge repos.",
    whyUseIt:
      "Use this when someone needs a working Iris environment fast and you want to avoid missing a required setup step.",
  },
  {
    name: "iris-qa",
    description:
      "Run the full Iris test workflow, including unit, integration, and end-to-end coverage.",
    whyUseIt:
      "Use this after meaningful changes when you want the project’s intended validation path, not an incomplete spot check.",
  },
  {
    name: "iris-reflect",
    description:
      "Promote worthwhile learnings into `ai.knowledge` while filtering out low-signal noise.",
    whyUseIt:
      "Use this when you want the system to capture durable lessons from recent work instead of losing them after the session ends.",
  },
  {
    name: "iris-rule",
    description: "Add or update an explicit AI operating rule in the `ai.knowledge` repo.",
    whyUseIt:
      "Use this when an agent mistake or repeated edge case should be prevented with a concrete rule rather than remembered informally.",
  },
  {
    name: "iris-run",
    description:
      "Build and run the relevant Iris platform subsystem from the monorepo with context-aware defaults.",
    whyUseIt:
      "Use this when you need the actual app or subsystem running locally and want the repo-specific build/run path handled correctly.",
  },
  {
    name: "iris-ship",
    description:
      "Run the completed-job-definition workflow for shipping, including tests, reflection, review, and PR steps.",
    whyUseIt:
      "Use this when implementation is done and you want the standard Iris release checklist executed consistently.",
  },
  {
    name: "iris-spec",
    description:
      "Drive the guided spec-generation workflow for features, bugs, investigations, or design docs.",
    whyUseIt:
      "Use this when a task deserves a written spec and plan before coding starts, especially for ambiguous or multi-step work.",
  },
  {
    name: "iris-sync",
    description:
      "Sync the `ai.knowledge` contributions branch, resolve conflicts, push, and open a PR.",
    whyUseIt:
      "Use this when local knowledge or rule updates are ready to be submitted and you want the sync and PR flow handled cleanly.",
  },
] as const;

const CURATED_WORKFLOW_NAMES = new Set(
  CURATED_IRIS_WORKFLOW_SKILLS.map((definition) => definition.name),
);

function isIrisWorkflowSkillName(name: string): boolean {
  return name.startsWith("iris-");
}

function resolveSkillDescription(
  skill: Pick<ServerProviderSkill, "shortDescription" | "description">,
  fallback: string,
): string {
  const shortDescription = skill.shortDescription?.trim();
  if (shortDescription) {
    return shortDescription;
  }

  const description = skill.description?.trim();
  if (description) {
    return description;
  }

  return fallback;
}

function buildFallbackWhyUseIt(): string {
  return "Use this when you want the preconfigured Iris workflow for that task instead of stitching the steps together manually.";
}

function indexAvailableIrisSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): Map<string, ServerProviderSkill> {
  const indexedByName = new Map<string, ServerProviderSkill>();

  for (const skill of skills) {
    if (!skill.enabled) continue;

    const normalizedName = skill.name.trim().toLowerCase();
    if (!isIrisWorkflowSkillName(normalizedName)) continue;

    const existing = indexedByName.get(normalizedName);
    if (!existing) {
      indexedByName.set(normalizedName, skill);
      continue;
    }

    const existingHasShortDescription = Boolean(existing.shortDescription?.trim());
    const currentHasShortDescription = Boolean(skill.shortDescription?.trim());
    if (!existingHasShortDescription && currentHasShortDescription) {
      indexedByName.set(normalizedName, skill);
      continue;
    }

    if (!existing.description?.trim() && skill.description?.trim()) {
      indexedByName.set(normalizedName, skill);
    }
  }

  return indexedByName;
}

export function deriveIrisWorkflowSkillEntries(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<IrisWorkflowSkillEntry> {
  const availableIrisSkillsByName = indexAvailableIrisSkills(skills);

  const curatedEntries = CURATED_IRIS_WORKFLOW_SKILLS.map((definition) => {
    const localSkill = availableIrisSkillsByName.get(definition.name);

    return {
      id: `iris-workflow:${definition.name}`,
      name: definition.name,
      description: localSkill
        ? resolveSkillDescription(localSkill, definition.description)
        : definition.description,
      whyUseIt: definition.whyUseIt,
      isAvailableLocally: localSkill !== undefined,
    } satisfies IrisWorkflowSkillEntry;
  });

  const discoveredOnlyEntries = Array.from(availableIrisSkillsByName.entries())
    .filter(([name]) => !CURATED_WORKFLOW_NAMES.has(name))
    .toSorted(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, skill]) => {
      const resolvedName = skill.name.trim() || name;
      return {
        id: `iris-workflow:${resolvedName}`,
        name: resolvedName,
        description: resolveSkillDescription(
          skill,
          "Iris workflow available in the local catalog.",
        ),
        whyUseIt: buildFallbackWhyUseIt(),
        isAvailableLocally: true,
      } satisfies IrisWorkflowSkillEntry;
    });

  return [...curatedEntries, ...discoveredOnlyEntries];
}
