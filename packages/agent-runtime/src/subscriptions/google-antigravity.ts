import type { ProviderStreams } from "@earendil-works/pi-ai";
import {
  streamGoogleSubscription,
  type GoogleSubscriptionFetcher
} from "./google-sse-stream";

export const GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL =
  "https://daily-cloudcode-pa.googleapis.com";

// Google uses the Hub protocol identifier to select the account's model inventory.
const platform = process.platform === "win32" ? "windows" : process.platform;
const architecture = process.arch === "x64" ? "amd64" : process.arch;
export const ANTIGRAVITY_HUB_USER_AGENT = `antigravity/hub/2.36.0 (aidev_client; os_type=${platform}; arch=${architecture}) Writer`;

export function googleAntigravityApi(
  fetcher?: GoogleSubscriptionFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamGoogleSubscription({
      model,
      context,
      ...(options ? { options } : {}),
      mode: "antigravity",
      defaultBaseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_BASE_URL,
      defaultHeaders: { "User-Agent": ANTIGRAVITY_HUB_USER_AGENT },
      ...(fetcher ? { fetcher } : {})
    });

  return {
    stream: invoke,
    streamSimple: invoke
  };
}
