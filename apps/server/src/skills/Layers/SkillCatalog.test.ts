import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";

import { ServerSettingsService } from "../../serverSettings.ts";
import { SkillCatalog } from "../Services/SkillCatalog.ts";
import {
  buildSkillCatalogRootSpecs,
  mergeSkillCatalogRecords,
  parseSkillFrontMatter,
  resolveSkillCatalogCodexHome,
  SkillCatalogLive,
} from "./SkillCatalog.ts";

function writeTextFile(pathValue: string, contents: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(NodePath.dirname(pathValue), { recursive: true });
    yield* fileSystem.writeFileString(pathValue, contents);
  });
}

function writeSkillFile(
  rootPath: string,
  relativeSkillDirectory: string,
  input: { name: string; description: string },
) {
  const skillPath = NodePath.join(rootPath, ...relativeSkillDirectory.split("/"));
  return writeTextFile(
    NodePath.join(skillPath, "SKILL.md"),
    [
      "---",
      `name: ${input.name}`,
      `description: ${input.description}`,
      "---",
      "",
      "# Skill",
      "",
      "Body",
    ].join("\n"),
  );
}

function writeSkillFileWithBlockDescription(
  rootPath: string,
  relativeSkillDirectory: string,
  input: { name: string; descriptionLines: ReadonlyArray<string> },
) {
  const skillPath = NodePath.join(rootPath, ...relativeSkillDirectory.split("/"));
  return writeTextFile(
    NodePath.join(skillPath, "SKILL.md"),
    [
      "---",
      `name: ${input.name}`,
      "description: |",
      ...input.descriptionLines.map((line) => `  ${line}`),
      "---",
      "",
      "# Skill",
    ].join("\n"),
  );
}

function writeJsonFile(pathValue: string, data: unknown) {
  return writeTextFile(pathValue, `${JSON.stringify(data, null, 2)}\n`);
}

function readCatalog(options: { codexHome: string; userProfile: string }) {
  const layer = Layer.empty.pipe(
    Layer.provideMerge(SkillCatalogLive),
    Layer.provideMerge(
      ServerSettingsService.layerTest({
        providers: {
          codex: {
            homePath: options.codexHome,
          },
        },
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  return Effect.gen(function* () {
    const previousUserProfile = process.env.USERPROFILE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.USERPROFILE = options.userProfile;
    delete process.env.CODEX_HOME;

    try {
      const catalog = yield* SkillCatalog;
      return yield* catalog.getCatalog;
    } finally {
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  }).pipe(Effect.provide(layer));
}

describe("resolveSkillCatalogCodexHome", () => {
  it.effect("prefers configured settings over env and default home", () =>
    Effect.sync(() => {
      expect(
        resolveSkillCatalogCodexHome({
          settingsHomePath: "C:\\custom\\.codex",
          envCodexHome: "C:\\env\\.codex",
          homeDir: "C:\\Users\\Tyrus",
        }),
      ).toBe("C:\\custom\\.codex");
    }),
  );

  it.effect("falls back to env and then the default home directory", () =>
    Effect.sync(() => {
      expect(
        resolveSkillCatalogCodexHome({
          settingsHomePath: "   ",
          envCodexHome: "C:\\env\\.codex",
          homeDir: "C:\\Users\\Tyrus",
        }),
      ).toBe("C:\\env\\.codex");
      expect(
        resolveSkillCatalogCodexHome({
          settingsHomePath: "",
          envCodexHome: undefined,
          homeDir: "C:\\Users\\Tyrus",
        }),
      ).toBe("C:\\Users\\Tyrus\\.codex");
    }),
  );
});

describe("buildSkillCatalogRootSpecs", () => {
  it.effect("returns the expected fixed root order", () =>
    Effect.sync(() => {
      expect(
        buildSkillCatalogRootSpecs({
          userProfile: "C:\\Users\\Tyrus",
          codexHome: "C:\\Users\\Tyrus\\.codex",
        }).map((root) => ({
          kind: root.kind,
          label: root.label,
          path: root.path,
        })),
      ).toEqual([
        {
          kind: "agents",
          label: "Agents",
          path: "C:\\Users\\Tyrus\\.agents\\skills",
        },
        {
          kind: "agents",
          label: "Agents · gstack",
          path: "C:\\Users\\Tyrus\\.agents\\skills\\gstack",
        },
        {
          kind: "agents",
          label: "Agents · openclaw",
          path: "C:\\Users\\Tyrus\\.agents\\skills\\gstack\\openclaw\\skills",
        },
        {
          kind: "codex",
          label: "Codex",
          path: "C:\\Users\\Tyrus\\.codex\\skills",
        },
        {
          kind: "codex",
          label: "Codex · system",
          path: "C:\\Users\\Tyrus\\.codex\\skills\\.system",
        },
      ]);
    }),
  );
});

describe("parseSkillFrontMatter", () => {
  it.effect("parses single-line fields", () =>
    Effect.sync(() => {
      expect(
        parseSkillFrontMatter(
          ["---", 'name: "github"', "description: Triage GitHub work.", "---", "", "# Skill"].join(
            "\n",
          ),
        ),
      ).toEqual({
        name: "github",
        description: "Triage GitHub work.",
      });
    }),
  );

  it.effect("parses YAML block descriptions", () =>
    Effect.sync(() => {
      expect(
        parseSkillFrontMatter(
          [
            "---",
            "name: review",
            "description: |",
            "  Pre-landing PR review.",
            "  Catches structural issues before merge.",
            "allowed-tools:",
            "  - Read",
            "---",
          ].join("\n"),
        ),
      ).toEqual({
        name: "review",
        description: "Pre-landing PR review. Catches structural issues before merge.",
      });
    }),
  );
});

describe("mergeSkillCatalogRecords", () => {
  it.effect("merges duplicate skills when the normalized description matches", () =>
    Effect.sync(() => {
      const entries = mergeSkillCatalogRecords([
        {
          name: "review",
          description: "Pre-landing review",
          source: {
            kind: "agents",
            label: "Agents",
            path: "C:\\skills\\agents\\review",
          },
        },
        {
          name: "Review",
          description: " Pre-landing   review ",
          source: {
            kind: "codex",
            label: "Codex",
            path: "C:\\skills\\codex\\review",
          },
        },
      ]);

      expect(entries).toEqual([
        {
          id: "review",
          name: "review",
          description: "Pre-landing review",
          sources: [
            {
              kind: "agents",
              label: "Agents",
              path: "C:\\skills\\agents\\review",
            },
            {
              kind: "codex",
              label: "Codex",
              path: "C:\\skills\\codex\\review",
            },
          ],
        },
      ]);
    }),
  );

  it.effect("splits conflicting descriptions by source kind", () =>
    Effect.sync(() => {
      const entries = mergeSkillCatalogRecords([
        {
          name: "github",
          description: "General GitHub triage",
          source: {
            kind: "plugin",
            label: "Plugin · GitHub",
            path: "C:\\skills\\plugins\\github",
          },
        },
        {
          name: "github",
          description: "Internal GitHub automation",
          source: {
            kind: "agents",
            label: "Agents",
            path: "C:\\skills\\agents\\github",
          },
        },
      ]);

      expect(entries.map((entry) => entry.id)).toEqual(["github-agents", "github-plugin"]);
    }),
  );
});

it.layer(NodeServices.layer)(
  "SkillCatalogLive discovers direct-child skills across all roots",
  (it) => {
    it.effect(
      "includes .system, openclaw, and plugin skills while pruning nested gstack children",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const userProfile = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3code-skills-user-",
          });
          const codexHome = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "t3code-skills-codex-",
          });

          yield* writeSkillFile(userProfile, ".agents/skills/review", {
            name: "review",
            description: "Pre-landing PR review",
          });
          yield* writeSkillFile(userProfile, ".agents/skills/gstack/design-review", {
            name: "design-review",
            description: "Designer QA",
          });
          yield* writeSkillFile(userProfile, ".agents/skills/gstack/nested/inner-skill", {
            name: "inner-skill",
            description: "Should be pruned",
          });
          yield* writeSkillFile(userProfile, ".agents/skills/gstack/openclaw/skills/retro", {
            name: "retro",
            description: "Weekly engineering retrospective",
          });
          yield* writeSkillFile(codexHome, "skills/codex-review", {
            name: "codex-review",
            description: "Codex review workflow",
          });
          yield* writeSkillFile(codexHome, "skills/.system/openai-docs", {
            name: "openai-docs",
            description: "OpenAI docs lookup",
          });
          yield* writeSkillFileWithBlockDescription(
            codexHome,
            "plugins/cache/vendor/github-plugin/skills/github",
            {
              name: "github",
              descriptionLines: [
                "Triage and orient GitHub repository work.",
                "Use the connected GitHub app first.",
              ],
            },
          );
          yield* writeJsonFile(
            NodePath.join(
              codexHome,
              "plugins",
              "cache",
              "vendor",
              "github-plugin",
              ".codex-plugin",
              "plugin.json",
            ),
            {
              name: "github",
              skills: "./skills",
              interface: {
                displayName: "GitHub",
              },
            },
          );

          const result = yield* readCatalog({ codexHome, userProfile });

          expect(result.entries.map((entry) => entry.name)).toEqual([
            "design-review",
            "retro",
            "review",
            "codex-review",
            "openai-docs",
            "github",
          ]);
          expect(result.entries.some((entry) => entry.name === "inner-skill")).toBe(false);
          expect(result.entries.find((entry) => entry.name === "github")?.sources).toEqual([
            {
              kind: "plugin",
              label: "Plugin · GitHub",
              path: NodePath.join(
                codexHome,
                "plugins",
                "cache",
                "vendor",
                "github-plugin",
                "skills",
                "github",
              ),
            },
          ]);
          expect(result.warnings).toEqual([]);
        }),
    );

    it.effect("emits warnings for unreadable roots and invalid plugin manifests", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const userProfile = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-skills-user-",
        });
        const codexHome = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3code-skills-codex-",
        });

        yield* writeSkillFile(userProfile, ".agents/skills/review", {
          name: "review",
          description: "Pre-landing PR review",
        });
        yield* writeTextFile(NodePath.join(codexHome, "skills", ".system"), "not a directory");
        yield* writeJsonFile(
          NodePath.join(
            codexHome,
            "plugins",
            "cache",
            "vendor",
            "broken-plugin",
            ".codex-plugin",
            "plugin.json",
          ),
          {
            name: "broken",
          },
        );

        const result = yield* readCatalog({ codexHome, userProfile });

        expect(result.entries.map((entry) => entry.name)).toEqual(["review"]);
        expect(result.warnings).toEqual([
          {
            kind: "plugin-manifest-invalid",
            message: "Plugin manifest is missing a valid skills path.",
            path: NodePath.join(
              codexHome,
              "plugins",
              "cache",
              "vendor",
              "broken-plugin",
              ".codex-plugin",
              "plugin.json",
            ),
          },
          {
            kind: "root-unreadable",
            message: expect.any(String),
            path: NodePath.join(codexHome, "skills", ".system"),
          },
        ]);
      }),
    );
  },
);
