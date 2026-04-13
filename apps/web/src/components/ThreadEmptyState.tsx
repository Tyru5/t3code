import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  BotIcon,
  GlobeIcon,
  HammerIcon,
  TerminalIcon,
  type LucideIcon,
  ZapIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { deriveIrisWorkflowSkillEntries } from "~/irisWorkflowSkills";
import { cn } from "~/lib/utils";

import { IrisWordmark } from "./IrisWordmark";

type ThreadEmptyStateProps = {
  readonly className?: string;
  readonly variant?: "workflows" | "logo";
  readonly providerSkills?: ReadonlyArray<ServerProviderSkill>;
};

const WORKFLOW_TABS = {
  spec: {
    label: "Spec",
    icon: TerminalIcon,
    suggestions: [
      "Bring a spec, bug report, or rough product idea to explore",
      "Clarify scope and surface risks before any code is written",
    ],
  },
  plan: {
    label: "Plan",
    icon: HammerIcon,
    suggestions: [
      "Pressure-test the approach and tighten constraints",
      "Define architectural guidance and repo patterns upfront",
    ],
  },
  review: {
    label: "Review",
    icon: GlobeIcon,
    suggestions: [
      "Audit the diff, verify behavior, and check for edge cases",
      "Turn the work into a cleaner, more confident handoff",
    ],
  },
  ship: {
    label: "Ship",
    icon: ZapIcon,
    suggestions: [
      "State the task, constraints, and what good looks like",
      "Move toward review-ready work with concrete prompts",
    ],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    icon: LucideIcon;
    suggestions: readonly string[];
  }
>;

type WorkflowTabId = keyof typeof WORKFLOW_TABS;
const WORKFLOW_TAB_IDS = Object.keys(WORKFLOW_TABS) as WorkflowTabId[];

export function ThreadEmptyState({
  className,
  variant = "workflows",
  providerSkills = [],
}: ThreadEmptyStateProps) {
  const isLogoOnly = variant === "logo";
  const [activeTabId, setActiveTabId] = useState<WorkflowTabId | null>(null);
  const [showIrisSkills, setShowIrisSkills] = useState(false);

  const activeTab = activeTabId ? WORKFLOW_TABS[activeTabId] : null;
  const irisSkills = useMemo(
    () => deriveIrisWorkflowSkillEntries(providerSkills),
    [providerSkills],
  );
  const irisSkillsCount = irisSkills.length;

  return (
    <div
      className={cn(
        "relative flex h-full min-h-full w-full items-center justify-center overflow-hidden px-4 py-8 sm:px-8 sm:py-10",
        className,
      )}
      data-testid={isLogoOnly ? "thread-empty-state-logo" : "thread-empty-state-workflows"}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-background" />
        <div className="absolute inset-0 bg-[radial-gradient(40rem_18rem_at_50%_18%,color-mix(in_srgb,var(--primary)_8%,transparent),transparent_74%)]" />
      </div>

      <section className="relative w-full">
        {isLogoOnly ? (
          <div className="mx-auto max-w-2xl text-center">
            <div className="relative mx-auto flex items-center justify-center">
              <div
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--success)_14%,transparent),transparent_72%)] blur-3xl"
              />
              <IrisWordmark className="relative h-14 text-foreground sm:h-[4.5rem]" />
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-balance text-[clamp(1.55rem,3.2vw,3rem)] font-semibold leading-[1.12] tracking-[-0.038em] text-foreground/95">
              Start with the outcome, then shape the plan before the code.
            </h2>
            <div
              className="mt-6 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2"
              role="tablist"
              aria-label="Workflow stages"
            >
              {WORKFLOW_TAB_IDS.map((tabId) => {
                const tab = WORKFLOW_TABS[tabId];
                const isActive = tabId === activeTabId;
                return (
                  <button
                    key={tabId}
                    type="button"
                    role="tab"
                    id={`thread-empty-tab-${tabId}`}
                    aria-selected={isActive}
                    aria-controls="thread-empty-tabpanel"
                    onClick={() => {
                      setActiveTabId((current) => (current === tabId ? null : tabId));
                      setShowIrisSkills(false);
                    }}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium tracking-[-0.01em] transition-all duration-200 sm:px-3.5 sm:py-2 sm:text-lg",
                      isActive
                        ? "border-primary/45 bg-primary/14 text-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_26%,transparent)]"
                        : "border-transparent text-muted-foreground/86 hover:border-border/60 hover:bg-background/35 hover:text-foreground/90",
                    )}
                  >
                    <tab.icon
                      className={cn(
                        "size-4 transition-colors sm:size-[1.1rem]",
                        isActive ? "text-primary/90" : "text-muted-foreground/72",
                      )}
                    />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex justify-center">
              <button
                type="button"
                aria-expanded={showIrisSkills}
                aria-controls="thread-empty-state-iris-workflows"
                onClick={() => setShowIrisSkills((current) => !current)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm text-foreground/90 transition-all duration-200 backdrop-blur-sm sm:px-3.5 sm:py-2 sm:text-[1.05rem]",
                  showIrisSkills
                    ? "border-primary/46 bg-primary/10 text-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                    : "border-border/60 bg-background/18 text-foreground/84 hover:border-primary/32 hover:bg-background/26",
                )}
              >
                <BotIcon
                  className={cn(
                    "size-3.5 transition-colors sm:size-4",
                    showIrisSkills ? "text-primary/88" : "text-muted-foreground/78",
                  )}
                />
                <span className="font-medium tracking-[-0.01em]">Iris workflows</span>
                <span className="text-xs text-current/70 tabular-nums sm:text-sm">
                  {irisSkillsCount}
                </span>
              </button>
            </div>

            <div
              id="thread-empty-tabpanel"
              {...(activeTabId
                ? { role: "tabpanel", "aria-labelledby": `thread-empty-tab-${activeTabId}` }
                : {})}
              className="mt-6 min-h-[4.5rem]"
            >
              {showIrisSkills ? (
                <div
                  id="thread-empty-state-iris-workflows"
                  className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 rounded-[1.1rem] border border-border/65 bg-card/72 px-3 py-3 text-left shadow-[0_20px_44px_-36px_color-mix(in_srgb,var(--primary)_16%,transparent)] backdrop-blur-sm sm:px-3.5 sm:py-3.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-foreground sm:text-sm">
                      Iris workflow skills
                    </p>
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      Spec to ship
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground/80 sm:text-xs">
                    Use these when you want the Iris team workflows for setup, planning, QA,
                    debugging, knowledge capture, and shipping instead of rebuilding the process by
                    hand.
                  </p>

                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {irisSkills.map((skill) => (
                      <article
                        key={skill.id}
                        className="rounded-lg border border-border/60 bg-background/55 px-2.5 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-medium text-foreground sm:text-sm">
                            {skill.name}
                          </p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                            Why use it
                          </span>
                        </div>
                        <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground/84">
                          {skill.description}
                        </p>
                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground/72">
                          {skill.whyUseIt}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  key={activeTabId}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 space-y-2.5 duration-200"
                >
                  {activeTab?.suggestions.map((suggestion) => (
                    <p
                      key={`${activeTabId ?? "none"}:${suggestion}`}
                      className="text-balance text-[0.98rem] leading-[1.45] tracking-[-0.01em] text-muted-foreground/76 sm:text-[1.15rem]"
                    >
                      {suggestion}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
