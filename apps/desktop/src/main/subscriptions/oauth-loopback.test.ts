import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  generateOAuthState,
  generatePkcePair,
  startOAuthLoopbackServer
} from "./oauth-loopback";

describe("oauth-loopback", () => {
  it("generates RFC 7636 S256 PKCE pairs and random states", () => {
    const pkce = generatePkcePair();
    expect(pkce.codeChallengeMethod).toBe("S256");
    expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expectedChallenge = createHash("sha256")
      .update(pkce.codeVerifier, "ascii")
      .digest("base64url");
    expect(pkce.codeChallenge).toBe(expectedChallenge);
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });

  it("verifies state, ignores mismatched callbacks, and resolves with authorization code", async () => {
    const state = generateOAuthState();
    const handle = await startOAuthLoopbackServer({
      state,
      callbackPath: "/oauth2callback",
      timeoutMs: 10_000
    });

    try {
      const badState = await fetch(
        `${handle.redirectUri}?code=wrong&state=invalid-state`
      );
      expect(badState.status).toBe(400);

      const valid = await fetch(
        `${handle.redirectUri}?code=auth-code-123&state=${encodeURIComponent(state)}`
      );
      expect(valid.status).toBe(200);
      const page = await valid.text();
      expect(page).toContain("已收到授权码");
      expect(page).not.toContain("授权成功");

      const callback = await handle.waitForCallback;
      expect(callback.code).toBe("auth-code-123");
      expect(callback.state).toBe(state);
    } finally {
      await handle.close();
    }
  });

  it("completes exchange independently of the one-use return action", async () => {
    let focused = 0;
    const handle = await startOAuthLoopbackServer({
      state: "fixture-state",
      onReturnToWriter: () => {
        focused += 1;
      }
    });
    const page = await fetch(
      handle.redirectUri + "?state=fixture-state&code=fixture-code"
    );
    const html = await page.text();
    expect(html).toContain("点击页面空白处");
    expect(html).not.toContain("fixture-code");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await handle.waitForCallback).code).toBe("fixture-code");
    await handle.close();
    const action = html.match(/action="([^"]+)"/u)?.[1];
    expect(action).toBeTruthy();
    expect((await fetch(action!)).status).toBe(405);
    expect(focused).toBe(0);
    expect((await fetch(action!, { method: "POST" })).status).toBe(200);
    expect(focused).toBe(1);
  });

  it("falls back to a dynamic port when the preferred port is busy", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) =>
      blocker.listen(0, "127.0.0.1", () => resolve())
    );
    const occupiedPort = (blocker.address() as AddressInfo).port;

    const handle = await startOAuthLoopbackServer({
      state: "state-fallback",
      preferredPort: occupiedPort,
      allowDynamicFallback: true,
      timeoutMs: 10_000
    });

    try {
      expect(handle.port).not.toBe(occupiedPort);
      expect(handle.redirectUri).toBe(
        `http://127.0.0.1:${handle.port}/callback`
      );
    } finally {
      await handle.close();
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("rejects with subscriptions.auth_cancelled when aborted", async () => {
    const controller = new AbortController();
    const handle = await startOAuthLoopbackServer({
      state: "state-cancel",
      signal: controller.signal,
      timeoutMs: 10_000
    });
    controller.abort();
    await expect(handle.waitForCallback).rejects.toMatchObject({
      code: "subscriptions.auth_cancelled"
    });
  });
});
