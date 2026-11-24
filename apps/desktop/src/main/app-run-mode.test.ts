import { describe, expect, it } from "vitest";
import { resolveWriterAppMode } from "./app-run-mode";

describe("resolveWriterAppMode", () => {
  it("defaults missing and unsupported values to runtime mode", () => {
    expect(resolveWriterAppMode(undefined)).toBe("runtime");
    expect(resolveWriterAppMode("")).toBe("runtime");
    expect(resolveWriterAppMode("unexpected")).toBe("runtime");
  });

  it("enables evaluation capture only for an explicit evaluation value", () => {
    expect(resolveWriterAppMode("evaluation")).toBe("evaluation");
    expect(resolveWriterAppMode(" Evaluation ")).toBe("evaluation");
    expect(resolveWriterAppMode("runtime")).toBe("runtime");
  });
});
