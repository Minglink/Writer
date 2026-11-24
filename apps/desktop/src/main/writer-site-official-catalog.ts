import type { RemoteModelListItem } from "@writer/contracts";
import {
  deepWriteSiteOfficialCatalogBaseUrl,
  type WriterSiteOfficialRemoteCatalog
} from "./writer-site-official-model-config";
import {
  RemoteModelListError,
  type ListRemoteModelsInput
} from "./list-remote-models";

interface SiteOfficialCatalogContext {
  listRemoteModels(
    input: ListRemoteModelsInput
  ): Promise<RemoteModelListItem[]>;
}

export async function loadWriterSiteOfficialCatalog(
  ctx: SiteOfficialCatalogContext
): Promise<WriterSiteOfficialRemoteCatalog> {
  try {
    const models = await ctx.listRemoteModels({
      provider: "writer-site",
      api: "openai-completions",
      baseUrl: deepWriteSiteOfficialCatalogBaseUrl(),
      apiKey: "",
      allowUnauthenticated: true
    });
    return {
      models,
      googleModels: models.filter(
        (model) => model.api === "google-generative-ai"
      )
    };
  } catch (error: unknown) {
    // Only expose local diagnostics and status codes, never response bodies or keys.
    const reason =
      error instanceof RemoteModelListError
        ? error.httpStatus === undefined
          ? error.message
          : `HTTP ${error.httpStatus}`
        : "请求失败";
    throw new Error(
      `新官方小站公开模型列表加载失败（/api/v1/public/models：${reason}）。`
    );
  }
}
