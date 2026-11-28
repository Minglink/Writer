// 探针与模拟服务共用：构建内的 Google OAuth 客户端应与这些值一致。
// Antigravity 由源码写死；Gemini 由构建时的 MAIN_VITE_WRITER_GOOGLE_GEMINI_* 提供。
export const BUNDLED_GOOGLE_OAUTH_CLIENTS = {
  "google-antigravity": {
    clientId:
      "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    clientSecret: "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"
  },
  "google-gemini-cli": {
    clientId: "gemini-bundled-fixture",
    clientSecret: "gemini-bundled-fixture-secret"
  }
};
