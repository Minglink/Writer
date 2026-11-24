import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppearanceSettingsSchema,
  createDefaultAppearanceSettings
} from "@writer/contracts/renderer";
import {
  applyAppearanceThemeToDocument,
  sanitizeAppearanceTheme,
  themePresets,
  upgradeLegacyDefaultTheme
} from "./appearanceThemeRuntime";

afterEach(() => vi.unstubAllGlobals());

describe("independent manuscript font size", () => {
  it("loads older settings without losing the existing UI size", () => {
    const defaults = createDefaultAppearanceSettings();
    const settings = AppearanceSettingsSchema.parse({
      ...defaults,
      light: { ...defaults.light, uiFontSize: 20, editorFontSize: undefined }
    });
    expect(settings.light.uiFontSize).toBe(20);
    expect(settings.light.editorFontSize).toBe(15);
  });

  it("validates font size bounds and rounds to half pixels", () => {
    const defaults = createDefaultAppearanceSettings();
    for (const value of [9, 41, NaN, Infinity]) {
      expect(
        AppearanceSettingsSchema.safeParse({
          ...defaults,
          light: { ...defaults.light, editorFontSize: value }
        }).success
      ).toBe(false);
      expect(
        sanitizeAppearanceTheme({ editorFontSize: value }, "light")
          .editorFontSize
      ).toBe(15);
    }
    expect(
      sanitizeAppearanceTheme({ editorFontSize: 22.3 }, "light").editorFontSize
    ).toBe(22.5);
  });

  it.each(["light", "dark"] as const)(
    "updates manuscript and UI sizes independently in %s mode",
    (scheme) => {
      const properties = new Map<string, string>();
      vi.stubGlobal("document", {
        documentElement: {
          dataset: {},
          style: {
            setProperty: (key: string, value: string) =>
              properties.set(key, value)
          }
        },
        querySelector: () => null
      });
      const settings = createDefaultAppearanceSettings();
      const input = { ...settings, scheme, theme: settings[scheme] };
      applyAppearanceThemeToDocument(input);
      applyAppearanceThemeToDocument({
        ...input,
        theme: { ...input.theme, editorFontSize: 24 }
      });
      expect(properties.get("--editor-font-size")).toBe("24px");
      expect(properties.get("--ui-font-size")).toBe("14px");
      applyAppearanceThemeToDocument({
        ...input,
        theme: { ...input.theme, editorFontSize: 24, uiFontSize: 20 }
      });
      expect(properties.get("--editor-font-size")).toBe("24px");
      expect(properties.get("--ui-font-size")).toBe("20px");
    }
  );
});

describe("Writer default theme preset", () => {
  it("uses warm book-page light and novel night-mode dark palettes by default", () => {
    const defaults = createDefaultAppearanceSettings();
    expect(defaults.light.preset).toBe("writer");
    expect(defaults.dark.preset).toBe("writer");
    expect(defaults.light).toMatchObject({
      accent: "#8B5E34",
      background: "#F6F1E4",
      foreground: "#2C2824"
    });
    expect(defaults.dark).toMatchObject({
      accent: "#C49A6C",
      background: "#1B1A18",
      foreground: "#C8C2B6"
    });
    expect(themePresets[0]?.id).toBe("writer");
    expect(themePresets[0]?.label).toBe("Writer");
    expect(themePresets[0]?.light).toEqual({
      accent: "#8B5E34",
      background: "#F6F1E4",
      foreground: "#2C2824"
    });
    expect(themePresets[0]?.dark).toEqual({
      accent: "#C49A6C",
      background: "#1B1A18",
      foreground: "#C8C2B6"
    });
  });

  it("migrates legacy codex/writer default palettes while preserving custom colors", () => {
    const defaults = createDefaultAppearanceSettings();
    expect(
      sanitizeAppearanceTheme(
        {
          preset: "codex",
          accent: "#339CFF",
          background: "#FFFFFF",
          foreground: "#1A1C1F"
        },
        "light"
      )
    ).toMatchObject({
      preset: "writer",
      accent: defaults.light.accent,
      background: defaults.light.background,
      foreground: defaults.light.foreground
    });
    expect(
      upgradeLegacyDefaultTheme(
        {
          ...defaults.dark,
          preset: "writer",
          accent: "#6AA8CC",
          background: "#16181A",
          foreground: "#EFEFE9"
        },
        "dark"
      )
    ).toMatchObject({
      preset: "writer",
      accent: defaults.dark.accent,
      background: defaults.dark.background,
      foreground: defaults.dark.foreground
    });
    expect(
      upgradeLegacyDefaultTheme(
        {
          ...defaults.light,
          preset: "custom",
          accent: "#339CFF",
          background: "#FFFFFF",
          foreground: "#1A1C1F"
        },
        "light"
      )
    ).toMatchObject({
      preset: "custom",
      accent: "#339CFF",
      background: "#FFFFFF",
      foreground: "#1A1C1F"
    });
  });
});
