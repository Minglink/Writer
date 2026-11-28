import type {
  SubscriptionAcquiredCredential,
  SubscriptionFailoverReason,
  SubscriptionProviderId
} from "@writer/contracts";

export interface SubscriptionCredentialBridge {
  acquireCredential(input: {
    provider: SubscriptionProviderId;
    modelId: string;
    accountId?: string;
  }): Promise<SubscriptionAcquiredCredential>;

  reportAndFailover(input: {
    provider: SubscriptionProviderId;
    modelId: string;
    failedAccountId: string;
    reason: SubscriptionFailoverReason;
    retryAfterSec?: number;
    resetAt?: string;
    message?: string;
  }): Promise<SubscriptionAcquiredCredential>;
}
