import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import type { AddressInfo } from "node:net";
import { SubscriptionError } from "./types";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier, "ascii")
    .digest("base64url");
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256"
  };
}

export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

export interface OAuthLoopbackOptions {
  state: string;
  callbackPath?: string;
  callbackPaths?: readonly string[];
  preferredPort?: number;
  preferredPorts?: readonly number[];
  redirectHost?: "127.0.0.1" | "localhost";
  allowDynamicFallback?: boolean;
  onReturnToWriter?: () => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OAuthLoopbackCallbackResult {
  code: string;
  state: string;
  callbackPath?: string;
  params: Record<string, string>;
}

export interface OAuthLoopbackHandle {
  readonly port: number;
  readonly redirectUri: string;
  readonly waitForCallback: Promise<OAuthLoopbackCallbackResult>;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;

function writeHtml(
  res: ServerResponse,
  statusCode: number,
  title: string,
  detail: string,
  returnAction?: string
): void {
  const content = `<strong>${title}</strong><span>${detail}</span>`;
  const body = returnAction
    ? `<form method="post" action="${returnAction}"><button type="submit" aria-label="返回 Writer 完成登录"><span class="card">${content}<b>返回 Writer 完成登录</b><small>点击页面空白处也可返回 Writer</small></span></button></form>`
    : `<main><div class="card">${content}</div></main>`;
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action ${returnAction ? new URL(returnAction).origin : "'none'"}`
  });
  res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>
:root{font:16px system-ui,sans-serif;color:#332d26;background:#f6f1e4;color-scheme:light dark}
*{box-sizing:border-box}body,form{margin:0}button,main{display:grid;place-items:center;width:100%;min-height:100vh;padding:24px;border:0;background:transparent;color:inherit;font:inherit;text-align:start}
button{cursor:pointer}button:focus-visible .card{outline:3px solid #91673d;outline-offset:5px}
.card{display:grid;gap:14px;max-width:32rem;width:100%;padding:clamp(24px,5vw,44px);background:#fffcf5;border:1px solid #d9cbb6;border-radius:14px;line-height:1.65}
strong{font-size:1.45rem}b{justify-self:start;background:#80552e;color:white;border-radius:7px;padding:8px 18px;font-size:1rem;margin-top:6px}small{color:#695c4d}
@media(prefers-color-scheme:dark){:root{background:#201e1a;color:#eee6d8}.card{background:#2a2722;border-color:#51493d}small{color:#c6baaa}b{color:#211b16;background:#d4ad80}}
</style></head><body>${body}</body></html>`);
}

// Release the provider's callback port immediately. The browser can return to Writer after token exchange has finished.
async function createReturnAction(showWindow: () => void): Promise<string> {
  const path = "/return/" + randomBytes(24).toString("base64url");
  let used = false;
  const server = createServer((req, res) => {
    if (req.url !== path || used) {
      writeHtml(res, 404, "链接已失效", "请手动切回 Writer 查看登录结果。");
      return;
    }
    if (req.method !== "POST") {
      writeHtml(
        res,
        405,
        "请点击返回按钮",
        "请回到授权结果页，点击返回 Writer。"
      );
      return;
    }
    used = true;
    clearTimeout(timer);
    try {
      showWindow();
      writeHtml(
        res,
        200,
        "已请求返回 Writer",
        "账号保存结果会显示在 Writer 中。你可以关闭这个页面。"
      );
    } catch {
      writeHtml(
        res,
        500,
        "请手动切回 Writer",
        "在 Writer 的订阅模型页面查看账号保存结果。"
      );
    } finally {
      server.close();
    }
  });
  const port = await listenOnPort(server, 0);
  server.unref();
  const timer = setTimeout(() => server.close(), DEFAULT_TIMEOUT_MS);
  timer.unref();
  return `http://127.0.0.1:${port}${path}`;
}

function listenOnPort(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address() as AddressInfo | null;
      if (!address) {
        reject(new Error("Loopback server did not report an address."));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function startOAuthLoopbackServer(
  options: OAuthLoopbackOptions
): Promise<OAuthLoopbackHandle> {
  const callbackPath = options.callbackPath ?? "/callback";
  const acceptedPaths = new Set<string>(
    options.callbackPaths && options.callbackPaths.length > 0
      ? options.callbackPaths
      : [callbackPath]
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowDynamicFallback = options.allowDynamicFallback !== false;

  let settled = false;
  let resolveCallback!: (value: OAuthLoopbackCallbackResult) => void;
  let rejectCallback!: (reason: unknown) => void;
  const waitForCallback = new Promise<OAuthLoopbackCallbackResult>(
    (resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    }
  );
  // Prevent unhandled rejection when callers inspect or close after timeout/cancel.
  waitForCallback.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;

  const cleanupListeners = () => {
    options.signal?.removeEventListener("abort", onAbort);
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!acceptedPaths.has(requestUrl.pathname)) {
        writeHtml(res, 404, "页面不存在", "请返回 Writer 重新发起授权。");
        return;
      }
      const state = requestUrl.searchParams.get("state") ?? "";
      if (!state || state !== options.state) {
        writeHtml(
          res,
          400,
          "授权校验失败",
          "状态校验不匹配，已忽略此次回调。请返回 Writer 重试。"
        );
        return;
      }
      const oauthError = requestUrl.searchParams.get("error");
      if (oauthError) {
        writeHtml(
          res,
          400,
          "授权未完成",
          "授权已被拒绝或失败，你可以关闭此页面并返回 Writer。"
        );
        settleFailure(
          new SubscriptionError(
            "subscriptions.auth_denied",
            "登录授权未完成或已被取消。"
          )
        );
        return;
      }
      const code = requestUrl.searchParams.get("code") ?? "";
      if (!code) {
        writeHtml(
          res,
          400,
          "缺少授权码",
          "回调缺少授权码，请返回 Writer 重试。"
        );
        settleFailure(
          new SubscriptionError(
            "subscriptions.auth_missing_code",
            "回调中缺少授权码，请重新尝试登录。"
          )
        );
        return;
      }
      const params: Record<string, string> = {};
      for (const [key, value] of requestUrl.searchParams.entries()) {
        params[key] = value;
      }
      if (settled) {
        writeHtml(res, 410, "授权码已接收", "请返回 Writer 查看账号添加结果。");
        return;
      }
      const action = options.onReturnToWriter
        ? createReturnAction(options.onReturnToWriter).catch(() => undefined)
        : Promise.resolve(undefined);
      void action.then((url) =>
        writeHtml(
          res,
          200,
          "Writer 已收到授权码",
          "请返回 Writer 查看账号添加结果，并保持登录弹窗打开，直到账号保存完成。",
          url
        )
      );
      settleSuccess({
        code,
        state,
        callbackPath: requestUrl.pathname,
        params
      });
    }
  );

  const closeServer = (): Promise<void> =>
    new Promise((resolve) => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

  const settleSuccess = (result: OAuthLoopbackCallbackResult): void => {
    if (settled) return;
    settled = true;
    cleanupListeners();
    void closeServer();
    resolveCallback(result);
  };

  const settleFailure = (error: SubscriptionError): void => {
    if (settled) return;
    settled = true;
    cleanupListeners();
    void closeServer();
    rejectCallback(error);
  };

  const onAbort = () => {
    settleFailure(
      new SubscriptionError("subscriptions.auth_cancelled", "授权已取消。")
    );
  };

  if (options.signal?.aborted) {
    throw new SubscriptionError("subscriptions.auth_cancelled", "授权已取消。");
  }

  const candidatePorts =
    options.preferredPorts && options.preferredPorts.length > 0
      ? [...options.preferredPorts]
      : [options.preferredPort ?? 0];

  let port: number | undefined;
  let lastError: unknown;
  for (const candidate of candidatePorts) {
    try {
      port = await listenOnPort(server, candidate);
      break;
    } catch (error: unknown) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" && code !== "EACCES") {
        break;
      }
    }
  }
  if (port === undefined) {
    const code = (lastError as NodeJS.ErrnoException | undefined)?.code;
    if (
      (options.preferredPort ||
        (options.preferredPorts && options.preferredPorts.length > 0)) &&
      allowDynamicFallback &&
      (code === "EADDRINUSE" || code === "EACCES")
    ) {
      port = await listenOnPort(server, 0);
    } else {
      const portHint =
        options.preferredPort && !allowDynamicFallback
          ? `端口 ${options.preferredPort} 已被占用，请关闭占用程序后重试。`
          : "无法启动本地授权回调服务，请检查本地端口限制后重试。";
      throw new SubscriptionError(
        "subscriptions.oauth_loopback_failed",
        portHint
      );
    }
  }

  options.signal?.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => {
    settleFailure(
      new SubscriptionError(
        "subscriptions.auth_timeout",
        "等待浏览器授权超时，请重新发起登录。"
      )
    );
  }, timeoutMs);

  const redirectHost = options.redirectHost ?? "127.0.0.1";
  return {
    port,
    redirectUri: `http://${redirectHost}:${port}${callbackPath}`,
    waitForCallback,
    async close(): Promise<void> {
      if (!settled) {
        settleFailure(
          new SubscriptionError("subscriptions.auth_cancelled", "授权已取消。")
        );
      }
      await closeServer();
    }
  };
}
