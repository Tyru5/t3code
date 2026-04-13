import { Context } from "effect";
import type { Effect } from "effect";
import type { SkillCatalogError, SkillCatalogResult } from "@t3tools/contracts";

export interface SkillCatalogShape {
  readonly getCatalog: Effect.Effect<SkillCatalogResult, SkillCatalogError>;
}

export class SkillCatalog extends Context.Service<SkillCatalog, SkillCatalogShape>()(
  "t3/skills/Services/SkillCatalog",
) {}
