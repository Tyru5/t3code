import { describe, expect, it } from "vitest";

import {
  buildPromptWithSkillPrefix,
  canonicalizePromptSkillPrefix,
  getAppliedPromptSkillNames,
  insertPromptSkill,
  parsePromptSkillPrefix,
  removePromptSkill,
} from "./promptSkillPrefix";

describe("parsePromptSkillPrefix", () => {
  it("parses committed leading skill tokens and the remaining body", () => {
    expect(parsePromptSkillPrefix("/review /benchmark explain this")).toEqual({
      tokens: [
        {
          name: "review",
          start: 0,
          end: "/review".length,
          separatorStart: "/review".length,
          separatorEnd: "/review ".length,
        },
        {
          name: "benchmark",
          start: "/review ".length,
          end: "/review /benchmark".length,
          separatorStart: "/review /benchmark".length,
          separatorEnd: "/review /benchmark ".length,
        },
      ],
      rawSkillNames: ["review", "benchmark"],
      appliedSkillNames: ["review", "benchmark"],
      body: "explain this",
      bodyStart: "/review /benchmark ".length,
    });
  });

  it("stops before reserved slash commands", () => {
    expect(parsePromptSkillPrefix("/review /plan this")).toMatchObject({
      rawSkillNames: ["review"],
      appliedSkillNames: ["review"],
      body: "/plan this",
      bodyStart: "/review ".length,
    });
  });

  it("does not consume an incomplete trailing slash token", () => {
    expect(parsePromptSkillPrefix("/review /re")).toMatchObject({
      rawSkillNames: ["review"],
      appliedSkillNames: ["review"],
      body: "/re",
      bodyStart: "/review ".length,
    });
  });
});

describe("getAppliedPromptSkillNames", () => {
  it("dedupes exact skill names while preserving insertion order", () => {
    expect(getAppliedPromptSkillNames("/review /benchmark /review body")).toEqual([
      "review",
      "benchmark",
    ]);
  });
});

describe("buildPromptWithSkillPrefix", () => {
  it("canonicalizes the prefix with a single body separator", () => {
    expect(buildPromptWithSkillPrefix(["review", "benchmark"], "   explain this")).toBe(
      "/review /benchmark explain this",
    );
  });

  it("keeps an editable body gap when requested", () => {
    expect(buildPromptWithSkillPrefix(["review"], "", { ensureBodyGapWhenEmpty: true })).toBe(
      "/review ",
    );
  });
});

describe("canonicalizePromptSkillPrefix", () => {
  it("dedupes skills and collapses extra spacing", () => {
    expect(canonicalizePromptSkillPrefix("/review  /review   explain this")).toBe(
      "/review explain this",
    );
  });

  it("leaves non-skill prompts unchanged", () => {
    expect(canonicalizePromptSkillPrefix("  explain this")).toBe("  explain this");
  });
});

describe("insertPromptSkill", () => {
  it("appends a new skill without duplicating an existing token", () => {
    expect(insertPromptSkill("/review explain this", "benchmark")).toBe(
      "/review /benchmark explain this",
    );
    expect(insertPromptSkill("/review explain this", "review")).toBe("/review explain this");
  });
});

describe("removePromptSkill", () => {
  it("removes a skill and collapses the prefix cleanly", () => {
    expect(removePromptSkill("/review /benchmark explain this", "review")).toBe(
      "/benchmark explain this",
    );
    expect(removePromptSkill("/review ", "review")).toBe("");
  });
});
