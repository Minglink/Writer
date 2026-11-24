import type { SystemEventEnvelope } from "@writer/contracts";
export interface EventsOperations {
  handleEvent(event: SystemEventEnvelope): void;
}
