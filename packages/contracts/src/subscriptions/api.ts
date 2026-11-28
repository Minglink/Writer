import type {
  SubscriptionCancelAuthInput,
  SubscriptionImportLocalInput,
  SubscriptionImportManualInput,
  SubscriptionRefreshModelsInput,
  SubscriptionRefreshQuotaInput,
  SubscriptionRemoveAccountInput,
  SubscriptionScanLocalInput,
  SubscriptionSetAccountEnabledInput,
  SubscriptionSetDefaultModelInput,
  SubscriptionSetModelEnabledInput,
  SubscriptionSetPrimaryAccountInput,
  SubscriptionStartAuthInput
} from "./commands";
import type {
  SubscriptionCancelAuthResult,
  SubscriptionScanLocalResult,
  SubscriptionSettingsSnapshot,
  SubscriptionStartAuthResult
} from "./schemas";

export interface SubscriptionsPreloadApi {
  getState(): Promise<SubscriptionSettingsSnapshot>;
  startAuth(
    input: SubscriptionStartAuthInput
  ): Promise<SubscriptionStartAuthResult>;
  cancelAuth(
    input: SubscriptionCancelAuthInput
  ): Promise<SubscriptionCancelAuthResult>;
  scanLocal(
    input?: SubscriptionScanLocalInput
  ): Promise<SubscriptionScanLocalResult>;
  importLocal(
    input: SubscriptionImportLocalInput
  ): Promise<SubscriptionSettingsSnapshot>;
  importManual(
    input: SubscriptionImportManualInput
  ): Promise<SubscriptionSettingsSnapshot>;
  setPrimaryAccount(
    input: SubscriptionSetPrimaryAccountInput
  ): Promise<SubscriptionSettingsSnapshot>;
  setAccountEnabled(
    input: SubscriptionSetAccountEnabledInput
  ): Promise<SubscriptionSettingsSnapshot>;
  removeAccount(
    input: SubscriptionRemoveAccountInput
  ): Promise<SubscriptionSettingsSnapshot>;
  refreshQuota(
    input?: SubscriptionRefreshQuotaInput
  ): Promise<SubscriptionSettingsSnapshot>;
  refreshModels(
    input?: SubscriptionRefreshModelsInput
  ): Promise<SubscriptionSettingsSnapshot>;
  setModelEnabled(
    input: SubscriptionSetModelEnabledInput
  ): Promise<SubscriptionSettingsSnapshot>;
  setDefaultModel(
    input: SubscriptionSetDefaultModelInput
  ): Promise<SubscriptionSettingsSnapshot>;
}
