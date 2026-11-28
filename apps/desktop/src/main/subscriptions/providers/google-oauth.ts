import { SubscriptionError, type AuthFlowContext } from "../types";
import { isRecord, type SubscriptionFetcher } from "./shared";

export async function exchangeGoogleLoginCode(
  ctx: AuthFlowContext,
  fetcher: SubscriptionFetcher,
  url: string,
  body: URLSearchParams
): Promise<Record<string, unknown>> {
  ctx.onProgress({
    status: "pending",
    code: "subscriptions.oauth_callback_received"
  });
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]);
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal
    });
    const data: unknown = await response.json().catch(() => undefined);
    signal.throwIfAborted();
    if (!response.ok) {
      if (isRecord(data) && data.error === "invalid_grant") {
        throw new SubscriptionError(
          "subscriptions.oauth_code_rejected",
          "Google 拒绝了这次授权码，请重新获取登录链接并完成一次授权。"
        );
      }
      if (isRecord(data) && data.error === "invalid_client") {
        throw new SubscriptionError(
          "subscriptions.oauth_client_rejected",
          "Google 拒绝了 Writer 的 OAuth 客户端配置，请检查客户端设置，或使用「导入本机」。"
        );
      }
      throw new SubscriptionError(
        "subscriptions.oauth_exchange_failed",
        `Google 换取登录凭证失败（HTTP ${response.status}），请重新获取登录链接。`
      );
    }
    if (
      !isRecord(data) ||
      typeof data.access_token !== "string" ||
      !data.access_token.trim()
    ) {
      throw new SubscriptionError(
        "subscriptions.oauth_exchange_failed",
        "Google 未返回有效的登录凭证，请重新获取登录链接。"
      );
    }
    return data;
  } catch (error) {
    if (ctx.signal.aborted || error instanceof SubscriptionError) throw error;
    throw new SubscriptionError(
      "subscriptions.oauth_exchange_unreachable",
      "Writer 未能从 Google 取得登录凭证。请检查 Writer 的网络或代理设置，再重新获取登录链接。"
    );
  }
}
