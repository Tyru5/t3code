import { Schema } from "effect";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";

export const SkillCatalogSourceKind = Schema.Literals(["agents", "codex", "plugin"]);
export type SkillCatalogSourceKind = typeof SkillCatalogSourceKind.Type;

export const SkillCatalogSource = Schema.Struct({
  kind: SkillCatalogSourceKind,
  label: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type SkillCatalogSource = typeof SkillCatalogSource.Type;

export const SkillCatalogEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: TrimmedString,
  sources: Schema.Array(SkillCatalogSource),
});
export type SkillCatalogEntry = typeof SkillCatalogEntry.Type;

export const SkillCatalogWarningKind = Schema.Literals([
  "root-unreadable",
  "plugin-manifest-invalid",
]);
export type SkillCatalogWarningKind = typeof SkillCatalogWarningKind.Type;

export const SkillCatalogWarning = Schema.Struct({
  kind: SkillCatalogWarningKind,
  message: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
});
export type SkillCatalogWarning = typeof SkillCatalogWarning.Type;

export const SkillCatalogResult = Schema.Struct({
  entries: Schema.Array(SkillCatalogEntry),
  warnings: Schema.Array(SkillCatalogWarning),
});
export type SkillCatalogResult = typeof SkillCatalogResult.Type;

export class SkillCatalogError extends Schema.TaggedErrorClass<SkillCatalogError>()(
  "SkillCatalogError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
