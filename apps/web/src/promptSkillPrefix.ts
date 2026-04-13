export const RESERVED_PROMPT_PREFIX_COMMANDS = ["model", "plan", "default", "skills"] as const;

export type ReservedPromptPrefixCommand = (typeof RESERVED_PROMPT_PREFIX_COMMANDS)[number];

export interface PromptSkillPrefixToken {
  name: string;
  start: number;
  end: number;
  separatorStart: number;
  separatorEnd: number;
}

export interface PromptSkillPrefixState {
  tokens: PromptSkillPrefixToken[];
  rawSkillNames: string[];
  appliedSkillNames: string[];
  body: string;
  bodyStart: number;
}

function isWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

function normalizePromptSkillName(skillName: string): string {
  return skillName.trim().replace(/^\/+/, "");
}

function isPromptSkillTokenBoundary(char: string | undefined): boolean {
  return char === undefined || isWhitespace(char) || char === "/";
}

export function isReservedPromptPrefixCommandName(skillName: string): boolean {
  const normalized = normalizePromptSkillName(skillName).toLowerCase();
  return RESERVED_PROMPT_PREFIX_COMMANDS.some((command) => command === normalized);
}

export function isValidPromptSkillName(skillName: string): boolean {
  const normalized = normalizePromptSkillName(skillName);
  return normalized.length > 0 && !/[/\s]/.test(normalized);
}

function uniquePromptSkillNames(skillNames: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of skillNames) {
    const normalized = normalizePromptSkillName(name);
    if (
      normalized.length === 0 ||
      !isValidPromptSkillName(normalized) ||
      isReservedPromptPrefixCommandName(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

export function parsePromptSkillPrefix(prompt: string): PromptSkillPrefixState {
  const tokens: PromptSkillPrefixToken[] = [];
  let scanStart = 0;
  let bodyStart = 0;

  while (scanStart < prompt.length) {
    if (prompt[scanStart] !== "/") {
      bodyStart = scanStart;
      break;
    }

    let cursor = scanStart + 1;
    while (!isPromptSkillTokenBoundary(prompt[cursor])) {
      cursor += 1;
    }

    const skillName = prompt.slice(scanStart + 1, cursor);
    if (!isValidPromptSkillName(skillName) || isReservedPromptPrefixCommandName(skillName)) {
      bodyStart = scanStart;
      break;
    }

    let separatorCursor = cursor;
    while (isWhitespace(prompt[separatorCursor])) {
      separatorCursor += 1;
    }

    if (separatorCursor === cursor) {
      bodyStart = scanStart;
      break;
    }

    tokens.push({
      name: skillName,
      start: scanStart,
      end: cursor,
      separatorStart: cursor,
      separatorEnd: separatorCursor,
    });
    scanStart = separatorCursor;
    bodyStart = separatorCursor;
  }

  if (scanStart >= prompt.length) {
    bodyStart = prompt.length;
  }

  const rawSkillNames = tokens.map((token) => token.name);
  return {
    tokens,
    rawSkillNames,
    appliedSkillNames: uniquePromptSkillNames(rawSkillNames),
    body: prompt.slice(bodyStart),
    bodyStart,
  };
}

export function getAppliedPromptSkillNames(prompt: string): string[] {
  return parsePromptSkillPrefix(prompt).appliedSkillNames;
}

export function buildPromptWithSkillPrefix(
  skillNames: ReadonlyArray<string>,
  body: string,
  options?: { ensureBodyGapWhenEmpty?: boolean },
): string {
  const appliedSkillNames = uniquePromptSkillNames(skillNames);
  const normalizedBody = body.trimStart();
  if (appliedSkillNames.length === 0) {
    return normalizedBody;
  }

  const prefix = appliedSkillNames.map((skillName) => `/${skillName}`).join(" ");
  if (normalizedBody.length === 0) {
    return options?.ensureBodyGapWhenEmpty ? `${prefix} ` : prefix;
  }
  return `${prefix} ${normalizedBody}`;
}

export function canonicalizePromptSkillPrefix(
  prompt: string,
  options?: { ensureBodyGapWhenEmpty?: boolean },
): string {
  const state = parsePromptSkillPrefix(prompt);
  if (state.rawSkillNames.length === 0) {
    return prompt;
  }
  return buildPromptWithSkillPrefix(state.appliedSkillNames, state.body, options);
}

export function insertPromptSkill(
  prompt: string,
  skillName: string,
  options?: { ensureBodyGapWhenEmpty?: boolean },
): string {
  const normalizedSkillName = normalizePromptSkillName(skillName);
  if (
    !isValidPromptSkillName(normalizedSkillName) ||
    isReservedPromptPrefixCommandName(normalizedSkillName)
  ) {
    return prompt;
  }

  const state = parsePromptSkillPrefix(prompt);
  const nextSkillNames = state.appliedSkillNames.includes(normalizedSkillName)
    ? state.appliedSkillNames
    : [...state.appliedSkillNames, normalizedSkillName];
  return buildPromptWithSkillPrefix(nextSkillNames, state.body, {
    ensureBodyGapWhenEmpty: options?.ensureBodyGapWhenEmpty ?? true,
  });
}

export function removePromptSkill(prompt: string, skillName: string): string {
  const normalizedSkillName = normalizePromptSkillName(skillName);
  const state = parsePromptSkillPrefix(prompt);
  if (!state.appliedSkillNames.includes(normalizedSkillName)) {
    return canonicalizePromptSkillPrefix(prompt);
  }

  const nextSkillNames = state.appliedSkillNames.filter((name) => name !== normalizedSkillName);
  return buildPromptWithSkillPrefix(nextSkillNames, state.body);
}
