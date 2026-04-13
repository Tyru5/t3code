import { type SkillCatalogEntry } from "@t3tools/contracts";
import { CheckIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { deriveIrisSkillEntries, type IrisSkillEntry } from "./irisSkillsCatalog";
import {
  filterSkillCatalogEntries,
  groupSkillCatalogEntries,
  type TransientSkillsCatalogCardState,
} from "./skillsCatalog";
import { cn } from "~/lib/utils";

const PROVIDER_NOTE = {
  codex: "Includes Codex, agent, and plugin sources.",
  claudeAgent: "Best-effort local discovery; some skills may be Codex-specific.",
} as const;

export const SkillsCatalogCard = memo(function SkillsCatalogCard(props: {
  card: TransientSkillsCatalogCardState;
  appliedSkillNames: ReadonlyArray<string>;
  onApplySkill: (skillName: string) => void;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"local" | "iris">("local");
  const appliedSkillNameSet = useMemo(
    () => new Set(props.appliedSkillNames),
    [props.appliedSkillNames],
  );
  const filteredEntries = useMemo(
    () => filterSkillCatalogEntries(props.card.result?.entries ?? [], searchQuery),
    [props.card.result?.entries, searchQuery],
  );
  const groupedEntries = useMemo(
    () => groupSkillCatalogEntries(filteredEntries),
    [filteredEntries],
  );
  const irisEntries = useMemo(
    () => deriveIrisSkillEntries(props.card.result?.entries ?? []),
    [props.card.result?.entries],
  );
  const availableLocalIrisCount = useMemo(
    () => irisEntries.filter((entry) => entry.isAvailableLocally).length,
    [irisEntries],
  );
  const hasResult = props.card.result !== null;
  const warnings = props.card.result?.warnings ?? [];
  const isInitialLoading = props.card.status === "loading" && !hasResult;
  const showErrorOnly = props.card.status === "error" && !hasResult;

  return (
    <div
      data-skills-catalog-card="true"
      className="rounded-[1.35rem] border border-border/70 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--card)_94%,var(--primary)_6%)_0%,color-mix(in_srgb,var(--card)_97%,var(--success)_3%)_100%)] px-3 py-3 shadow-[0_26px_80px_-56px_color-mix(in_srgb,var(--primary)_24%,transparent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">Local skills catalog</h3>
            {props.card.isRefreshing ? (
              <Badge size="sm" variant="outline">
                Refreshing
              </Badge>
            ) : isInitialLoading ? (
              <Badge size="sm" variant="outline">
                Loading
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground/80">
            {PROVIDER_NOTE[props.card.provider]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasResult ? (
            <Badge size="sm" variant="outline">
              {props.card.result?.entries.length ?? 0} skills
            </Badge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={props.onClose}
            aria-label="Close local skills catalog"
          >
            <XIcon />
          </Button>
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-warning/25 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--warning)_10%,transparent)_0%,color-mix(in_srgb,var(--card)_92%,var(--warning)_8%)_100%)] px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium text-warning-foreground">
            <CircleAlertIcon className="size-3.5" />
            <span>Partial scan warnings</span>
          </div>
          <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground/85">
            {warnings.map((warning) => (
              <p key={`${warning.kind}:${warning.path}`} data-skills-catalog-warning="true">
                {warning.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {props.card.errorMessage ? (
        <div
          className="mt-3 rounded-xl border border-destructive/25 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--destructive)_10%,transparent)_0%,color-mix(in_srgb,var(--card)_92%,var(--destructive)_8%)_100%)] px-3 py-2 text-[11px] text-destructive/90"
          role="alert"
        >
          {props.card.errorMessage}
        </div>
      ) : null}

      {showErrorOnly ? null : (
        <>
          <div
            className="mt-3 flex gap-1 rounded-xl border border-border/70 bg-background/55 p-1"
            role="tablist"
            aria-label="Skills catalog views"
          >
            <button
              type="button"
              role="tab"
              id="skills-catalog-tab-local"
              aria-controls="skills-catalog-panel-local"
              aria-selected={activeTab === "local"}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors duration-150",
                activeTab === "local"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              onClick={() => setActiveTab("local")}
            >
              <span className="font-medium">Local catalog</span>
              <span className="text-[11px] text-current/75">
                {props.card.result?.entries.length ?? 0}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              id="skills-catalog-tab-iris"
              aria-controls="skills-catalog-panel-iris"
              aria-selected={activeTab === "iris"}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors duration-150",
                activeTab === "iris"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              onClick={() => setActiveTab("iris")}
            >
              <span className="font-medium">Iris workflows</span>
              <span className="text-[11px] text-current/75">{irisEntries.length}</span>
            </button>
          </div>

          {activeTab === "local" ? (
            <>
              <div className="mt-3">
                <Input
                  nativeInput
                  size="sm"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="Search local skills"
                  aria-label="Search local skills"
                />
              </div>

              <div
                id="skills-catalog-panel-local"
                role="tabpanel"
                aria-labelledby="skills-catalog-tab-local"
                className="mt-3 max-h-[28rem] overflow-y-auto pr-1"
              >
                {isInitialLoading ? (
                  <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground/80">
                    <Spinner className="size-4" />
                    <span>Loading local skills catalog…</span>
                  </div>
                ) : hasResult && filteredEntries.length === 0 ? (
                  <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground/80">
                    {props.card.result?.entries.length === 0
                      ? "No local skills were found."
                      : "No skills match that search."}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {groupedEntries.map((group) => (
                      <section key={group.kind}>
                        <div className="mb-2 flex items-center gap-2">
                          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/65">
                            {group.label}
                          </p>
                          <span className="h-px flex-1 bg-border/70" />
                        </div>
                        <div className="space-y-2">
                          {group.entries.map((entry) => (
                            <SkillCatalogEntryRow
                              key={entry.id}
                              entry={entry}
                              isApplied={appliedSkillNameSet.has(entry.name)}
                              onApplySkill={props.onApplySkill}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              id="skills-catalog-panel-iris"
              role="tabpanel"
              aria-labelledby="skills-catalog-tab-iris"
              className="mt-3 max-h-[28rem] overflow-y-auto pr-1"
            >
              <div className="rounded-xl border border-border/65 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--primary)_6%,transparent)_0%,color-mix(in_srgb,var(--card)_96%,var(--success)_4%)_100%)] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-foreground">Iris workflow skills</p>
                  <Badge size="sm" variant="outline">
                    {availableLocalIrisCount}/{irisEntries.length} available locally
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground/80">
                  These are the pre-wired Iris workflows for repo setup, spec creation, QA,
                  debugging, shipping, and knowledge management. Use them when you want the house
                  process instead of reconstructing the steps manually.
                </p>
              </div>

              <div className="mt-3 space-y-2">
                {irisEntries.length === 0 ? (
                  <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground/80">
                    No Iris skills are available.
                  </div>
                ) : (
                  irisEntries.map((entry) => (
                    <IrisSkillEntryRow
                      key={entry.id}
                      entry={entry}
                      isApplied={appliedSkillNameSet.has(entry.name)}
                      onApplySkill={props.onApplySkill}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});

const SkillCatalogEntryRow = memo(function SkillCatalogEntryRow(props: {
  entry: SkillCatalogEntry;
  isApplied: boolean;
  onApplySkill: (skillName: string) => void;
}) {
  const hasDescription = props.entry.description.trim().length > 0;

  return (
    <div className="rounded-xl border border-border/65 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_91%,var(--primary)_9%)_0%,color-mix(in_srgb,var(--background)_94%,var(--success)_6%)_100%)] px-3 py-2 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-white)_32%,transparent)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {hasDescription ? (
            <Tooltip>
              <TooltipTrigger
                delay={75}
                render={
                  <div
                    className="min-w-0 cursor-default"
                    data-skills-catalog-entry-name={props.entry.id}
                    tabIndex={0}
                  >
                    <p className="break-all text-sm font-medium text-foreground">
                      {props.entry.name}
                    </p>
                  </div>
                }
              />
              <TooltipPopup
                align="start"
                className="max-w-96 whitespace-pre-wrap leading-5"
                data-skills-catalog-entry-description={props.entry.id}
                side="top"
              >
                {props.entry.description}
              </TooltipPopup>
            </Tooltip>
          ) : (
            <div className="min-w-0" data-skills-catalog-entry-name={props.entry.id}>
              <p className="break-all text-sm font-medium text-foreground">{props.entry.name}</p>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {props.entry.sources.map((source) => (
              <Badge key={`${source.kind}:${source.path}`} size="sm" variant="outline">
                {source.label}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex justify-end sm:shrink-0">
          <Button
            type="button"
            size="xs"
            variant={props.isApplied ? "outline" : "secondary"}
            disabled={props.isApplied}
            onClick={() => props.onApplySkill(props.entry.name)}
          >
            {props.isApplied ? (
              <>
                <CheckIcon className="size-3.5" />
                Applied
              </>
            ) : (
              "Apply"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});

const IrisSkillEntryRow = memo(function IrisSkillEntryRow(props: {
  entry: IrisSkillEntry;
  isApplied: boolean;
  onApplySkill: (skillName: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border/65 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_92%,var(--primary)_8%)_0%,color-mix(in_srgb,var(--background)_95%,var(--success)_5%)_100%)] px-3 py-2.5 shadow-[inset_0_1px_0_color-mix(in_srgb,var(--color-white)_32%,transparent)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-sm font-medium text-foreground">{props.entry.name}</p>
            <Badge size="sm" variant="outline">
              {props.entry.isAvailableLocally ? "Available locally" : "Curated"}
            </Badge>
          </div>
          <p className="mt-2 text-sm leading-5 text-muted-foreground/88">
            {props.entry.description}
          </p>
          <div className="mt-2 rounded-lg border border-border/60 bg-background/70 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
              Why you&apos;d use it
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground/82">
              {props.entry.whyUseIt}
            </p>
          </div>
          {props.entry.sources.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {props.entry.sources.map((source) => (
                <Badge key={`${source.kind}:${source.path}`} size="sm" variant="outline">
                  {source.label}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end sm:shrink-0">
          <Button
            type="button"
            size="xs"
            variant={props.isApplied ? "outline" : "secondary"}
            disabled={props.isApplied || !props.entry.isAvailableLocally}
            onClick={() => props.onApplySkill(props.entry.name)}
            title={
              props.entry.isAvailableLocally
                ? undefined
                : "This Iris skill is curated for reference but was not found in the local catalog."
            }
          >
            {props.isApplied ? (
              <>
                <CheckIcon className="size-3.5" />
                Applied
              </>
            ) : props.entry.isAvailableLocally ? (
              "Apply"
            ) : (
              "Unavailable"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
});
