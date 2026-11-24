import { randomUUID } from "node:crypto";
import { isWriterSiteOfficialModel } from "@writer/contracts";

/** Only Main's official-site model identities participate in gateway routing. */
export function createSiteSessionHeaders(model: { id: string }) {
  const enabled = isWriterSiteOfficialModel(model);
  let fallbackSessionId: string | undefined;
  return (sessionId?: string): Record<string, string> | undefined => {
    if (!enabled) return undefined;
    return {
      "X-Writer-Session-ID":
        sessionId?.trim() || (fallbackSessionId ??= randomUUID())
    };
  };
}
