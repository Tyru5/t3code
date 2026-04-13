import { describe, expect, it } from "vitest";

import {
  COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX,
  COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
  COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX,
  measureComposerFooterOverflowPx,
  resolveComposerFooterContentWidth,
  shouldForceCompactComposerFooterForFit,
  shouldUseCompactComposerPrimaryActions,
  shouldUseCompactComposerFooter,
} from "./composerFooterLayout";

describe("shouldUseCompactComposerFooter", () => {
  it("stays expanded without a measured width", () => {
    expect(shouldUseCompactComposerFooter(null)).toBe(false);
  });

  it("switches to compact mode below the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX - 1)).toBe(true);
  });

  it("stays expanded at and above the breakpoint", () => {
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX)).toBe(false);
    expect(shouldUseCompactComposerFooter(COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX + 48)).toBe(false);
  });

  it("uses a higher breakpoint for wide action states", () => {
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerFooter(COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("shouldUseCompactComposerPrimaryActions", () => {
  it("matches the wide footer breakpoint", () => {
    expect(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX).toBe(
      COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX,
    );
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX - 1, {
        hasWideActions: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCompactComposerPrimaryActions(COMPOSER_PRIMARY_ACTIONS_COMPACT_BREAKPOINT_PX, {
        hasWideActions: true,
      }),
    ).toBe(false);
  });
});

describe("measureComposerFooterOverflowPx", () => {
  it("returns null when measurement data is incomplete", () => {
    expect(
      measureComposerFooterOverflowPx({
        footerContentWidth: null,
        leadingContentWidth: 120,
        actionsWidth: 120,
      }),
    ).toBeNull();
  });

  it("includes the shared gap between leading content and actions", () => {
    expect(
      measureComposerFooterOverflowPx({
        footerContentWidth: 200,
        leadingContentWidth: 100,
        actionsWidth: 80,
      }),
    ).toBe(0);
    expect(
      measureComposerFooterOverflowPx({
        footerContentWidth: 180,
        leadingContentWidth: 100,
        actionsWidth: 80,
      }),
    ).toBe(8);
  });
});

describe("shouldForceCompactComposerFooterForFit", () => {
  it("switches to compact only after the overflow exceeds the recovery threshold", () => {
    expect(
      shouldForceCompactComposerFooterForFit({
        footerContentWidth: 88,
        leadingContentWidth: 100,
        actionsWidth: 100,
      }),
    ).toBe(false);
    expect(
      shouldForceCompactComposerFooterForFit({
        footerContentWidth: 87,
        leadingContentWidth: 100,
        actionsWidth: 100,
      }),
    ).toBe(true);
  });
});

describe("resolveComposerFooterContentWidth", () => {
  it("returns null when width or padding is unavailable", () => {
    expect(
      resolveComposerFooterContentWidth({
        footerWidth: null,
        paddingLeft: 12,
        paddingRight: 12,
      }),
    ).toBeNull();
  });

  it("subtracts horizontal padding and clamps at zero", () => {
    expect(
      resolveComposerFooterContentWidth({
        footerWidth: 240,
        paddingLeft: 16,
        paddingRight: 24,
      }),
    ).toBe(200);
    expect(
      resolveComposerFooterContentWidth({
        footerWidth: 20,
        paddingLeft: 16,
        paddingRight: 24,
      }),
    ).toBe(0);
  });
});
