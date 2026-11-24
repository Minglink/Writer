import type { BookImageErrorCode } from "@writer/contracts";

export class BookImageError extends Error {
  constructor(
    readonly code: BookImageErrorCode,
    message: string
  ) {
    super(message);
  }
}
