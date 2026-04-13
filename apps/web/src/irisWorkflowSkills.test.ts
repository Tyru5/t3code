import { describe, expect, it } from "vitest";

import type { ServerProviderSkill } from "@t3tools/contracts";

import { deriveIrisWorkflowSkillEntries } from "./irisWorkflowSkills";

function makeSkill(input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">) {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

describe("deriveIrisWorkflowSkillEntries", () => {
  it("returns the curated Iris workflow set when no provider skills are available", () => {
    const entries = deriveIrisWorkflowSkillEntries([]);

    expect(entries).toHaveLength(17);
    expect(entries.some((entry) => entry.name === "iris-spec")).toBe(true);
    expect(entries.some((entry) => entry.name === "iris-ship")).toBe(true);
  });

  it("overrides curated descriptions with local skill metadata when available", () => {
    const entries = deriveIrisWorkflowSkillEntries([
      makeSkill({
        name: "iris-spec",
        shortDescription: "Drive specs from ambiguity to implementation-ready artifacts.",
      }),
    ]);

    const irisSpec = entries.find((entry) => entry.name === "iris-spec");
    expect(irisSpec?.description).toBe(
      "Drive specs from ambiguity to implementation-ready artifacts.",
    );
    expect(irisSpec?.isAvailableLocally).toBe(true);
  });

  it("includes non-curated local iris skills after the curated workflow list", () => {
    const entries = deriveIrisWorkflowSkillEntries([
      makeSkill({
        name: "iris-autoplan",
        shortDescription: "Run the autonomous planning review sequence.",
      }),
      makeSkill({
        name: "iris-audit",
        shortDescription: "Local Iris audit description",
      }),
      makeSkill({
        name: "frontend-design",
        shortDescription: "Not an Iris skill",
      }),
      makeSkill({
        name: "iris-disabled",
        enabled: false,
      }),
    ]);

    expect(entries.at(-1)?.name).toBe("iris-autoplan");
    expect(entries.some((entry) => entry.name === "frontend-design")).toBe(false);
    expect(entries.some((entry) => entry.name === "iris-disabled")).toBe(false);
  });
});
