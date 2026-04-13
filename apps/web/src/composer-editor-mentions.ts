import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import { parsePromptSkillPrefix } from "./promptSkillPrefix";

export type ComposerPromptSegment =
  | {
      type: "skill";
      skillName: string;
    }
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      path: string;
    }
  | {
      type: "terminal-context";
      context: TerminalContextDraft | null;
    };

const INLINE_TOKEN_REGEX = /(^|\s)([@$])([^\s@$]+)(?=\s)/g;

function pushTextSegment(segments: ComposerPromptSegment[], text: string): void {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.type === "text") {
    last.text += text;
    return;
  }
  segments.push({ type: "text", text });
}

function splitPromptTextIntoComposerSegments(text: string): ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = [];
  if (!text) {
    return segments;
  }

  let cursor = 0;
  for (const match of text.matchAll(INLINE_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const sigil = match[2] ?? "";
    const tokenValue = match[3] ?? "";
    const matchIndex = match.index ?? 0;
    const tokenStart = matchIndex + prefix.length;
    const tokenEnd = tokenStart + fullMatch.length - prefix.length;

    if (tokenStart > cursor) {
      pushTextSegment(segments, text.slice(cursor, tokenStart));
    }

    if (tokenValue.length > 0) {
      if (sigil === "@") {
        segments.push({ type: "mention", path: tokenValue });
      } else {
        segments.push({ type: "skill", skillName: tokenValue });
      }
    } else {
      pushTextSegment(segments, text.slice(tokenStart, tokenEnd));
    }

    cursor = tokenEnd;
  }

  if (cursor < text.length) {
    pushTextSegment(segments, text.slice(cursor));
  }

  return segments;
}

function splitLeadingPromptSkillSegments(prompt: string): {
  segments: ComposerPromptSegment[];
  remainderStart: number;
} {
  const prefixState = parsePromptSkillPrefix(prompt);
  if (prefixState.tokens.length === 0) {
    return {
      segments: [],
      remainderStart: 0,
    };
  }

  const segments: ComposerPromptSegment[] = [];
  let cursor = 0;

  for (const token of prefixState.tokens) {
    if (token.start > cursor) {
      pushTextSegment(segments, prompt.slice(cursor, token.start));
    }
    segments.push({
      type: "skill",
      skillName: token.name,
    });
    if (token.separatorEnd > token.end) {
      pushTextSegment(segments, prompt.slice(token.end, token.separatorEnd));
    }
    cursor = token.separatorEnd;
  }

  return {
    segments,
    remainderStart: cursor,
  };
}

export function splitPromptIntoComposerSegments(
  prompt: string,
  terminalContexts: ReadonlyArray<TerminalContextDraft> = [],
): ComposerPromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: ComposerPromptSegment[] = [];
  let textCursor = 0;
  let terminalContextIndex = 0;
  const leadingSkillSegments = splitLeadingPromptSkillSegments(prompt);
  if (leadingSkillSegments.segments.length > 0) {
    segments.push(...leadingSkillSegments.segments);
    textCursor = leadingSkillSegments.remainderStart;
  }

  for (let index = 0; index < prompt.length; index += 1) {
    if (index < textCursor) {
      continue;
    }
    if (prompt[index] !== INLINE_TERMINAL_CONTEXT_PLACEHOLDER) {
      continue;
    }

    if (index > textCursor) {
      segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor, index)));
    }
    segments.push({
      type: "terminal-context",
      context: terminalContexts[terminalContextIndex] ?? null,
    });
    terminalContextIndex += 1;
    textCursor = index + 1;
  }

  if (textCursor < prompt.length) {
    segments.push(...splitPromptTextIntoComposerSegments(prompt.slice(textCursor)));
  }

  return segments;
}
