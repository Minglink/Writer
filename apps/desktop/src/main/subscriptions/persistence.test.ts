import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SubscriptionPersistence } from "./persistence";
import {
  SubscriptionError,
  type SecureStorageLike,
  type StoredAccountRecord
} from "./types";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

function createFakeStorage(
  options: {
    available?: boolean;
    brokenDecrypt?: boolean;
  } = {}
): SecureStorageLike & { available: boolean; brokenDecrypt: boolean } {
  const state = {
    available: options.available ?? true,
    brokenDecrypt: options.brokenDecrypt ?? false,
    isEncryptionAvailable() {
      return state.available;
    },
    encryptString(plainText: string): Buffer {
      // Reversible XOR-like marker so plaintext never appears verbatim on disk.
      return Buffer.from(
        `ENC::${Buffer.from(plainText, "utf8").toString("hex")}`,
        "utf8"
      );
    },
    decryptString(encrypted: Buffer): string {
      if (state.brokenDecrypt) {
        throw new Error("OS keychain locked");
      }
      const raw = encrypted.toString("utf8");
      if (!raw.startsWith("ENC::")) {
        throw new Error("invalid ciphertext");
      }
      return Buffer.from(raw.slice(5), "hex").toString("utf8");
    }
  };
  return state;
}

function sampleAccount(id = "sub_acct_1"): StoredAccountRecord {
  return {
    id,
    provider: "google-gemini-cli",
    displayName: "user@example.test",
    email: "user@example.test",
    planTier: "Pro",
    source: "oauth",
    isPrimary: true,
    enabled: true,
    status: "active",
    consecutiveRateLimits: 0,
    quotaBuckets: [],
    createdAt: "2026-11-27T12:00:00.000Z"
  };
}

describe("SubscriptionPersistence", () => {
  it("encrypts secrets atomically and never writes plaintext tokens to disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-persist-"));
    tempDirs.push(root);
    const storage = createFakeStorage();
    const persistence = new SubscriptionPersistence(root, {
      secureStorage: storage
    });

    const accessToken = "access-token-placeholder-alpha";
    const refreshToken = "refresh-token-placeholder-beta";
    const encrypted = persistence.encryptSecret({
      accessToken,
      refreshToken,
      expiresAt: "2026-11-27T13:00:00.000Z",
      extra: { projectId: "demo-project" }
    });

    await persistence.update((state) => ({
      state: {
        ...state,
        accounts: [sampleAccount("sub_acct_1")],
        encryptedSecrets: { sub_acct_1: encrypted }
      },
      result: undefined
    }));

    const diskContent = await readFile(persistence.filePath, "utf8");
    expect(diskContent).not.toContain(accessToken);
    expect(diskContent).not.toContain(refreshToken);

    const reloaded = await persistence.read();
    expect(reloaded.accounts).toHaveLength(1);
    const decrypted = persistence.decryptSecret(
      reloaded.encryptedSecrets.sub_acct_1
    );
    expect(decrypted).toEqual({
      accessToken,
      refreshToken,
      expiresAt: "2026-11-27T13:00:00.000Z",
      extra: { projectId: "demo-project" }
    });
  });

  it("refuses plaintext persistence when safeStorage is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-no-safe-"));
    tempDirs.push(root);
    const storage = createFakeStorage({ available: false });
    const persistence = new SubscriptionPersistence(root, {
      secureStorage: storage
    });

    let caught: unknown;
    try {
      persistence.encryptSecret({
        accessToken: "never-write-plaintext-token",
        refreshToken: "never-write-plaintext-refresh"
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SubscriptionError);
    expect((caught as SubscriptionError).code).toBe(
      "subscriptions.safe_storage_unavailable"
    );
    expect((caught as Error).message).not.toContain(
      "never-write-plaintext-token"
    );
    await expect(readFile(persistence.filePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("reports structured error codes on decrypt failure and corrupted store without leaking data", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-corrupt-"));
    tempDirs.push(root);
    const storage = createFakeStorage();
    const persistence = new SubscriptionPersistence(root, {
      secureStorage: storage
    });
    const encrypted = persistence.encryptSecret({
      accessToken: "secret-access-placeholder"
    });
    await persistence.update((state) => ({
      state: {
        ...state,
        accounts: [sampleAccount("sub_acct_1")],
        encryptedSecrets: { sub_acct_1: encrypted }
      },
      result: undefined
    }));

    storage.brokenDecrypt = true;
    try {
      persistence.decryptSecret(encrypted);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SubscriptionError);
      expect((error as SubscriptionError).code).toBe(
        "subscriptions.secret_decrypt_failed"
      );
      expect((error as Error).message).not.toContain(
        "secret-access-placeholder"
      );
    }

    await writeFile(persistence.filePath, "{ invalid json secret-leak", "utf8");
    await expect(persistence.read()).rejects.toMatchObject({
      code: "subscriptions.corrupted_store"
    });

    await writeFile(
      persistence.filePath,
      JSON.stringify({ version: 99, accounts: [], encryptedSecrets: {} }),
      "utf8"
    );
    await expect(persistence.read()).rejects.toMatchObject({
      code: "subscriptions.corrupted_store"
    });
  });

  it("prunes orphaned encrypted secrets when accounts are removed and serializes concurrent updates", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-sub-concurrent-"));
    tempDirs.push(root);
    const storage = createFakeStorage();
    const persistence = new SubscriptionPersistence(root, {
      secureStorage: storage
    });

    await Promise.all([
      persistence.update((state) => ({
        state: {
          ...state,
          accounts: [...state.accounts, sampleAccount("acct_a")],
          encryptedSecrets: {
            ...state.encryptedSecrets,
            acct_a: persistence.encryptSecret({ accessToken: "tok-a" })
          }
        },
        result: undefined
      })),
      persistence.update((state) => ({
        state: {
          ...state,
          accounts: [...state.accounts, sampleAccount("acct_b")],
          encryptedSecrets: {
            ...state.encryptedSecrets,
            acct_b: persistence.encryptSecret({ accessToken: "tok-b" })
          }
        },
        result: undefined
      }))
    ]);

    const both = await persistence.read();
    expect(both.accounts.map((a) => a.id).sort()).toEqual(["acct_a", "acct_b"]);

    await persistence.update((state) => ({
      state: {
        ...state,
        accounts: state.accounts.filter((a) => a.id !== "acct_a")
      },
      result: undefined
    }));
    const afterPrune = await persistence.read();
    expect(Object.keys(afterPrune.encryptedSecrets)).toEqual(["acct_b"]);
  });
});
