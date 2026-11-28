import { describe, expect, it } from "vitest";
import { TokenRefreshLock } from "./token-refresh-lock";

describe("TokenRefreshLock", () => {
  it("deduplicates concurrent refreshes for the same accountId while allowing parallel accounts", async () => {
    const lock = new TokenRefreshLock();
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let callsA = 0;
    let callsB = 0;

    const p1 = lock.run("acct_a", async () => {
      callsA += 1;
      await gateA;
      return "fresh-token-a";
    });
    const p2 = lock.run("acct_a", async () => {
      callsA += 1;
      return "should-not-run";
    });
    const pB = lock.run("acct_b", async () => {
      callsB += 1;
      return "fresh-token-b";
    });

    expect(lock.isRefreshing("acct_a")).toBe(true);
    expect(await pB).toBe("fresh-token-b");
    expect(callsB).toBe(1);

    releaseA();
    expect(await Promise.all([p1, p2])).toEqual([
      "fresh-token-a",
      "fresh-token-a"
    ]);
    expect(callsA).toBe(1);
    expect(lock.isRefreshing("acct_a")).toBe(false);
  });

  it("releases the lock on failure so subsequent refresh attempts can proceed", async () => {
    const lock = new TokenRefreshLock();
    let attempt = 0;

    await expect(
      lock.run("acct_a", async () => {
        attempt += 1;
        throw new Error("transient failure");
      })
    ).rejects.toThrow("transient failure");
    expect(lock.isRefreshing("acct_a")).toBe(false);

    const second = await lock.run("acct_a", async () => {
      attempt += 1;
      return "recovered-token";
    });
    expect(second).toBe("recovered-token");
    expect(attempt).toBe(2);
  });
});
