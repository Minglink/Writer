import type { AppUpdater } from "electron-updater";
import type { AppAdapter } from "electron-updater/out/AppAdapter";
import type { DownloadUpdateOptions } from "electron-updater/out/AppUpdater";
import { PacmanUpdater } from "electron-updater/out/PacmanUpdater";

export class ArchPackageUpdater extends PacmanUpdater {
  protected override async doDownloadUpdate(
    options: DownloadUpdateOptions
  ): Promise<string[]> {
    const { info } = options.updateInfoAndProvider;
    const files = info.files.filter((file) => {
      const name = file.url.toLowerCase();
      return name.endsWith(".pkg.tar.zst") || name.endsWith(".pacman");
    });
    const [file] = files;
    if (!file || files.length !== 1) {
      throw new Error("更新清单必须包含唯一的 Arch 安装包。");
    }

    // electron-updater 6.6.2 only matches .pacman, then falls back to another
    // format. Restrict its input while retaining native download and install.
    return super.doDownloadUpdate({
      ...options,
      updateInfoAndProvider: {
        ...options.updateInfoAndProvider,
        info: {
          ...info,
          files,
          path: file.url,
          sha512: file.sha512
        }
      }
    });
  }
}

const DEFAULT_UPDATER_CACHE_DIR_NAME = "@writerdesktop-updater";

function withMissingUpdateConfigFallback(updater: AppUpdater): AppUpdater {
  const loadUpdateConfig: unknown = Reflect.get(updater, "loadUpdateConfig");
  if (typeof loadUpdateConfig !== "function") return updater;
  Reflect.set(updater, "loadUpdateConfig", async () => {
    try {
      return await (loadUpdateConfig as () => Promise<unknown>).call(updater);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return { updaterCacheDirName: DEFAULT_UPDATER_CACHE_DIR_NAME };
      }
      throw error;
    }
  });
  return updater;
}

export function createUpdateServiceUpdater(
  updater: AppUpdater,
  app?: AppAdapter
): AppUpdater {
  const target =
    updater instanceof PacmanUpdater
      ? new ArchPackageUpdater(undefined, app)
      : updater;
  return withMissingUpdateConfigFallback(target);
}
