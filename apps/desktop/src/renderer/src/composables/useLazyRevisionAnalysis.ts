import { t } from "../i18n";
import type { WriterApi } from "@writer/contracts";
import { useLazyModelFeature } from "./useLazyModelFeature";
export function useLazyRevisionAnalysis(options: {
  api: () => WriterApi | undefined;
}) {
  return useLazyModelFeature(
    t("workspace.lazyRevisionAnalysis.revisionAnalysis"),
    async () => {
      const { useRevisionAnalysis } = await (
        await import("../extras/revision-analysis/loader")
      ).loadController();
      return useRevisionAnalysis(options);
    }
  );
}
