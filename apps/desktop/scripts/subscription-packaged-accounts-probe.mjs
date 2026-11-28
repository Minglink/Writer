import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export async function verifyPackagedAccounts(profile, desktop, output) {
  const exe = resolve(desktop, "release/win-unpacked/Writer.exe");
  const child = spawn(
    exe,
    [
      "--user-data-dir=" + profile,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      "--start-minimized"
    ],
    { windowsHide: true, stdio: "ignore" }
  );
  let ws;
  async function until(fn) {
    for (let i = 0; i < 100; i++) {
      const result = await fn();
      if (result) return result;
      await delay(100);
    }
    throw Error("Check timed out");
  }
  try {
    const port = await until(async () => {
      try {
        return (await readFile(join(profile, "DevToolsActivePort"), "utf8"))
          .trim()
          .split(/\s+/)[0];
      } catch {
        return null;
      }
    });
    const page = await until(async () =>
      (
        await (await fetch("http://127.0.0.1:" + port + "/json/list")).json()
      ).find((p) => p.type === "page" && p.url !== "about:blank")
    );
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    let seq = 0;
    async function send(method, params = {}) {
      const id = ++seq;
      const waiting = new Promise((r, j) => {
        function got(e) {
          const m = JSON.parse(e.data);
          if (m.id !== id) return;
          ws.removeEventListener("message", got);
          if (m.error) j(Error(m.error.message));
          else r(m.result);
        }
        ws.addEventListener("message", got);
      });
      ws.send(JSON.stringify({ id, method, params }));
      return waiting;
    }
    async function js(expression) {
      const res = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true
      });
      if (res.exceptionDetails) throw Error("UI check evaluation failed");
      return res.result.value;
    }
    async function click(sel, label = "") {
      const lookup =
        "[...document.querySelectorAll(" +
        JSON.stringify(sel) +
        ")].find(el=>el.textContent.includes(" +
        JSON.stringify(label) +
        "))";
      await until(() => js("!!" + lookup));
      await js(lookup + ".click()");
    }
    await click(".account-identity-button");
    await click("#account-menu button", "设置");
    await click(".settings-category", "订阅模型");
    const rows = await js("window.writer.subscriptions.getState()");
    assert.equal(rows.providers.length, 9);
    for (const provider of rows.providers) {
      assert.equal(provider.accounts.length, 2, provider.provider);
      assert.equal(
        provider.accounts.find((a) => a.isPrimary)?.email,
        "backup@example.test"
      );
      assert(
        provider.models.some((m) => m.modelId === "claude-fixture-online"),
        provider.provider
      );
      await click(".sub-model-provider-tab", provider.name);
      await until(() =>
        js(
          "document.querySelector('.sub-model-provider-tab[aria-selected=true]')?.textContent.includes(" +
            JSON.stringify(provider.name) +
            ") && document.querySelectorAll('.sub-model-account-row').length===2"
        )
      );
      assert(
        await js(
          "document.querySelector('.sub-model-account-row .is-accent')?.closest('.sub-model-account-row').innerText.includes('backup@example.test')"
        )
      );
      const actionText = await js(
        "document.querySelector('.sub-model-section-actions').innerText"
      );
      assert.match(actionText, /获取登录链接|设备码登录/);
      if (provider.provider === "kiro") assert.match(actionText, /设备码登录/);
      if (provider.provider === "cursor") {
        const img = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(
          join(output, "packaged-cursor-accounts.png"),
          Buffer.from(img.data, "base64")
        );
      }
    }
    console.log(
      "Packaged Writer displayed the saved pair of accounts, primary selection, cached online model and sign-in entry for all nine providers."
    );
    if (child.exitCode === null) {
      const stopped = new Promise((r) => child.once("exit", r));
      ws.send(JSON.stringify({ id: ++seq, method: "Browser.close" }));
      await Promise.race([stopped, delay(2500)]);
    }
  } finally {
    ws?.close();
    if (child.exitCode === null) {
      await delay(1200);
      if (child.exitCode === null) child.kill();
    }
  }
}
