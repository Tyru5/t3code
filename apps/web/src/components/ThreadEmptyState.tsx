import { BugIcon, ClipboardCheckIcon, SearchSlashIcon, SparklesIcon } from "lucide-react";

import { cn } from "~/lib/utils";

interface ThreadEmptyStateProps {
  className?: string;
}

const EMPTY_STATE_WORKFLOWS = [
  {
    icon: SparklesIcon,
    label: "Spec",
    title: "Turn a vague idea into a scoped plan",
    description: "Ask for a feature breakdown, an implementation path, or a migration sketch.",
  },
  {
    icon: BugIcon,
    label: "Debug",
    title: "Triage a failing build or broken flow",
    description: "Drop in the error, describe the bug, or point at the regressions you want fixed.",
  },
  {
    icon: ClipboardCheckIcon,
    label: "Ship",
    title: "Review changes before you push them",
    description: "Use the first turn to request a review, polish a branch, or prep a PR.",
  },
] as const;

export function ThreadEmptyState({ className }: ThreadEmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-[60vh] items-center justify-center overflow-hidden px-4 py-10 sm:px-8",
        className,
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--color-background)_98%,white)_0%,color-mix(in_oklab,var(--color-background)_94%,var(--color-secondary)_6%)_100%)]" />
        <div className="absolute left-1/2 top-[18%] h-56 w-56 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_72%)] blur-3xl" />
        <div className="absolute bottom-[-8rem] left-[8%] h-72 w-72 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-success)_10%,transparent),transparent_72%)] blur-3xl" />
        <div className="absolute inset-x-[10%] top-1/2 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--color-border)_78%,transparent),transparent)]" />
      </div>

      <section className="relative w-full max-w-4xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground shadow-xs">
            <SearchSlashIcon className="size-3" />
            Empty thread
          </div>
          <h2 className="mt-5 font-heading text-3xl leading-tight tracking-tight text-foreground sm:text-4xl">
            Start with the one thing you need done next.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            T3 Code works best when the first prompt is concrete: a failing path, a branch to
            review, or a feature that needs a real plan.
          </p>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {EMPTY_STATE_WORKFLOWS.map((workflow) => {
            const Icon = workflow.icon;
            return (
              <div
                key={workflow.label}
                className="relative overflow-hidden rounded-[1.5rem] border border-border/70 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--color-background)_88%,white),color-mix(in_oklab,var(--color-muted)_74%,transparent))] p-5 shadow-xs"
              >
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.12),transparent_36%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.06),transparent_36%)]" />
                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                      {workflow.label}
                    </span>
                    <Icon className="size-4 text-foreground/70" />
                  </div>
                  <div className="mt-4 font-medium text-foreground">{workflow.title}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {workflow.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
