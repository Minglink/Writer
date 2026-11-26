export const WRITING_CONTEXT_PATH = "AGENTS.md" as const;
export const WRITING_CONTEXT_MAX_CHARACTERS = 10_000;

export function writingContextCharacterCount(content: string): number {
  return Array.from(content).length;
}
