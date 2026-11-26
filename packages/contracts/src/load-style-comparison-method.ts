export function loadStyleComparisonMethods() {
  return import("./style-comparison-method");
}

export async function loadDefaultStyleComparisonMethod(): Promise<string> {
  const { DEFAULT_STYLE_COMPARISON_METHOD } =
    await loadStyleComparisonMethods();
  return DEFAULT_STYLE_COMPARISON_METHOD;
}
