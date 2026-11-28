/**
 * Single-flight lock keyed by accountId so concurrent token refresh requests
 * share one upstream refresh call instead of racing on the same refresh token.
 */
export class TokenRefreshLock {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(accountId: string, refresh: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(accountId);
    if (existing) {
      return existing as Promise<T>;
    }
    const task = Promise.resolve()
      .then(refresh)
      .finally(() => {
        if (this.inFlight.get(accountId) === task) {
          this.inFlight.delete(accountId);
        }
      });
    this.inFlight.set(accountId, task);
    return task;
  }

  isRefreshing(accountId: string): boolean {
    return this.inFlight.has(accountId);
  }
}
