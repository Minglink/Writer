import { registerFeatureMessages, locale } from "../../i18n";
import { getErrorPayload } from "../../i18n/errors";

export const subT = registerFeatureMessages("subscriptionModels", {
  "zh-CN": {
    intro: "使用订阅账号的模型在 Writer 中创作。账号凭证加密保存在本机。",
    scanLocalButton: "扫描本机凭证",
    scanningLocal: "扫描中…",
    refreshQuotaButton: "刷新配额",
    refreshingQuota: "刷新中…",
    refreshModelsButton: "拉取最新模型",
    refreshingModels: "拉取中…",
    loadingState: "正在读取订阅账号配置…",
    reloadButton: "重新加载",
    runtimeUnavailable: "桌面运行时不可用，无法读取或管理本机订阅账号。",
    upcomingToggle: "即将支持的平台（{count}）",
    comingSoonBadge: "即将支持",
    phaseLabel: "第 {phase} 期",
    accountPoolTitle: "账号池",
    accountPoolHint: "优先使用主账号；触发限流或配额耗尽时自动切换备用账号。",
    geminiCliAccountHint:
      "已有 Code Assist 标准版或企业版的账号可在此登录。个人免费版、Pro 和 Ultra 请选 Google Antigravity。",
    antigravityAccountHint: "使用 Google 账号登录。可用模型取决于你的套餐。",
    windsurfLoginHint: "浏览器登录后，将页面显示的授权码粘贴到下方。",
    browserTokenLabel: "浏览器返回的授权码",
    finishLogin: "完成登录",
    oauthLoginButton: "获取登录链接",
    deviceFlowLoginButton: "设备码登录",
    importLocalButton: "导入本机",
    manualTokenButton: "粘贴凭证",
    startingAuth: "正在发起…",
    oauthWaitingText:
      "在这台电脑的浏览器中打开链接并完成登录。授权后，账号会自动出现在 Writer 中。",
    oauthLinkLabel: "登录链接",
    copyLoginLinkButton: "复制登录链接",
    openLoginLinkButton: "打开登录页",
    emptyAccountsTitle: "尚未接入 {provider} 账号",
    emptyAccountsDesc:
      "可使用原生登录授权，或只读导入本机已登录的 CLI / IDE 凭证。",
    primaryBadge: "主账号",
    statusActive: "可用",
    statusCooldown: "冷却中",
    statusCooldownWithTime: "冷却中 · {time}后恢复",
    statusQuotaExhausted: "配额耗尽",
    statusExpired: "已失效",
    statusDisabled: "已停用",
    quotaDetails: "配额明细",
    quotaRemaining: "剩余 {value}",
    quotaCount: "{count} 项额度",
    quotaLowestRemaining: "最低剩余 {value}",
    quotaUpdated: "更新于 {time}",
    quotaResets: "{time} 重置",
    quotaPast: "重置时间已过，请刷新",
    quotaUnknown: "上游未提供",
    quotaUnlimited: "不限量",
    quotaUsed: "已用 {value}",
    quotaLimit: "总量 {value}",
    quotaCredits: "积分",
    quotaUsedLimit: "已用 {used}/{limit}",
    quotaEmptyHint: "暂无配额明细，可点击刷新获取。",
    setPrimaryAction: "设为主账号",
    refreshAction: "刷新",
    disableAction: "停用",
    enableAction: "启用",
    removeAction: "移除",
    modelsSectionTitle: "可用模型",
    modelsSectionHint: "已启用的模型将出现在 Writer 全局模型选择器中。",
    modelsRequireAccountHint:
      "启用账号后可拉取该账号的模型目录，并用于创作与测试。",
    emptyModelsDesc: "当前平台暂无可展示的模型目录。",
    currentDefaultBadge: "当前默认",
    recommendedBadge: "推荐",
    setAsDefaultAction: "设为默认",
    settingDefault: "设置中…",
    testAction: "测试",
    testingAction: "测试中…",
    contextWindowMeta: "{size} 上下文",
    reasoningMeta: "支持深度思考",
    toggleModelAria: "启用或停用模型 {label}",
    sourceOAuth: "OAuth",
    sourceDeviceFlow: "Device Flow",
    sourceLocalImport: "本机导入",
    sourceManualToken: "手动导入",
    manualDialogEyebrow: "手动导入凭证",
    manualDialogTitle: "导入 {provider} 凭证",
    manualDialogDesc:
      "粘贴访问令牌、会话凭证或 JSON 配置。凭证仅经系统加密保存在本机，不会同步至云端。",
    manualTokenLabel: "访问令牌 / 会话凭证",
    manualTokenPlaceholder: "粘贴 Access Token、Session Token 或 JSON…",
    manualRefreshLabel: "刷新令牌（可选）",
    manualRefreshPlaceholder: "如有 Refresh Token 可一并填写",
    manualEmailLabel: "账号备注或邮箱（可选）",
    manualEmailPlaceholder: "用于账号池区分多个账号",
    manualImportConfirm: "保存并导入",
    manualImportingButton: "导入中…",
    toastManualImported: "已导入订阅账号凭证。",
    deviceDialogEyebrow: "设备码授权",
    deviceDialogTitle: "登录 {provider}",
    deviceDialogDesc:
      "复制下方配对码并在浏览器中粘贴确认，授权完成后弹窗将自动关闭。",
    deviceCodeLabel: "一次性配对码",
    deviceCopyOpenButton: "复制并打开浏览器",
    deviceCopyOnlyButton: "复制配对码",
    devicePollingHint: "正在等待浏览器确认授权…",
    deviceExpiresHint: "有效期剩余约 {time}",
    deviceCompletedHint: "授权已完成，正在同步账号…",
    deviceFailedHint: "授权未能完成，请重试。",
    scanDialogEyebrow: "本机只读扫描",
    scanDialogTitle: "导入本机订阅凭证",
    scanDialogDesc:
      "仅以只读方式扫描本机已登录的 CLI / IDE 凭证，不会修改任何外部配置文件。",
    scanLoading: "正在扫描本机可导入的订阅凭证…",
    scanEmptyTitle: "未发现可导入的本机凭证",
    scanEmptyDesc:
      "请确认已在终端或对应 IDE 中登录，或直接返回使用「获取登录链接 / 设备码登录」。",
    scanAlreadyImported: "已导入",
    scanSelectAll: "全选未导入",
    scanImportConfirm: "导入所选（{count}）",
    scanImporting: "导入中…",
    scanRescanButton: "重新扫描",
    removeDialogEyebrow: "移除订阅账号",
    removeDialogTitle: "移除账号「{name}」？",
    removeDialogDesc:
      "将从本机加密存储中删除该账号凭证，不会影响你在外部 CLI 或 IDE 中的原有登录状态。若这是该平台最后一个账号，对应订阅模型会从模型选择器中移除。",
    removeConfirmButton: "移除账号",
    removingButton: "移除中…",
    cancelButton: "取消",
    closeButton: "关闭",
    toastCodeCopied: "配对码已复制。",
    toastCodeCopiedOpened: "已复制配对码并打开浏览器授权页。",
    toastCopyFailed: "无法写入剪贴板，请手动复制配对码。",
    toastLoginLinkCopied: "已复制登录链接，可粘贴到任意浏览器打开。",
    toastLoginLinkCopyFailed: "无法写入剪贴板，请手动选中上方链接复制。",
    oauthSavingHint: "Writer 已收到浏览器授权，正在换取凭证并保存账号…",
    toastAuthUpdated: "已更新这个账号的登录凭证。",
    toastAuthCompleted: "订阅账号已添加。",
    toastAuthCancelled: "已取消登录授权。",
    toastImportedCount: "已导入 {count} 个订阅账号。",
    toastQuotaRefreshed: "配额信息已刷新。",
    toastQuotaPartial: "{count} 个账号未能刷新配额，请查看账号提示。",
    toastModelsRefreshed: "已拉取最新模型列表。",
    toastPrimaryUpdated: "已切换为主账号。",
    toastAccountEnabled: "已启用该订阅账号。",
    toastAccountDisabled: "已停用该订阅账号。",
    toastAccountRemoved: "已移除订阅账号。",
    toastDefaultModelUpdated: "已设为默认模型。",
    toastAutoDefaultModel: "已自动将订阅主力模型设为默认模型。",
    toastTestSuccess: "连接成功，订阅模型响应正常。",
    errLoadFailed: "无法读取订阅账号状态，请重试。",
    errActionFailed: "操作未能完成，请稍后重试。",
    errSafeStorageUnavailable:
      "当前系统安全加密存储不可用，已拒绝明文保存订阅凭证。",
    errOAuthClientMissing:
      "此版本暂未启用该平台的浏览器登录。已有登录账号可通过「导入本机」接入。",
    errPoolExhausted: "当前平台所有启用账号均不可用，请刷新配额或稍后重试。",
    errModelsUnavailable: "未能获取最新模型，仍显示原有目录。",
    errAuthFailed: "登录授权失败或已超时，请重新发起。",
    errTestFailed: "订阅模型连接测试失败：{reason}",
    countdownSoon: "不到 1 分钟",
    countdownMinutes: "{m} 分钟",
    countdownHours: "{h} 小时",
    countdownHoursMinutes: "{h} 小时 {m} 分钟",
    countdownDays: "{d} 天"
  },
  "en-US": {
    intro:
      "Use models from your subscriptions in Writer. Account credentials are encrypted on this device.",
    scanLocalButton: "Scan local credentials",
    scanningLocal: "Scanning…",
    refreshQuotaButton: "Refresh quota",
    refreshingQuota: "Refreshing…",
    refreshModelsButton: "Refresh models",
    refreshingModels: "Refreshing…",
    loadingState: "Loading subscription accounts…",
    reloadButton: "Reload",
    runtimeUnavailable:
      "Desktop runtime is unavailable; local subscription accounts cannot be managed.",
    upcomingToggle: "Upcoming providers ({count})",
    comingSoonBadge: "Coming soon",
    phaseLabel: "Phase {phase}",
    accountPoolTitle: "Account pool",
    accountPoolHint:
      "Primary account is used first; rate limits or exhausted quotas automatically fail over to backups.",
    geminiCliAccountHint:
      "For existing Code Assist Standard or Enterprise accounts. For personal Free, Pro or Ultra plans, select Google Antigravity.",
    antigravityAccountHint:
      "Sign in with your Google account. Available models depend on your plan.",
    windsurfLoginHint:
      "Sign in in your browser, then paste the authorization token shown there.",
    browserTokenLabel: "Authorization token from browser",
    finishLogin: "Complete sign-in",
    oauthLoginButton: "Get sign-in link",
    deviceFlowLoginButton: "Device sign in",
    importLocalButton: "Import local",
    manualTokenButton: "Paste token",
    startingAuth: "Starting…",
    oauthWaitingText:
      "Open this link in a browser on this computer. Your account will appear in Writer after you authorize it.",
    oauthLinkLabel: "Login link",
    copyLoginLinkButton: "Copy login link",
    openLoginLinkButton: "Open login page",
    emptyAccountsTitle: "No {provider} accounts connected",
    emptyAccountsDesc:
      "Sign in natively or import existing CLI / IDE credentials in read-only mode.",
    primaryBadge: "Primary",
    statusActive: "Active",
    statusCooldown: "Cooldown",
    statusCooldownWithTime: "Cooldown · {time}",
    statusQuotaExhausted: "Quota exhausted",
    statusExpired: "Expired",
    statusDisabled: "Disabled",
    quotaDetails: "Quota details",
    quotaRemaining: "{value} remaining",
    quotaCount: "{count} quotas",
    quotaLowestRemaining: "Lowest remaining {value}",
    quotaUpdated: "Updated {time}",
    quotaResets: "Resets {time}",
    quotaPast: "Reset time passed. Refresh for an update.",
    quotaUnknown: "Not reported",
    quotaUnlimited: "Unlimited",
    quotaUsed: "{value} used",
    quotaLimit: "Limit {value}",
    quotaCredits: "credits",
    quotaUsedLimit: "{used}/{limit} used",
    quotaEmptyHint: "No quota details yet. Click Refresh to fetch.",
    setPrimaryAction: "Set primary",
    refreshAction: "Refresh",
    disableAction: "Disable",
    enableAction: "Enable",
    removeAction: "Remove",
    modelsSectionTitle: "Available models",
    modelsSectionHint:
      "Enabled models appear automatically in Writer's global model selector.",
    modelsRequireAccountHint:
      "Enable an account to fetch its models and use them in Writer.",
    emptyModelsDesc: "No models available for this provider yet.",
    currentDefaultBadge: "Default",
    recommendedBadge: "Recommended",
    setAsDefaultAction: "Set default",
    settingDefault: "Saving…",
    testAction: "Test",
    testingAction: "Testing…",
    contextWindowMeta: "{size} context",
    reasoningMeta: "Reasoning",
    toggleModelAria: "Toggle model {label}",
    sourceOAuth: "OAuth",
    sourceDeviceFlow: "Device Flow",
    sourceLocalImport: "Local import",
    sourceManualToken: "Manual import",
    manualDialogEyebrow: "Manual credential import",
    manualDialogTitle: "Import {provider} token",
    manualDialogDesc:
      "Paste an access token, session token, or JSON credential. Tokens are encrypted locally and never sync to the cloud.",
    manualTokenLabel: "Access / session token",
    manualTokenPlaceholder: "Paste Access Token, Session Token, or JSON…",
    manualRefreshLabel: "Refresh token (optional)",
    manualRefreshPlaceholder: "Optional refresh token",
    manualEmailLabel: "Account label or email (optional)",
    manualEmailPlaceholder: "Helps distinguish multiple accounts",
    manualImportConfirm: "Import token",
    manualImportingButton: "Importing…",
    toastManualImported: "Subscription account imported.",
    deviceDialogEyebrow: "Device authorization",
    deviceDialogTitle: "Sign in to {provider}",
    deviceDialogDesc:
      "Copy the code below and confirm it in your browser. This dialog closes automatically once authorized.",
    deviceCodeLabel: "One-time code",
    deviceCopyOpenButton: "Copy & open browser",
    deviceCopyOnlyButton: "Copy code",
    devicePollingHint: "Waiting for browser authorization…",
    deviceExpiresHint: "Expires in ~{time}",
    deviceCompletedHint: "Authorized. Syncing account…",
    deviceFailedHint: "Authorization did not complete. Please retry.",
    scanDialogEyebrow: "Read-only local scan",
    scanDialogTitle: "Import local subscription credentials",
    scanDialogDesc:
      "Scans existing CLI / IDE credentials in read-only mode without modifying any external files.",
    scanLoading: "Scanning local subscription credentials…",
    scanEmptyTitle: "No local credentials found",
    scanEmptyDesc:
      "Ensure you are signed in to the corresponding CLI / IDE, or use native sign-in instead.",
    scanAlreadyImported: "Imported",
    scanSelectAll: "Select new",
    scanImportConfirm: "Import selected ({count})",
    scanImporting: "Importing…",
    scanRescanButton: "Rescan",
    removeDialogEyebrow: "Remove subscription account",
    removeDialogTitle: "Remove account “{name}”?",
    removeDialogDesc:
      "Removes the locally encrypted credential without affecting your external CLI or IDE session. Removing the last account hides this provider's models from the selector.",
    removeConfirmButton: "Remove account",
    removingButton: "Removing…",
    cancelButton: "Cancel",
    closeButton: "Close",
    toastCodeCopied: "Code copied.",
    toastCodeCopiedOpened: "Code copied and browser authorization page opened.",
    toastCopyFailed: "Unable to copy automatically. Copy the code manually.",
    toastLoginLinkCopied: "Login link copied.",
    toastLoginLinkCopyFailed:
      "Unable to copy automatically. Select and copy the link above.",
    oauthSavingHint:
      "Authorization received. Writer is exchanging credentials and saving your account…",
    toastAuthUpdated: "Sign-in credentials updated for the existing account.",
    toastAuthCompleted: "Subscription account added.",
    toastAuthCancelled: "Sign-in cancelled.",
    toastImportedCount: "Imported {count} subscription account(s).",
    toastQuotaRefreshed: "Quota refreshed.",
    toastQuotaPartial:
      "Could not refresh quota for {count} account(s). See the account status.",
    toastModelsRefreshed: "Model catalog refreshed.",
    toastPrimaryUpdated: "Primary account updated.",
    toastAccountEnabled: "Account enabled.",
    toastAccountDisabled: "Account disabled.",
    toastAccountRemoved: "Subscription account removed.",
    toastDefaultModelUpdated: "Default model updated.",
    toastAutoDefaultModel:
      "Primary subscription model automatically set as default.",
    toastTestSuccess: "Connection succeeded.",
    errLoadFailed: "Failed to load subscription accounts. Please retry.",
    errActionFailed: "Operation failed. Please retry.",
    errSafeStorageUnavailable:
      "OS encrypted storage is unavailable; plaintext storage was refused.",
    errOAuthClientMissing:
      "Browser sign-in for this provider is unavailable in this build. Use Import local to connect an existing account.",
    errPoolExhausted:
      "All enabled accounts for this provider are currently unavailable.",
    errModelsUnavailable:
      "Could not fetch models. The previous catalog is still available.",
    errAuthFailed: "Authorization failed or timed out. Please try again.",
    errTestFailed: "Connection test failed: {reason}",
    countdownSoon: "< 1 min",
    countdownMinutes: "{m} min",
    countdownHours: "{h} hr",
    countdownHoursMinutes: "{h}h {m}m",
    countdownDays: "{d} d"
  }
});

const SUBSCRIPTION_ERROR_KEYS: Readonly<
  Record<string, Parameters<typeof subT>[0]>
> = {
  "subscriptions.safe_storage_unavailable": "errSafeStorageUnavailable",
  "subscriptions.oauth_client_not_configured": "errOAuthClientMissing",
  "subscriptions.pool_exhausted": "errPoolExhausted",
  "subscriptions.models_unavailable": "errModelsUnavailable",
  "subscriptions.auth_denied": "errAuthFailed",
  "subscriptions.auth_timeout": "errAuthFailed"
};

export function formatSubscriptionError(
  error: unknown,
  fallback = subT("errActionFailed")
): string {
  const payload = getErrorPayload(error);
  if (payload) {
    const key = SUBSCRIPTION_ERROR_KEYS[payload.code];
    if (key) return subT(key);
    if (payload.message?.trim()) return payload.message.trim();
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

export function formatCountdown(
  isoTimestamp: string | undefined,
  nowMs: number
): string | undefined {
  if (!isoTimestamp) return undefined;
  const targetMs = Date.parse(isoTimestamp);
  if (!Number.isFinite(targetMs)) return undefined;
  const diffSec = Math.ceil((targetMs - nowMs) / 1_000);
  if (diffSec <= 0) return undefined;
  if (diffSec < 60) return subT("countdownSoon");
  const totalMin = Math.ceil(diffSec / 60);
  if (totalMin < 60) return subT("countdownMinutes", { m: totalMin });
  const totalHours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (totalHours < 24) {
    return remMin > 0
      ? subT("countdownHoursMinutes", { h: totalHours, m: remMin })
      : subT("countdownHours", { h: totalHours });
  }
  const days = Math.ceil(totalHours / 24);
  return subT("countdownDays", { d: days });
}

export function formatContextWindow(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return "";
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return tokens.toLocaleString(locale.value);
}
