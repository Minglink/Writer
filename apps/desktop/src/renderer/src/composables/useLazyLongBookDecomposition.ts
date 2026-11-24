import type { WriterApi } from "@writer/contracts/renderer";
import { useLazyModelFeature } from "./useLazyModelFeature";
export function useLazyLongBookDecomposition(api: () => WriterApi | undefined) {
  return useLazyModelFeature("Long book decomposition", async () => {
    const module = await (
      await import("../extras/long-book-decomposition/loader")
    ).loadController();
    return module.useLongBookDecomposition({ api });
  });
}
