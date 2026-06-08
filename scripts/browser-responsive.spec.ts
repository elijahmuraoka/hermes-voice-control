import { test, expect, type Page } from "@playwright/test";

const APP_URL = process.env.HVC_E2E_APP_URL ?? "http://127.0.0.1:5173";
const AGENT_NAME = process.env.HVC_E2E_AGENT_NAME ?? "Hermes Agent";
const AGENT_NAME_PATTERN = AGENT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SCREENSHOT_DIR = "docs/assets/screenshots";
const WRITE_SCREENSHOTS = process.env.HVC_E2E_WRITE_SCREENSHOTS === "true";
const RUN_TOKEN_FLOW = process.env.HVC_E2E_RUN_TOKEN_FLOW === "true";
const screenshotTargets: Record<string, string> = {
  "mobile-390": "mobile-idle.png",
  "desktop-1280": "desktop.png",
};
const viewports = [
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-360-short", width: 360, height: 640 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
];

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function routeGeminiToken(page: Page, delayMs = 0) {
  await page.route(
    "http://127.0.0.1:8765/gemini/ephemeral-token",
    async (route) => {
      if (delayMs > 0) await delay(delayMs);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          token: "smoke-token",
          expires_at: "2026-01-01T00:00:00Z",
          mode: "smoke",
          model: "gemini-2.5-flash-native-audio-latest",
        }),
      });
    },
  );
}

async function installMockGeminiLive(
  page: Page,
  options: { autoSetupComplete?: boolean; denyFirstMic?: boolean } = {},
) {
  await page.addInitScript((initOptions) => {
    const smokeState = {
      denyNextMic: Boolean(initOptions.denyFirstMic),
      sockets: [] as any[],
    };
    (window as any).__hvcSmoke = smokeState;

    class FakeAudioWorkletNode {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        postMessage: () => undefined,
      };

      connect() {}

      disconnect() {}
    }

    class FakeAudioContext {
      sampleRate = 48000;
      destination = {};
      audioWorklet = {
        addModule: async () => undefined,
      };

      createMediaStreamSource() {
        return { connect: () => undefined };
      }

      async close() {}
    }

    (window as any).AudioContext = FakeAudioContext;
    (window as any).webkitAudioContext = FakeAudioContext;
    (window as any).AudioWorkletNode = FakeAudioWorkletNode;

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      url: string;
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      sent: string[] = [];

      constructor(url: string) {
        this.url = url;
        smokeState.sockets.push(this);
        window.setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.(new Event("open"));
          if (initOptions.autoSetupComplete) {
            window.setTimeout(() => this.receive({ setupComplete: {} }), 10);
          }
        }, 10);
      }

      send(data: string) {
        this.sent.push(data);
      }

      close(code = 1000, reason = "") {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close", { code, reason }));
      }

      receive(payload: unknown) {
        this.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(payload) }),
        );
      }
    }

    (window as any).WebSocket = FakeWebSocket;

    const originalGetUserMedia =
      navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (originalGetUserMedia) {
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (smokeState.denyNextMic) {
          smokeState.denyNextMic = false;
          throw new DOMException(
            "Microphone permission denied by smoke test",
            "NotAllowedError",
          );
        }
        return originalGetUserMedia(constraints);
      };
    }
  }, options);
}

test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

for (const viewport of viewports) {
  test(`renders without overflow at ${viewport.name}`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: AGENT_NAME })).toBeVisible();
    const orbButton = page.getByRole("button", { name: /Voice orb:/ });
    const muteButton = page.getByRole("button", { name: /^Mute$/ });
    const endButton = page.getByRole("button", { name: /^End$/ });
    const textInput = page.getByLabel("Type a message to your Hermes agent");
    await expect(orbButton).toBeVisible();
    await expect(muteButton).toBeVisible();
    await expect(endButton).toBeVisible();
    await expect(textInput).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(orbButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(muteButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(endButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(textInput).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /Toggle transcript/ }),
    ).toBeFocused();
    await expect(page.getByText("Interrupt")).toHaveCount(0);
    await expect(page.getByText(/PIN/i)).toHaveCount(0);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
    const orbBox = await page
      .getByRole("button", { name: /Voice orb:/ })
      .boundingBox();
    expect(orbBox?.width ?? 0).toBeGreaterThanOrEqual(140);
    expect(orbBox?.height ?? 0).toBeGreaterThanOrEqual(140);
    if (viewport.width <= 390) {
      const controlRow = page.locator(".control-row");
      const chat = page.locator(".floating-chat");
      const transcriptTab = page.getByRole("button", {
        name: /Toggle transcript/,
      });
      const controlBox = await controlRow.boundingBox();
      const chatBox = await chat.boundingBox();
      const transcriptBox = await transcriptTab.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(chatBox).not.toBeNull();
      expect(transcriptBox).not.toBeNull();
      expect(
        (controlBox?.y ?? 0) + (controlBox?.height ?? 0),
      ).toBeLessThanOrEqual((chatBox?.y ?? 0) - 4);
      expect(
        (chatBox?.y ?? 0) + (chatBox?.height ?? 0),
      ).toBeLessThanOrEqual((transcriptBox?.y ?? 0) - 4);
    }
    const screenshotTarget = screenshotTargets[viewport.name];
    if (WRITE_SCREENSHOTS && screenshotTarget) {
      await page.screenshot({
        path: `${SCREENSHOT_DIR}/${screenshotTarget}`,
        fullPage: true,
      });
    }
    expect(consoleErrors).toEqual([]);
  });
}

test("honors reduced motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: AGENT_NAME })).toBeVisible();
  const duration = await page
    .locator(".orb-aura")
    .evaluate((element) => getComputedStyle(element).animationDuration);
  const durationMs = duration.endsWith("ms")
    ? Number.parseFloat(duration)
    : Number.parseFloat(duration) * 1000;
  expect(durationMs).toBeLessThanOrEqual(0.001);
});

test("recovers from microphone permission denial and connects on retry", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await routeGeminiToken(page);
  await installMockGeminiLive(page, {
    autoSetupComplete: true,
    denyFirstMic: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const orbButton = page.getByRole("button", { name: /Voice orb:/ });
  await orbButton.click();
  await expect(page.getByText("Voice session failed.")).toBeVisible();
  await expect(
    page.getByText("Microphone permission denied by smoke test"),
  ).toHaveCount(1);

  await orbButton.click();
  await expect(page.getByText("Listening hands-free")).toBeVisible();
  await expect(page.getByText("smoke voice")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("starts from a muted mobile state and can unmute after connecting", async ({
  page,
}) => {
  await routeGeminiToken(page);
  await installMockGeminiLive(page, { autoSetupComplete: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: /^Mute$/ }).click();
  await expect(page.getByText("Mic paused")).toBeVisible();
  await page.getByRole("button", { name: /Voice orb:/ }).click();
  await expect(page.getByText("smoke voice")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Unmute$/ })).toBeVisible();

  await page.getByRole("button", { name: /^Unmute$/ }).click();
  await expect(page.getByText("Listening hands-free")).toBeVisible();
});

test("keeps controls usable during a slow mobile token request", async ({
  page,
}) => {
  await routeGeminiToken(page, 800);
  await installMockGeminiLive(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const orbButton = page.getByRole("button", { name: /Voice orb:/ });
  await orbButton.click();
  await expect(page.getByText("Connecting voice...")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Mute$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^End$/ })).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
  await expect(page.getByText("Listening hands-free")).toBeVisible();
});

test("keeps barge-in reachable while the agent is speaking on mobile", async ({
  page,
}) => {
  await routeGeminiToken(page);
  await installMockGeminiLive(page, { autoSetupComplete: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const orbButton = page.getByRole("button", { name: /Voice orb:/ });
  await orbButton.click();
  await expect(page.getByText("Listening hands-free")).toBeVisible();
  await page.evaluate(() => {
    const socket = (window as any).__hvcSmoke.sockets.at(-1);
    socket.receive({
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/pcm;rate=24000",
                data: "AAAA",
              },
            },
          ],
        },
      },
    });
  });
  await expect(page.getByText("Hermes Agent is speaking")).toBeVisible();

  const orbBox = await orbButton.boundingBox();
  expect(orbBox).not.toBeNull();
  await page.mouse.move(
    (orbBox?.x ?? 0) + (orbBox?.width ?? 0) / 2,
    (orbBox?.y ?? 0) + (orbBox?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(260);
  await page.mouse.up();
  await expect(page.getByText("Hermes Agent is thinking...")).toBeVisible();
  await expect(page.getByText("Interrupt")).toHaveCount(0);
});

test.describe("real backend token flow", () => {
  test.skip(
    !RUN_TOKEN_FLOW,
    "Set HVC_E2E_RUN_TOKEN_FLOW=true with a real backend to run this check.",
  );

  test("connects from the browser app", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Voice orb:/ }).click();
    await expect(page.getByText("real voice")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(
        new RegExp(
          `Connecting voice|Listening|${AGENT_NAME_PATTERN} is speaking|Hold-to-talk`,
          "i",
        ),
      ),
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/real-browser-connected.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: /^End$/ }).click();
    const actionableErrors = consoleErrors.filter(
      (line) => !line.includes("AudioContext"),
    );
    expect(actionableErrors).toEqual([]);
  });
});
