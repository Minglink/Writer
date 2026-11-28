import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type ModelConfig,
  type UtilityInternalCommandTarget,
  type UtilityWorkerName
} from "@writer/contracts";
import {
  AGENT_MAIN_SUBSCRIPTION_COMMANDS,
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "../internal-command-authorizer";
import { handleModelCommands } from "../ipc/model-commands";
import type { IpcCommandContext } from "../ipc/command-types";
import { SubscriptionAccountManager } from "./manager";
import { ProviderAdapterRegistry } from "./registry";
import { handleSubscriptionInternalCommand } from "./internal-bridge";
import type {
  SecureStorageLike,
  SubscriptionModelDefinition,
  SubscriptionProviderAdapter
} from "./types";

const electronMocks = vi.hoisted(() => ({
  fork: vi.fn()
}));

vi.mock("electron", () => ({
  utilityProcess: {
    fork: electronMocks.fork
  }
}));

import { UtilitySupervisor } from "../supervisor";
import { createSubscriptionCredentialBridge } from "../../utilities/agent-run-input";

class FakeUtilityProcess extends EventEmitter {
  readonly posted: unknown[] = [];
  readonly pid: number;
  private exited = false;

  constructor(
    readonly worker: UtilityWorkerName,
    pid: number
  ) {
    super();
    this.pid = pid;
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
    const kind = (message as { kind?: string }).kind ?? "unknown";
    if (kind === "utility.shutdown") {
      const requestId = (message as { requestId: string }).requestId;
      queueMicrotask(() => {
        this.emit("message", {
          kind: "utility.shutdown_ack",
          worker: this.worker,
          requestId,
          timestamp: new Date().toISOString()
        });
        this.exited = true;
        this.emit("exit", 0);
      });
    }
  }

  kill(): boolean {
    if (!this.exited) {
      this.exited = true;
      this.emit("exit", null);
    }
    return true;
  }

  dispatch(message: unknown): void {
    this.emit("message", message);
  }
}

async function waitForPosted(
  child: FakeUtilityProcess,
  requestId: string
): Promise<Record<string, unknown>> {
  return vi.waitFor(() => {
    const found = child.posted.find(
      (msg) => (msg as { requestId?: string }).requestId === requestId
    );
    expect(found).toBeDefined();
    return found as Record<string, unknown>;
  });
}

const fakeSecureStorage: SecureStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (value) =>
    Buffer.from(`ENC::${Buffer.from(value, "utf8").toString("hex")}`, "utf8"),
  decryptString: (value) =>
    Buffer.from(value.toString("utf8").slice(5), "hex").toString("utf8")
};

const CODEX_MODEL: SubscriptionModelDefinition = {
  id: "sub:openai-codex:gpt-5.3-codex",
  provider: "openai-codex",
  modelId: "gpt-5.3-codex",
  label: "GPT-5.3 Codex",
  api: "openai-codex-responses",
  baseUrl: "https://codex.example.test/backend-api",
  reasoning: true,
  defaultThinkingLevel: "medium",
  recommended: true
};

function createTestAdapter(): SubscriptionProviderAdapter {
  return {
    id: "openai-codex",
    meta: {
      name: "OpenAI Codex",
      description: "Test adapter",
      phase: 1,
      supportedAuthMethods: ["oauth", "local_import"]
    },
    scanLocalCandidates: async () => [
      {
        candidateId: "cand_1",
        provider: "openai-codex",
        displayName: "Primary User",
        sourceLabel: "Local"
      },
      {
        candidateId: "cand_2",
        provider: "openai-codex",
        displayName: "Backup User",
        sourceLabel: "Local"
      }
    ],
    importLocalCandidate: async (candidateId) => ({
      displayName: candidateId === "cand_1" ? "Primary User" : "Backup User",
      source: "local_import",
      secret: {
        accessToken:
          candidateId === "cand_1"
            ? "codex-access-primary"
            : "codex-access-backup",
        refreshToken:
          candidateId === "cand_1"
            ? "codex-refresh-primary"
            : "codex-refresh-backup",
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    }),
    refreshSecret: async (_account, secret) => ({
      ...secret,
      accessToken: `${secret.accessToken}-refreshed`
    }),
    fetchQuota: async () => ({ quotaBuckets: [] }),
    listModels: async () => [CODEX_MODEL],
    toRuntimeCredential: (account, secret) => ({
      provider: "openai-codex",
      accountId: account.id,
      apiKey: secret.accessToken,
      baseUrl: "https://codex.example.test/backend-api",
      ...(secret.expiresAt ? { expiresAt: secret.expiresAt } : {}),
      extraHeaders: { "chatgpt-account-id": `org_${account.id}` }
    })
  };
}

describe("Main <-> Agent subscription credential bridge", () => {
  const processes = new Map<UtilityWorkerName, FakeUtilityProcess>();
  const supervisors: UtilitySupervisor[] = [];
  const tempDirs: string[] = [];
  let nextPid = 20_000;

  beforeEach(() => {
    processes.clear();
    nextPid = 20_000;
    electronMocks.fork.mockReset();
    electronMocks.fork.mockImplementation(
      (
        _entryPath: string,
        _args: string[],
        options: { serviceName: string }
      ) => {
        const worker = options.serviceName.replace(
          "writer-",
          ""
        ) as UtilityWorkerName;
        const child = new FakeUtilityProcess(worker, nextPid);
        nextPid += 1;
        processes.set(worker, child);
        return child;
      }
    );
  });

  afterEach(async () => {
    await Promise.all(
      supervisors.splice(0).map((supervisor) => supervisor.shutdownAll())
    );
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  function makeAcquireCommand(
    runId: string,
    sessionId?: string
  ): CommandEnvelope {
    return CommandEnvelopeSchema.parse(
      createEnvelope(
        "subscriptions.acquireCredential",
        {
          runId,
          provider: "openai-codex",
          modelId: CODEX_MODEL.id
        },
        {
          id: "cmd_sub_acq_1",
          ...(sessionId || runId
            ? { context: { runId, ...(sessionId ? { sessionId } : {}) } }
            : {})
        }
      )
    );
  }

  function makeFailoverCommand(
    runId: string,
    failedAccountId: string,
    sessionId?: string
  ): CommandEnvelope {
    return CommandEnvelopeSchema.parse(
      createEnvelope(
        "subscriptions.reportAndFailover",
        {
          runId,
          provider: "openai-codex",
          modelId: CODEX_MODEL.id,
          failedAccountId,
          reason: "rate_limited",
          retryAfterSec: 60
        },
        {
          id: "cmd_sub_fail_1",
          context: { runId, ...(sessionId ? { sessionId } : {}) }
        }
      )
    );
  }

  it("authorizes target:main subscription commands strictly against activeRuns and activeModelTests", () => {
    const activeRuns = new Map<string, MainInternalCommandActiveRun>([
      [
        "run_ok",
        {
          sessionId: "sess_ok",
          promptRequestId: "req_prompt_1",
          accepted: true
        }
      ],
      [
        "run_unaccepted",
        {
          sessionId: "sess_bad",
          promptRequestId: "req_prompt_2",
          accepted: false
        }
      ]
    ]);
    const activeModelTests = new Set<string>(["cmd_model_test_1"]);

    expect(
      authorizeMainInternalCommand(
        {
          source: "agent",
          target: "main",
          message: {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "main",
            requestId: "bridge_1",
            parentRequestId: "req_prompt_1",
            timeoutMs: 1_000,
            command: makeAcquireCommand("run_ok", "sess_ok")
          }
        },
        activeRuns,
        activeModelTests
      )
    ).toBe(true);

    expect(
      authorizeMainInternalCommand(
        {
          source: "agent",
          target: "main",
          message: {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "main",
            requestId: "bridge_2",
            parentRequestId: "cmd_model_test_1",
            timeoutMs: 1_000,
            command: makeAcquireCommand("cmd_model_test_1")
          }
        },
        activeRuns,
        activeModelTests
      )
    ).toBe(true);

    expect(
      authorizeMainInternalCommand(
        {
          source: "agent",
          target: "main",
          message: {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "main",
            requestId: "bridge_3",
            parentRequestId: "req_wrong",
            timeoutMs: 1_000,
            command: makeAcquireCommand("run_ok", "sess_ok")
          }
        },
        activeRuns,
        activeModelTests
      )
    ).toMatchObject({
      authorized: false,
      code: "main.subscription_bridge_not_authorized"
    });

    expect(
      authorizeMainInternalCommand(
        {
          source: "agent",
          target: "main",
          message: {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "main",
            requestId: "bridge_4",
            parentRequestId: "req_prompt_2",
            timeoutMs: 1_000,
            command: makeAcquireCommand("run_unaccepted", "sess_bad")
          }
        },
        activeRuns,
        activeModelTests
      )
    ).toMatchObject({
      authorized: false,
      code: "main.subscription_bridge_not_authorized"
    });

    expect(
      authorizeMainInternalCommand(
        {
          source: "agent",
          target: "main",
          message: {
            kind: "utility.internal.command.request",
            worker: "agent",
            target: "main",
            requestId: "bridge_5",
            parentRequestId: "req_prompt_1",
            timeoutMs: 1_000,
            command: CommandEnvelopeSchema.parse(
              createEnvelope("subscriptions.getState", {}, { id: "cmd_forbid" })
            )
          }
        },
        activeRuns,
        activeModelTests
      )
    ).toMatchObject({
      authorized: false,
      code: "main.subscription_command_not_allowed"
    });
  });

  it("serves acquireCredential and reportAndFailover through UtilitySupervisor without leaking refresh tokens", async () => {
    const dir = await mkdtemp(join(tmpdir(), "writer-sub-bridge-"));
    tempDirs.push(dir);

    const registry = new ProviderAdapterRegistry();
    registry.register(createTestAdapter());
    const manager = new SubscriptionAccountManager(dir, {
      registry,
      secureStorage: fakeSecureStorage,
      now: () => new Date("2026-11-28T00:00:00.000Z").getTime()
    });
    await manager.initialize();
    const first = await manager.importLocal({
      provider: "openai-codex",
      candidateId: "cand_1"
    });
    const second = await manager.importLocal({
      provider: "openai-codex",
      candidateId: "cand_2"
    });
    const firstAccounts = first.providers.find(
      (p) => p.provider === "openai-codex"
    )!.accounts;
    const secondAccounts = second.providers.find(
      (p) => p.provider === "openai-codex"
    )!.accounts;
    const primaryId = firstAccounts[0]!.id;
    const backupId = secondAccounts.find((a) => a.id !== primaryId)!.id;

    const activeRuns = new Map<string, MainInternalCommandActiveRun>([
      [
        "run_live_1",
        {
          sessionId: "sess_live_1",
          promptRequestId: "req_live_1",
          accepted: true
        }
      ]
    ]);
    const activeModelTests = new Set<string>();

    const supervisor = new UtilitySupervisor({
      onUtilityEvent: vi.fn(),
      onUnexpectedExit: vi.fn(),
      onWorkerRestarted: vi.fn(),
      internalCommandAllowlist: {
        main: AGENT_MAIN_SUBSCRIPTION_COMMANDS
      },
      internalCommandAuthorize: (ctx) =>
        authorizeMainInternalCommand(ctx, activeRuns, activeModelTests),
      internalCommandHandle: (ctx) =>
        handleSubscriptionInternalCommand(ctx, () => manager)
    });
    supervisors.push(supervisor);
    supervisor.startAll();

    const agentChild = processes.get("agent")!;
    for (const worker of ["core", "agent", "tool"] as const) {
      processes.get(worker)!.dispatch({
        kind: "utility.ready",
        worker,
        timestamp: new Date().toISOString()
      });
    }

    const dispatchBridge = (
      target: UtilityInternalCommandTarget,
      command: CommandEnvelope,
      requestId: string,
      parentRequestId: string
    ) => {
      agentChild.dispatch({
        kind: "utility.internal.command.request",
        worker: "agent",
        target,
        requestId,
        parentRequestId,
        timeoutMs: 1_000,
        command
      });
    };

    dispatchBridge(
      "main",
      makeAcquireCommand("run_live_1", "sess_live_1"),
      "bridge_acq_1",
      "req_live_1"
    );

    const acquireReply = (await waitForPosted(agentChild, "bridge_acq_1")) as {
      kind: string;
      result: { status: string; payload?: Record<string, unknown> };
    };
    expect(acquireReply.kind).toBe("utility.internal.command.result");
    expect(acquireReply.result.status).toBe("accepted");
    expect(acquireReply.result.payload).toMatchObject({
      provider: "openai-codex",
      accountId: primaryId,
      apiKey: "codex-access-primary",
      extraHeaders: { "chatgpt-account-id": `org_${primaryId}` }
    });
    expect(JSON.stringify(acquireReply)).not.toContain("codex-refresh-primary");

    dispatchBridge(
      "main",
      makeFailoverCommand("run_live_1", primaryId, "sess_live_1"),
      "bridge_fail_1",
      "req_live_1"
    );

    const failoverReply = (await waitForPosted(
      agentChild,
      "bridge_fail_1"
    )) as {
      kind: string;
      result: { status: string; payload?: Record<string, unknown> };
    };
    expect(failoverReply.kind).toBe("utility.internal.command.result");
    expect(failoverReply.result.status).toBe("accepted");
    expect(failoverReply.result.payload).toMatchObject({
      accountId: backupId,
      apiKey: "codex-access-backup"
    });
    const stateAfter = await manager.getState();
    const codexAccountsAfter = stateAfter.providers.find(
      (p) => p.provider === "openai-codex"
    )!.accounts;
    expect(codexAccountsAfter.find((a) => a.id === primaryId)?.status).toBe(
      "cooldown"
    );

    dispatchBridge(
      "main",
      CommandEnvelopeSchema.parse(
        createEnvelope("subscriptions.getState", {}, { id: "cmd_bad_main" })
      ),
      "bridge_forbid_1",
      "req_live_1"
    );

    const forbiddenReply = (await waitForPosted(
      agentChild,
      "bridge_forbid_1"
    )) as {
      kind: string;
      result: { status: string; error?: { code: string } };
    };
    expect(forbiddenReply.kind).toBe("utility.internal.command.result");
    expect(forbiddenReply.result.status).toBe("rejected");
    expect(forbiddenReply.result.error?.code).toBe(
      "utility.internal_command_not_allowed"
    );
  });

  it("tracks activeModelTests around models.test and formats Agent bridge commands", async () => {
    const activeModelTests = new Set<string>();
    let observedActiveDuringCall = false;
    const subModel: ModelConfig = {
      id: CODEX_MODEL.id,
      label: CODEX_MODEL.label,
      provider: "openai-codex",
      modelId: CODEX_MODEL.modelId,
      api: "openai-codex-responses",
      baseUrl: "https://codex.example.test/backend-api",
      reasoning: true,
      defaultThinkingLevel: "medium",
      thinkingLevelOptions: ["low", "medium", "high"],
      temperatureOptions: [0.1, 0.7, 1],
      managedBy: "subscription",
      hasApiKey: true
    };

    const ctx = {
      activeModelTests,
      supervisor: {
        requestCommand: vi.fn(async (_worker: string, cmd: CommandEnvelope) => {
          observedActiveDuringCall = activeModelTests.has(cmd.id);
          return {
            status: "accepted" as const,
            requestId: cmd.id,
            payload: {
              modelId: subModel.id,
              ok: true,
              message: "连接成功",
              testedAt: "2026-11-28T00:00:00.000Z",
              contextWindow: 272_000,
              maxTokens: 128_000
            }
          };
        })
      },
      requireModelConfigStore: () => ({
        resolveDraft: vi.fn(async () => ({
          ...subModel,
          apiKey: "codex-access-primary",
          subscriptionAuth: {
            provider: "openai-codex" as const,
            accountId: "sub_1"
          }
        }))
      }),
      requireModelUsageStore: () => ({
        record: vi.fn(async () => undefined)
      })
    } as unknown as IpcCommandContext;

    const testCmd = CommandEnvelopeSchema.parse(
      createEnvelope(
        "models.test",
        { model: subModel },
        { id: "cmd_test_sub_1" }
      )
    );
    const result = await handleModelCommands(ctx, testCmd);
    expect(result?.status).toBe("accepted");
    expect(observedActiveDuringCall).toBe(true);
    expect(activeModelTests.has("cmd_test_sub_1")).toBe(false);

    const seenCommands: Array<{ target: string; command: CommandEnvelope }> =
      [];
    const bridge = createSubscriptionCredentialBridge(
      {
        requestInternalCommand: async (
          target: UtilityInternalCommandTarget,
          command: CommandEnvelope
        ) => {
          seenCommands.push({ target, command });
          return {
            status: "accepted",
            requestId: command.id,
            payload: {
              provider: "openai-codex",
              accountId: "sub_1",
              apiKey: "short-token"
            }
          };
        }
      } as never,
      { runId: "run_xyz", sessionId: "sess_xyz" }
    );
    const cred = await bridge.acquireCredential({
      provider: "openai-codex",
      modelId: CODEX_MODEL.id
    });
    expect(cred.apiKey).toBe("short-token");
    expect(seenCommands[0]?.target).toBe("main");
    expect(seenCommands[0]?.command.type).toBe(
      "subscriptions.acquireCredential"
    );
    expect(seenCommands[0]?.command.context).toEqual(
      expect.objectContaining({
        runId: "run_xyz",
        sessionId: "sess_xyz"
      })
    );
  });
});
