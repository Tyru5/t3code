import { describe, expect, it } from "vitest";

import { splitPromptIntoComposerSegments } from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

describe("splitPromptIntoComposerSegments", () => {
  it("renders committed leading skill tokens as skill segments", () => {
    expect(splitPromptIntoComposerSegments("/review /benchmark explain this")).toEqual([
      { type: "skill", skillName: "review" },
      { type: "text", text: " " },
      { type: "skill", skillName: "benchmark" },
      { type: "text", text: " " },
      { type: "text", text: "explain this" },
    ]);
  });

  it("keeps an incomplete trailing slash token as normal text", () => {
    expect(splitPromptIntoComposerSegments("/review /re")).toEqual([
      { type: "skill", skillName: "review" },
      { type: "text", text: " " },
      { type: "text", text: "/re" },
    ]);
  });

  it("keeps reserved slash commands as normal text after the skill prefix", () => {
    expect(splitPromptIntoComposerSegments("/review /plan")).toEqual([
      { type: "skill", skillName: "review" },
      { type: "text", text: " " },
      { type: "text", text: "/plan" },
    ]);
  });

  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@src/index.ts \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "src/index.ts" },
      { type: "text", text: " \ntwo" },
    ]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md please`,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "mention", path: "AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });
});
