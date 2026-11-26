import {
  DEFAULT_LONG_AGENTS_MD,
  LONG_AGENTS_MD_MAX_CHARACTERS,
  LONG_AGENTS_MD_PATH,
  buildLongAgentsMdForGenre,
  type BuildLongWebNovelAgentsMdOptions
} from "@writer/contracts";
import { isNodeError, readSecureTextFile } from "./io";
import { MAX_AGENTS_MD_BYTES, type SecureTextFile } from "./types";

export function sliceAgentsMdContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const characters = Array.from(content);
  if (characters.length <= LONG_AGENTS_MD_MAX_CHARACTERS) {
    return { content, truncated: false };
  }
  return {
    content: characters.slice(0, LONG_AGENTS_MD_MAX_CHARACTERS).join(""),
    truncated: true
  };
}

export function normalizeAgentsMdContent(content: string): string {
  return sliceAgentsMdContent(content).content;
}

export async function tryReadAgentsMdFile(
  projectDirectory: string
): Promise<SecureTextFile | null> {
  try {
    return await readSecureTextFile(
      projectDirectory,
      LONG_AGENTS_MD_PATH,
      MAX_AGENTS_MD_BYTES
    );
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

export async function readAgentsMdContentOrDefault(
  projectDirectory: string,
  genre?: string,
  options?: BuildLongWebNovelAgentsMdOptions
): Promise<string> {
  const existing = await tryReadAgentsMdFile(projectDirectory);
  if (existing) {
    return sliceAgentsMdContent(existing.content).content;
  }
  return genre
    ? buildLongAgentsMdForGenre(DEFAULT_LONG_AGENTS_MD, genre, options)
    : DEFAULT_LONG_AGENTS_MD;
}
