import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  fixture,
  fixtureFetch,
  modelId,
  testToken
} from "./subscription-accounts-fixture.mjs";
import { prepareSmokeWorkspace } from "./smoke-workspace.mjs";

const here = fileURLToPath(import.meta.url);
const desktop = resolve(dirname(here), "..");
const output = resolve(
  process.argv[2] ?? join(desktop, ".scratch", "account-screens")
);
const modes = [
  ["google-gemini-cli", "oauth"],
  ["google-antigravity", "oauth"],
  ["openai-codex", "oauth"],
  ["github-copilot", "device_flow"],
  ["anthropic-claude", "oauth"],
  ["kiro", "oauth"],
  ["kiro", "device_flow"],
  ["cursor", "oauth"],
  ["windsurf", "manual"],
  ["codebuddy", "oauth"]
];
const providers = [...new Set(modes.map(([id]) => id))];
const a = "primary@example.test",
  b = "backup@example.test";

if (!process.versions.electron) {
  const { default: electron } = await import("electron");
  const dir = await mkdtemp(join(tmpdir(), "writer-account-probe-"));
  try {
    for (const phase of ["exercise", "reopen", "confirm"]) {
      const child = spawnSync(electron, [here, output, phase, dir], {
        cwd: desktop,
        stdio: "inherit",
        timeout: 360000,
        windowsHide: true
      });
      assert.equal(child.status, 0, child.error?.message ?? phase);
      if (phase === "exercise" && process.argv.includes("--packaged")) {
        const { verifyPackagedAccounts } =
          await import("./subscription-packaged-accounts-probe.mjs");
        await verifyPackagedAccounts(dir, desktop, output);
      }
    }
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250
    });
  }
} else {
  const { app, BrowserWindow, shell, net } = await import("electron");
  const phase = process.argv[3],
    profile = process.argv[4];
  assert(profile && ["exercise", "reopen", "confirm"].includes(phase));
  app.setPath("userData", profile);
  app.setAppPath(desktop);
  app.setPath("documents", profile);
  if (phase === "exercise") await prepareSmokeWorkspace(profile);
  await mkdir(output, { recursive: true });
  let opened;
  shell.openExternal = async (url) => {
    opened = url;
  };
  const loopbackFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch;
  net.fetch = fixtureFetch;
  const now = Date.now;
  Date.now = () => now() + fixture.elapsed;
  const schedule = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) =>
    schedule(
      fn,
      fixture.outcome === "short-deadline" && ms === 300000 ? 1000 : ms,
      ...args
    );
  if (process.env.WRITER_PROBE_BUNDLED_GOOGLE_OAUTH === "1") {
    for (const name of [
      "WRITER_GOOGLE_GEMINI_CLIENT_ID",
      "WRITER_GOOGLE_GEMINI_CLIENT_SECRET",
      "WRITER_GOOGLE_ANTIGRAVITY_CLIENT_ID",
      "WRITER_GOOGLE_ANTIGRAVITY_CLIENT_SECRET",
      "GEMINI_CLI_OAUTH_CLIENT_ID",
      "GEMINI_CLI_OAUTH_CLIENT_SECRET",
      "ANTIGRAVITY_OAUTH_CLIENT_ID",
      "ANTIGRAVITY_OAUTH_CLIENT_SECRET"
    ]) {
      delete process.env[name];
    }
  } else {
    process.env.WRITER_GOOGLE_GEMINI_CLIENT_ID = "gemini-fixture-client";
    process.env.WRITER_GOOGLE_ANTIGRAVITY_CLIENT_ID =
      "antigravity-fixture-client";
  }
  await import("../out/main/index.js");
  void run().then(
    () => app.exit(0),
    (e) => {
      console.error(e);
      app.exit(1);
    }
  );

  async function run() {
    let win;
    for (let i = 0; i < 150 && !win; i++) {
      win = BrowserWindow.getAllWindows()[0];
      await delay(100);
    }
    assert(win, "Writer window");
    win.webContents.setBackgroundThrottling(false);
    win.setContentSize(1200, 800);
    win.hide();
    const js = (expr) => win.webContents.executeJavaScript(expr, true);
    const q = JSON.stringify;
    const wait = async (expr, description) => {
      for (let i = 0; i < 150; i++) {
        if (await js(expr)) return;
        await delay(75);
      }
      throw Error(
        "Timed out: " +
          (description ?? expr) +
          "; provider " +
          fixture.provider +
          "; visible end: " +
          String(await js("document.body.innerText.slice(-670)"))
      );
    };
    const click = async (selector, label, parent = "document") => {
      const element =
        "Array.from((" +
        parent +
        ").querySelectorAll(" +
        q(selector) +
        ")).find(el=>el.textContent.trim().includes(" +
        q(label) +
        ") && !el.disabled)";
      await wait(element, label);
      await js(element + ".click()");
    };
    const row = (email) =>
      "[...document.querySelectorAll('.sub-model-account-row')].find(el=>el.querySelector('.sub-model-account-name')?.textContent.trim()===" +
      q(email) +
      ")";
    const rows = "document.querySelectorAll('.sub-model-account-row').length";
    const dlg =
      "document.querySelector(':is([role=dialog],[role=alertdialog])')";
    const link =
      "document.querySelector(':is([role=dialog],[role=alertdialog]) input[readonly]')";
    const getState = () => js("window.writer.subscriptions.getState()");
    let state = await (async () => {
      await wait("!!document.querySelector('.account-identity-button')");
      return getState();
    })();
    assert.equal(state.providers.filter((p) => p.implemented).length, 9);
    const providerNames = new Map(
      state.providers.map((p) => [p.provider, p.name])
    );
    const accountState = async (id) =>
      (await getState()).providers.find((p) => p.provider === id);
    const shot = async (name) => {
      const uri = await js(link + "?.value");
      if (uri)
        await js(link + ".value='https://accounts.example.test/authorize'");
      await delay(110);
      await writeFile(
        join(output, name + ".png"),
        (await win.capturePage()).toPNG()
      );
      if (uri) await js(link + ".value=" + q(uri));
    };
    await js("document.querySelector('.account-identity-button').click()");
    await click("#account-menu button", "设置");
    await click(".settings-category", "订阅模型");
    await wait("!!document.querySelector('.sub-model-provider-tab')");
    await js(
      "Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testCopied=text}}})"
    );
    const select = async (id) => {
      fixture.provider = id;
      await click(".sub-model-provider-tab", providerNames.get(id));
    };
    if (phase === "exercise") await shot("01-settings");
    const loopback = async (uri, denied) => {
      const auth = new URL(uri);
      assert(auth.searchParams.get("code_challenge"));
      if (
        process.env.WRITER_PROBE_BUNDLED_GOOGLE_OAUTH === "1" &&
        fixture.provider.startsWith("google-")
      ) {
        const client =
          fixture.provider === "google-antigravity" ? "antigravity" : "gemini";
        assert.equal(
          auth.searchParams.get("client_id"),
          `${client}-bundled-fixture`
        );
        assert(!auth.searchParams.has("client_secret"));
      }
      const url = new URL(auth.searchParams.get("redirect_uri"));
      assert(
        ["localhost", "127.0.0.1"].includes(url.hostname) &&
          url.protocol === "http:" &&
          url.port
      );
      if (url.pathname === "/" && fixture.provider === "kiro")
        url.pathname = "/oauth/callback";
      url.hostname = "127.0.0.1";
      url.searchParams.set("state", auth.searchParams.get("state"));
      if (denied) url.searchParams.set("error", "access_denied");
      else url.searchParams.set("code", "fixture-code");
      if (
        !denied &&
        fixture.provider.startsWith("google-") &&
        fixture.exchangeGate
      ) {
        const browser = new BrowserWindow({
          width: 800,
          height: 600,
          show: false,
          webPreferences: { sandbox: true, backgroundThrottling: false }
        });
        try {
          await browser.loadURL(url.toString());
          await writeFile(
            join(output, fixture.provider + "-browser-return.png"),
            (await browser.capturePage()).toPNG()
          );
          assert(
            await browser.webContents.executeJavaScript(
              "!!document.elementFromPoint(12,12)?.closest('button')"
            )
          );
          const loaded = new Promise((resolve) =>
            browser.webContents.once("did-finish-load", resolve)
          );
          browser.webContents.sendInputEvent({
            type: "mouseDown",
            x: 12,
            y: 12,
            button: "left",
            clickCount: 1
          });
          browser.webContents.sendInputEvent({
            type: "mouseUp",
            x: 12,
            y: 12,
            button: "left",
            clickCount: 1
          });
          await loaded;
          assert(
            await browser.webContents.executeJavaScript(
              "document.title === '已请求返回 Writer'"
            )
          );
          assert(win.isVisible(), "Return action restores the Writer window");
          win.hide();
        } finally {
          browser.destroy();
        }
        return;
      }
      const response = await loopbackFetch(url, {
        redirect: "error",
        headers: { Connection: "close" }
      });
      const html = await response.text();
      if (!denied) assert.match(html, /已收到授权码/);
      assert.equal(
        response.status,
        denied ? 400 : 200,
        "callback status " +
          response.status +
          " " +
          html.match(/<title>(.*?)<\/title>/u)?.[1]
      );
    };
    async function login(id, method, outcome, email, tag) {
      console.log(id, method, outcome);
      fixture.email = email;
      const isDevice = method === "device_flow",
        isManual = method === "manual";
      const callback =
        method === "oauth" && !["cursor", "codebuddy"].includes(id);
      fixture.outcome =
        callback && outcome === "expired" ? "short-deadline" : "pending";
      fixture.elapsed = 0;
      opened = undefined;
      const prior = (await accountState(id)).accounts.length;
      const delayedGoogle =
        id.startsWith("google-") && !prior && outcome === "success";
      if (delayedGoogle) {
        fixture.exchangeGate = Promise.withResolvers();
        fixture.catalogGate = Promise.withResolvers();
      }
      await click(".sub-model-btn", isDevice ? "设备码登录" : "获取登录链接");
      await wait("!!" + link, "sign-in link");
      const uri = await js(link + ".value");
      assert.equal(new URL(uri).protocol, "https:");
      if (isDevice)
        assert.equal(
          await js(
            "document.querySelector('.sub-model-device-code').textContent.trim()"
          ),
          "TEST-1234"
        );
      if (outcome === "cancel") {
        await shot(tag + "-01-link");
        await click(
          ":is([role=dialog],[role=alertdialog]) button",
          "复制登录链接"
        );
        assert.equal(await js("window.testCopied"), uri);
        await click(
          ":is([role=dialog],[role=alertdialog]) button",
          isDevice ? "复制并" : "打开登录页"
        );
        for (let i = 0; i < 40 && opened !== uri; i++) await delay(25);
        assert.equal(opened, uri);
        if (isDevice) assert.equal(await js("window.testCopied"), "TEST-1234");
        await click(":is([role=dialog],[role=alertdialog]) button", "取消");
      } else {
        if (outcome !== "expired" || !callback) fixture.outcome = outcome;
        if (callback && outcome !== "expired")
          await loopback(uri, outcome === "denied");
        if (delayedGoogle) {
          await wait(
            dlg + "?.textContent.includes('正在换取凭证')",
            "credential exchange feedback"
          );
          await js(
            "document.querySelector('.sub-model-dialog-backdrop').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))"
          );
          assert.equal((await accountState(id)).accounts.length, 0);
          await js(
            "document.querySelectorAll('button.toast-message').forEach(toast=>toast.click())"
          );
          await wait(
            "!document.querySelector('.toast-message')",
            "previous notifications dismissed"
          );
          await shot(tag + "-03-saving");
          fixture.exchangeGate.resolve();
          delete fixture.exchangeGate;
        }
        if (isManual) {
          await js(
            "(()=>{const el=document.querySelector(':is([role=dialog],[role=alertdialog]) input[type=password]');el.value=" +
              q(testToken(email)) +
              ";el.dispatchEvent(new Event('input',{bubbles:true}));})()"
          );
          await click(
            ":is([role=dialog],[role=alertdialog]) button",
            "完成登录"
          );
        }
        if (outcome !== "success") {
          if (isManual)
            await wait(
              "document.body.innerText.includes('无效') || document.body.innerText.includes('凭证格式')",
              "invalid browser token feedback"
            );
          else
            await wait(
              "!!document.querySelector(':is([role=dialog],[role=alertdialog]) .is-failed')",
              "failed login feedback"
            );
          if (isDevice && outcome === "expired")
            assert.match(await js(dlg + ".textContent"), /过期/);
          if ((isDevice || callback) && outcome === "denied")
            assert.match(await js(dlg + ".textContent"), /拒绝|取消|失败|授权/);
          if (outcome === "rejected-code") {
            assert.match(
              await js(dlg + ".textContent"),
              /Google 拒绝了这次授权码/
            );
            await shot(tag + "-04-rejected");
          }
          if (id === "github-copilot" || isManual)
            await shot(tag + "-" + outcome);
          await click(":is([role=dialog],[role=alertdialog]) button", "取消");
        }
      }
      await wait("!" + dlg, "closed dialog");
      fixture.elapsed = 0;
      if (outcome === "success") {
        await wait("!!" + row(email), "account " + email);
        if (delayedGoogle) {
          assert.equal(
            (await accountState(id)).models.some((m) => m.modelId === modelId),
            false
          );
          fixture.catalogGate.resolve();
          delete fixture.catalogGate;
        }
        await wait(
          "document.querySelector('.sub-model-row')?.parentElement?.textContent.includes(" +
            q(modelId) +
            ")",
          "refreshed online catalog"
        );
        const p = await accountState(id);
        assert(
          p.models.some((model) => model.modelId === modelId),
          "Live catalog missing for " + id
        );
      } else
        assert.equal(
          (await accountState(id)).accounts.length,
          prior,
          "unexpected account persisted"
        );
    }
    if (phase === "exercise") {
      for (const [id, method] of modes) {
        await select(id);
        const tag = id + "-" + method;
        console.log("Checking", tag);
        for (const outcome of [
          "cancel",
          "denied",
          ...(method === "manual" ? [] : ["expired"]),
          ...(id.startsWith("google-") ? ["rejected-code"] : []),
          "success"
        ])
          await login(id, method, outcome, a, tag);
        if ((await accountState(id)).accounts.length === 1)
          await login(id, method, "success", b, tag);
        if (id.startsWith("google-")) {
          await login(id, method, "success", a, tag);
          await wait(
            "document.body.innerText.includes('已更新这个账号的登录凭证')",
            "existing account notice"
          );
        }
        const p = await accountState(id);
        assert.deepEqual(p.accounts.map((x) => x.email).sort(), [a, b].sort());
        const setPrimary = async (email) => {
          if (
            !(await accountState(id)).accounts.find((x) => x.email === email)
              .isPrimary
          ) {
            await click("button", "设为主账号", row(email));
            await wait(row(email) + ".querySelector('.is-accent')");
          }
        };
        await setPrimary(b);
        await click("button", "停用", row(b));
        await wait(
          row(b) +
            ".classList.contains('is-disabled') && !!" +
            row(a) +
            ".querySelector('.is-accent')"
        );
        await click("button", "启用", row(b));
        await wait("!" + row(b) + ".classList.contains('is-disabled')");
        await setPrimary(b);
        if (id === "anthropic-claude") {
          for (const [outcome, status] of [
            ["exhausted", "quota_exhausted"],
            ["revoked", "expired"]
          ]) {
            fixture.outcome = outcome;
            await click("button", "刷新", row(a));
            await wait(
              row(a) +
                ".querySelector('.sub-model-status-dot.is-" +
                status +
                "')"
            );
            const current = (await accountState(id)).accounts.find(
              (x) => x.email === a
            );
            assert.equal(current.status, status);
          }
          await click("button", "停用", row(a));
          await wait(row(a) + ".classList.contains('is-disabled')");
          await click("button", "启用", row(a));
          await wait(
            row(a) + ".querySelector('.sub-model-status-dot.is-expired')"
          );
          await js(row(a) + ".scrollIntoView({block:'center'})");
          await shot("claude-03-expired");
          await login(id, method, "success", a, tag);
          await wait(
            row(a) + ".querySelector('.sub-model-status-dot.is-active')"
          );
        }
        await click("button", "移除", row(a));
        await click(":is([role=dialog],[role=alertdialog]) button", "取消");
        await wait("!" + dlg);
        assert.equal((await accountState(id)).accounts.length, 2);
        await js(row(b) + ".scrollIntoView({block:'center'})");
        await shot(tag + "-02-accounts");
      }
    } else {
      for (const id of providers) {
        await select(id);
        const p = await accountState(id);
        assert.equal(p.accounts.length, phase === "reopen" ? 2 : 1);
        assert.equal(p.accounts.find((x) => x.isPrimary)?.email, b);
        await wait(rows + "===" + p.accounts.length);
        if (phase === "reopen") {
          await click("button", "移除", row(a));
          if (id === "cursor") await shot("cursor-03-remove");
          await click(
            ":is([role=dialog],[role=alertdialog]) button",
            "移除账号"
          );
          await wait(rows + "===1");
          assert.equal((await accountState(id)).accounts[0].email, b);
        } else
          assert.deepEqual(
            p.accounts.map((x) => x.email),
            [b]
          );
      }
      if (phase === "confirm") await shot("99-reopened");
    }
    console.log("Passed", phase, "for all nine providers.");
  }
}
