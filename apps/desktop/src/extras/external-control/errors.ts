import type { ExternalControlErrorCode } from "@writer/contracts/external-control";

/** Messages are read by agents, so each one states the next step. */
export class ExternalControlError extends Error {
  constructor(
    readonly code: ExternalControlErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExternalControlError";
  }
}
