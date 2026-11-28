import type { ProviderStreams } from "@earendil-works/pi-ai";
import {
  streamGoogleSubscription,
  type GoogleSubscriptionFetcher
} from "./google-sse-stream";

export const GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL =
  "https://cloudcode-pa.googleapis.com";

const CLOUD_CODE_ASSIST_HEADERS: Record<string, string> = {
  "User-Agent": "google-cloud-sdk vscode_cloudshelleditor/0.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI"
  })
};

export function googleCloudCodeAssistApi(
  fetcher?: GoogleSubscriptionFetcher
): ProviderStreams {
  const invoke: ProviderStreams["streamSimple"] = (model, context, options) =>
    streamGoogleSubscription({
      model,
      context,
      ...(options ? { options } : {}),
      mode: "cloud-code-assist",
      defaultBaseUrl: GOOGLE_CLOUD_CODE_ASSIST_DEFAULT_BASE_URL,
      defaultHeaders: CLOUD_CODE_ASSIST_HEADERS,
      ...(fetcher ? { fetcher } : {})
    });

  return {
    stream: invoke,
    streamSimple: invoke
  };
}
