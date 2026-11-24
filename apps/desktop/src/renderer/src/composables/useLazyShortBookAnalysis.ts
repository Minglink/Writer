import { useLazyModelFeature } from "./useLazyModelFeature";
import type { ComputedRef, ShallowRef } from "vue";
import type {
  WriterApi,
  ModelConfig,
  SystemEventEnvelope
} from "@writer/contracts";
import type { ShortBookAnalysisController } from "../extras/short-book-analysis/useShortBookAnalysis";
type ShortBookAnalysisModule = Pick<
  typeof import("../extras/short-book-analysis/useShortBookAnalysis"),
  "useShortBookAnalysis"
>;
export interface LazyShortBookAnalysisController {
  controller: ShallowRef<ShortBookAnalysisController | null>;
  isBusy: ComputedRef<boolean>;
  ensureLoaded(): Promise<ShortBookAnalysisController>;
  setConfiguredModels(
    models: readonly ModelConfig[],
    defaultModelId?: string
  ): void;
  handleEvent(event: SystemEventEnvelope): void;
  dispose(): void;
}

export function useLazyShortBookAnalysisController(options: {
  api: () => WriterApi | undefined;
  loadModule?: () => Promise<ShortBookAnalysisModule>;
}): LazyShortBookAnalysisController {
  return useLazyModelFeature("Short book analysis", async () => {
    const module = await (options.loadModule?.() ??
      (await import("../extras/short-book-analysis/loader")).loadController());
    return module.useShortBookAnalysis({ api: options.api });
  });
}
