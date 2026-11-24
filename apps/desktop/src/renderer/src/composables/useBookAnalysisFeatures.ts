import { useLazyRevisionAnalysis } from "./useLazyRevisionAnalysis";
import { useLazyLongBookDecomposition } from "./useLazyLongBookDecomposition";
import type { WriterApi, ModelConfig } from "@writer/contracts";
import { useLazyLongBookAnalysisController } from "./useLazyFeatureControllers";
import { useLazyShortBookAnalysisController } from "./useLazyShortBookAnalysis";
export function useBookAnalysisFeatures(api: () => WriterApi | undefined) {
  const longBookAnalysisFeature = useLazyLongBookAnalysisController({ api });
  const longBookDecompositionFeature = useLazyLongBookDecomposition(api);
  const shortBookAnalysisFeature = useLazyShortBookAnalysisController({ api });
  const revisionAnalysisFeature = useLazyRevisionAnalysis({ api });
  const analysisFeatures = [
    longBookDecompositionFeature,
    longBookAnalysisFeature,
    shortBookAnalysisFeature,
    revisionAnalysisFeature
  ];
  return {
    longBookDecompositionFeature,
    longBookDecompositionRunning: longBookDecompositionFeature.isBusy,
    revisionAnalysisFeature,
    revisionAnalysisRunning: revisionAnalysisFeature.isBusy,
    configureAnalysisModels(
      models: readonly ModelConfig[],
      defaultModelId?: string
    ) {
      analysisFeatures.forEach((f) =>
        f.setConfiguredModels(models, defaultModelId)
      );
    },
    disposeAnalysisFeatures() {
      analysisFeatures.forEach((f) => f.dispose());
    },
    longBookAnalysisFeature,
    shortBookAnalysisFeature,
    longBookAnalysisRunning: longBookAnalysisFeature.isBusy,
    shortBookAnalysisRunning: shortBookAnalysisFeature.isBusy
  };
}
