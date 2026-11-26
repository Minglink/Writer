import { describe, expect, it } from "vitest";
import type { UpdateInfo } from "electron-updater";
import type { AppAdapter } from "electron-updater/out/AppAdapter";
import type { DownloadExecutorTask } from "electron-updater/out/AppUpdater";
import { ElectronHttpExecutor } from "electron-updater/out/electronHttpExecutor";
import { NsisUpdater } from "electron-updater/out/NsisUpdater";
import { PacmanUpdater } from "electron-updater/out/PacmanUpdater";
import { GenericProvider } from "electron-updater/out/providers/GenericProvider";
import {
  ArchPackageUpdater,
  createUpdateServiceUpdater
} from "./arch-package-updater";

const app: AppAdapter = {
  version: "9.8.6",
  name: "Writer test",
  isPackaged: true,
  appUpdateConfigPath: "unused-test-config.yml",
  userDataPath: "unused-test-profile",
  baseCachePath: "unused-test-cache",
  whenReady: async () => undefined,
  relaunch: () => undefined,
  quit: () => undefined,
  onQuit: () => undefined
};
const prefix = "Writer-9.8.7-linux-";
const appImage = `${prefix}x86_64-test.AppImage`;
const deb = `${prefix}amd64-test.deb`;
const rpm = `${prefix}x86_64-test.rpm`;
const arch = `${prefix}x64-test.pkg.tar.zst`;
const legacyArch = `${prefix}x64-test.pacman`;

function manifest(names: string[]): UpdateInfo {
  return {
    version: "9.8.7",
    releaseDate: "2026-10-10T00:00:00Z",
    path: names[0] ?? "",
    sha512: "invalid-primary-checksum",
    files: names.map((url) => ({
      url,
      size: 1,
      sha512: `invalid-test-checksum-${url}`
    }))
  };
}

class RecordingArchUpdater extends ArchPackageUpdater {
  readonly downloads: DownloadExecutorTask[] = [];

  constructor(info: UpdateInfo) {
    super(undefined, app);
    this.logger = null;
    this.on("error", () => undefined);
    this.updateInfoAndProvider = {
      info,
      provider: new GenericProvider(
        { provider: "generic", url: "https://example.test/updates/" },
        this,
        {
          platform: "linux",
          isUseMultipleRangeRequest: false,
          executor: new ElectronHttpExecutor(() => undefined)
        }
      )
    };
  }

  protected override async executeDownload(
    task: DownloadExecutorTask
  ): Promise<string[]> {
    this.downloads.push(task);
    return ["unused-test-installer.pkg.tar.zst"];
  }
}

describe("Arch package updates", () => {
  it.each([
    [appImage, deb, rpm, arch],
    [rpm, arch, appImage, deb],
    [arch, appImage, deb, rpm]
  ])(
    "selects the Arch archive when the manifest starts with %s",
    async (...names) => {
      const info = manifest(names);
      const original = structuredClone(info);
      const updater = new RecordingArchUpdater(info);

      await updater.downloadUpdate();

      expect(updater.downloads).toHaveLength(1);
      expect(updater.downloads[0]?.fileInfo.url.href).toBe(
        `https://example.test/updates/${arch}`
      );
      expect(updater.downloads[0]?.fileInfo.info.sha512).toBe(
        `invalid-test-checksum-${arch}`
      );
      expect(info).toEqual(original);
    }
  );

  it.each([
    [appImage, deb, rpm],
    [appImage, deb, rpm, arch, legacyArch],
    [arch, arch]
  ])("rejects missing or ambiguous Arch archives: %j", async (...names) => {
    const updater = new RecordingArchUpdater(manifest(names));

    await expect(updater.downloadUpdate()).rejects.toThrow(
      "更新清单必须包含唯一的 Arch 安装包"
    );
    expect(updater.downloads).toEqual([]);
  });

  it("preserves support for legacy .pacman downloads", async () => {
    const updater = new RecordingArchUpdater(
      manifest([appImage, deb, rpm, legacyArch])
    );

    await updater.downloadUpdate();

    expect(updater.downloads[0]?.fileInfo.url.pathname).toBe(
      `/updates/${legacyArch}`
    );
  });

  it("replaces the native Pacman updater", () => {
    const updater = createUpdateServiceUpdater(
      new PacmanUpdater(undefined, app),
      app
    );
    expect(updater).toBeInstanceOf(ArchPackageUpdater);
  });

  it("retains other native updaters", () => {
    const updater = new NsisUpdater(undefined, app);
    expect(createUpdateServiceUpdater(updater, app)).toBe(updater);
  });

  it("falls back to the default cache directory when app-update.yml is missing", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = await mkdtemp(join(tmpdir(), "writer-nsis-updater-"));
    try {
      const payload = Buffer.from("writer-installer-payload");
      const sha512 = createHash("sha512").update(payload).digest("base64");
      const missingConfigAdapter: AppAdapter = {
        ...app,
        appUpdateConfigPath: join(dir, "missing-app-update.yml"),
        userDataPath: join(dir, "profile"),
        baseCachePath: join(dir, "cache")
      };
      const updater = createUpdateServiceUpdater(
        new NsisUpdater(undefined, missingConfigAdapter),
        missingConfigAdapter
      );
      updater.logger = null;
      updater.disableDifferentialDownload = true;
      updater.disableWebInstaller = true;

      const info: UpdateInfo = {
        version: "9.8.7",
        releaseDate: "2026-10-10T00:00:00Z",
        path: "Writer-9.8.7-win-x64.exe",
        sha512,
        files: [
          { url: "Writer-9.8.7-win-x64.exe", size: payload.length, sha512 }
        ]
      };
      Reflect.set(updater, "httpExecutor", {
        download: async (_url: URL, destination: string) => {
          await writeFile(destination, payload);
          return destination;
        }
      });
      Reflect.set(updater, "updateInfoAndProvider", {
        info,
        provider: new GenericProvider(
          { provider: "generic", url: "https://example.test/updates/" },
          updater,
          {
            platform: "win32",
            isUseMultipleRangeRequest: false,
            executor: new ElectronHttpExecutor(() => undefined)
          }
        )
      });

      const downloaded = await updater.downloadUpdate();
      expect(downloaded).toHaveLength(1);
      expect(downloaded[0]).toContain("@writerdesktop-updater");
      expect(downloaded[0]).toContain("Writer-9.8.7-win-x64.exe");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
