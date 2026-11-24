import type { LongBookAnalysisPreset } from "@writer/contracts/renderer";

export function cloneLongBookAnalysisPreset(
  preset: LongBookAnalysisPreset
): LongBookAnalysisPreset {
  return {
    ...preset,
    output: { ...preset.output }
  };
}
