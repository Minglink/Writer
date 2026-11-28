import {
  SubscriptionCancelAuthInputSchema,
  SubscriptionCancelAuthResultSchema,
  SubscriptionImportLocalInputSchema,
  SubscriptionImportManualInputSchema,
  SubscriptionRefreshModelsInputSchema,
  SubscriptionRefreshQuotaInputSchema,
  SubscriptionRemoveAccountInputSchema,
  SubscriptionScanLocalInputSchema,
  SubscriptionScanLocalResultSchema,
  SubscriptionSetAccountEnabledInputSchema,
  SubscriptionSetDefaultModelInputSchema,
  SubscriptionSetModelEnabledInputSchema,
  SubscriptionSetPrimaryAccountInputSchema,
  SubscriptionSettingsSnapshotSchema,
  SubscriptionStartAuthInputSchema,
  SubscriptionStartAuthResultSchema,
  createEnvelope,
  type SubscriptionsPreloadApi
} from "@writer/contracts";
import { browserId, invokeCommand } from "./invoke";

export const subscriptions: SubscriptionsPreloadApi = {
  async getState() {
    const id = browserId("cmd_subscriptions_get_state");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.getState", {}, { id, correlationId: id })
      )
    );
  },
  async startAuth(rawInput) {
    const input = SubscriptionStartAuthInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_start_auth");
    return SubscriptionStartAuthResultSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.startAuth", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async cancelAuth(rawInput) {
    const input = SubscriptionCancelAuthInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_cancel_auth");
    return SubscriptionCancelAuthResultSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.cancelAuth", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async scanLocal(rawInput) {
    const input = SubscriptionScanLocalInputSchema.parse(rawInput ?? {});
    const id = browserId("cmd_subscriptions_scan_local");
    return SubscriptionScanLocalResultSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.scanLocal", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async importLocal(rawInput) {
    const input = SubscriptionImportLocalInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_import_local");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.importLocal", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async importManual(rawInput) {
    const input = SubscriptionImportManualInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_import_manual");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.importManual", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async setPrimaryAccount(rawInput) {
    const input = SubscriptionSetPrimaryAccountInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_set_primary");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.setPrimaryAccount", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async setAccountEnabled(rawInput) {
    const input = SubscriptionSetAccountEnabledInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_set_account_enabled");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.setAccountEnabled", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async removeAccount(rawInput) {
    const input = SubscriptionRemoveAccountInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_remove_account");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.removeAccount", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async refreshQuota(rawInput) {
    const input = SubscriptionRefreshQuotaInputSchema.parse(rawInput ?? {});
    const id = browserId("cmd_subscriptions_refresh_quota");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.refreshQuota", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async refreshModels(rawInput) {
    const input = SubscriptionRefreshModelsInputSchema.parse(rawInput ?? {});
    const id = browserId("cmd_subscriptions_refresh_models");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.refreshModels", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async setModelEnabled(rawInput) {
    const input = SubscriptionSetModelEnabledInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_set_model_enabled");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.setModelEnabled", input, {
          id,
          correlationId: id
        })
      )
    );
  },
  async setDefaultModel(rawInput) {
    const input = SubscriptionSetDefaultModelInputSchema.parse(rawInput);
    const id = browserId("cmd_subscriptions_set_default_model");
    return SubscriptionSettingsSnapshotSchema.parse(
      await invokeCommand(
        createEnvelope("subscriptions.setDefaultModel", input, {
          id,
          correlationId: id
        })
      )
    );
  }
};
