import { createHash } from "node:crypto";
import {
  LONG_CHAPTER_NOTES_PATH,
  LONG_CHAPTER_NOTES_SCHEMA_VERSION,
  LongChapterNoteSchema,
  LongChapterNotesFileSchema,
  type LongChapterNote
} from "@writer/contracts";
import {
  commitLongProjectTransaction,
  isNodeError,
  readSecureTextFile,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import type { LongProjectStoreContext } from "./store-context";
import { LongDocumentConflictError, MAX_LEDGER_RECORD_BYTES } from "./types";

function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export interface ChapterNotesReadState {
  notes: LongChapterNote[];
  revision: string;
}

export async function tryReadChapterNotesRaw(
  projectDirectory: string
): Promise<string | null> {
  try {
    const file = await readSecureTextFile(
      projectDirectory,
      LONG_CHAPTER_NOTES_PATH,
      MAX_LEDGER_RECORD_BYTES
    );
    const parsed: unknown = JSON.parse(file.content);
    const validated = LongChapterNotesFileSchema.parse(parsed);
    return serializeJson(validated);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

async function tryReadChapterNotesFile(
  projectDirectory: string
): Promise<{ notes: LongChapterNote[]; sha256: string } | null> {
  try {
    const file = await readSecureTextFile(
      projectDirectory,
      LONG_CHAPTER_NOTES_PATH,
      MAX_LEDGER_RECORD_BYTES
    );
    const parsed: unknown = JSON.parse(file.content);
    const validated = LongChapterNotesFileSchema.parse(parsed);
    return {
      notes: validated.notes,
      sha256: file.sha256
    };
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
}

export async function readChapterNotes(
  ctx: LongProjectStoreContext,
  projectDirectory: string
): Promise<ChapterNotesReadState> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    const existing = await tryReadChapterNotesFile(canonical);
    return {
      notes: existing?.notes ?? [],
      revision: existing?.sha256 ?? ""
    };
  });
}

export async function writeChapterNotes(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  notes: readonly LongChapterNote[],
  expectedRevision?: string
): Promise<ChapterNotesReadState> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    await loadProject(ctx, canonical);
    const existing = await tryReadChapterNotesFile(canonical);
    const currentRevision = existing?.sha256 ?? "";
    if (
      expectedRevision !== undefined &&
      expectedRevision !== currentRevision
    ) {
      throw new LongDocumentConflictError();
    }
    const validatedNotes = notes.map((note) =>
      LongChapterNoteSchema.parse(note)
    );
    const payload = LongChapterNotesFileSchema.parse({
      version: LONG_CHAPTER_NOTES_SCHEMA_VERSION,
      notes: validatedNotes
    });
    const serialized = serializeJson(payload);
    await commitLongProjectTransaction({
      projectRoot: canonical,
      operations: [
        {
          path: LONG_CHAPTER_NOTES_PATH,
          content: serialized,
          expectedSha256: existing ? existing.sha256 : null
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return {
      notes: payload.notes,
      revision: sha256Utf8(serialized)
    };
  });
}
