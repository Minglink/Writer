import {
  createDefaultGeneralSettings,
  type WriterApi
} from "@writer/contracts";

export function createGeneralSettingsTestApi(): WriterApi["generalSettings"] {
  return {
    async list() {
      return {
        persisted: false,
        settings: {
          ...createDefaultGeneralSettings(),
          permissionMode: "request-approval",
          autoSave: false
        }
      };
    },
    async save(settings) {
      return { persisted: true, settings };
    },
    async openNotificationSettings() {}
  };
}
