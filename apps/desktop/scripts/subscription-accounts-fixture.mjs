import assert from "node:assert/strict";

export const fixture = {
  provider: "",
  outcome: "pending",
  email: "",
  elapsed: 0
};
export const deviceLink = "https://accounts.example.test/device";
export const modelId = "claude-fixture-online";

export function testToken(email) {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: 2140000000 })
  ).toString("base64url");
  return "fixture." + payload + ".invalid";
}

export async function fixtureFetch(input, init) {
  const path = new URL(input).pathname;
  const { outcome, email, provider } = fixture;
  const good = outcome === "success";
  const refused = outcome === "denied";
  const deviceError = refused
    ? "access_denied"
    : outcome === "expired"
      ? "expired_token"
      : "authorization_pending";
  const reply = (body, status = 200) =>
    Promise.resolve(Response.json(body, { status }));
  const accessToken = testToken(email);
  const token = {
    accessToken,
    refreshToken: "fixture-refresh-" + email,
    email,
    expiresIn: 7200
  };
  const oauth = {
    access_token: accessToken,
    refresh_token: token.refreshToken,
    id_token: accessToken,
    expires_in: 7200,
    account: { email_address: email }
  };
  if (path === "/login/device/code")
    return reply({
      device_code: "fixture-device",
      user_code: "TEST-1234",
      verification_uri: deviceLink,
      interval: 0.12,
      expires_in: 600
    });
  if (path === "/login/oauth/access_token")
    return reply(good ? oauth : { error: deviceError });
  if (path.endsWith("/copilot_internal/v2/token"))
    return reply({
      token: "fixture-copilot-key",
      expires_at: 2140000000,
      endpoints: { api: "https://api.example.test" }
    });
  if (path === "/client/register")
    return reply({ clientId: "fixture", clientSecret: "fixture-secret" });
  if (path === "/device_authorization")
    return reply({
      deviceCode: "fixture-device",
      userCode: "TEST-1234",
      verificationUri: deviceLink,
      interval: 0.12,
      expiresIn: 600
    });
  if (path === "/token" && provider === "kiro")
    return reply(good ? token : { error: deviceError }, good ? 200 : 400);
  if (
    outcome === "revoked" &&
    (path.endsWith("/oauth/usage") || path.endsWith("/oauth/token"))
  )
    return reply({}, 401);
  if (path.endsWith("/oauth/usage"))
    return reply({
      five_hour: { utilization: outcome === "exhausted" ? 100 : 12 }
    });
  if (path.endsWith("/token") && provider === "kiro") return reply(token);
  if (path === "/v2/plugin/auth/state")
    return reply({
      data: {
        state: "fixture-state",
        authUrl: "https://accounts.example.test/login?state=fixture-state"
      }
    });
  if (path === "/auth/poll" || path === "/v2/plugin/auth/token") {
    if (outcome === "expired") fixture.elapsed = 310000;
    return reply(
      good ? (provider === "cursor" ? token : { data: oauth }) : {},
      good ? 200 : refused ? 403 : 202
    );
  }
  if (path.endsWith("/token")) {
    if (
      process.env.WRITER_PROBE_BUNDLED_GOOGLE_OAUTH === "1" &&
      provider.startsWith("google-")
    ) {
      const form = new URLSearchParams(init?.body);
      if (form.get("grant_type") === "authorization_code") {
        const client =
          provider === "google-antigravity" ? "antigravity" : "gemini";
        assert.equal(form.get("client_id"), `${client}-bundled-fixture`);
        assert.equal(
          form.get("client_secret"),
          `${client}-bundled-fixture-secret`
        );
        assert(form.get("code_verifier"));
      }
    }
    if (outcome === "rejected-code")
      return reply({ error: "invalid_grant" }, 400);
    await fixture.exchangeGate?.promise;
    return reply(oauth);
  }
  if (path.endsWith(":fetchAvailableModels"))
    await fixture.catalogGate?.promise;
  if (path.endsWith("/userinfo") || path === "/user")
    return reply({ email, name: email, login: "fixture" });
  if (path.endsWith("/oauth/profile"))
    return reply({ account: { email, display_name: email } });
  if (path.endsWith("/plugin/login/account"))
    return reply({ data: { email, nickname: email } });
  if (path === "/register_user/") {
    assert.equal(JSON.parse(init.body).firebase_id_token, accessToken);
    return reply(
      good ? { api_key: "fixture-exchanged-" + email } : {},
      good ? 200 : 401
    );
  }
  if (path.endsWith(":loadCodeAssist"))
    return reply({ cloudaicompanionProject: "fixture-project" });
  if (path.endsWith(":fetchAvailableModels"))
    return reply({
      models: {
        [modelId]: {
          displayName: "Fixture online",
          quotaInfo: { remainingFraction: 0.8 }
        }
      }
    });
  if (path.endsWith("/codex/models"))
    return reply({
      models: [
        { slug: modelId, display_name: "Fixture online", visibility: "list" }
      ]
    });
  if (path.endsWith("/ListAvailableModels"))
    return reply({ models: [{ modelId, modelName: "Fixture online" }] });
  if (path.endsWith("/AvailableModels"))
    return reply({
      models: [{ name: modelId, clientDisplayName: "Fixture online" }]
    });
  if (path.endsWith("/GetUserStatus"))
    return reply({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { label: "Fixture online", modelOrAlias: { model: modelId } }
          ]
        }
      }
    });
  if (path.endsWith("/models"))
    return reply({
      data: [
        {
          id: modelId,
          name: "Fixture online",
          display_name: "Fixture online",
          model_picker_enabled: true,
          capabilities: { type: "chat" }
        }
      ]
    });
  return reply({}, 404);
}
