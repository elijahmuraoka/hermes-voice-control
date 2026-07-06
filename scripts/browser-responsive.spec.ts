import { test, expect, type Page } from "@playwright/test";

const APP_URL = process.env.HVC_E2E_APP_URL ?? "http://127.0.0.1:5173";
const configuredAgentName = process.env.HVC_E2E_AGENT_NAME;
const AGENT_NAME = configuredAgentName ?? "Hermes Agent";
const AGENT_NOUN = configuredAgentName ?? "your Hermes agent";
const AGENT_NAME_PATTERN = AGENT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WRITE_SCREENSHOTS = process.env.HVC_E2E_WRITE_SCREENSHOTS === "true";
const RUN_TOKEN_FLOW = process.env.HVC_E2E_RUN_TOKEN_FLOW === "true";
const screenshotTargets: Record<string, string> = {
  "mobile-390": "mobile-idle.png",
  "desktop-1280": "desktop.png",
};
const viewports = [
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
];
const DRAWER_BREAKPOINT = 900;

interface BrowserDiagnostics {
  snapshot(): {
    privacy: { localOnly: boolean; redacted: boolean };
    budgets: {
      firstAudioLatencyMs: number;
      toolResponseLatencyMs: number;
      reconnectResumeLatencyMs: number;
      smokeFlakeRate: number;
    };
    events: unknown[];
  };
  copyText(): string;
  redactText(value: string): string;
}

interface BrowserWindowWithDiagnostics {
  __HVC_DIAGNOSTICS__?: BrowserDiagnostics;
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

async function stubUnlockedSession(page: Page) {
  // Mirror production shapes: unauthenticated /readyz is minimal; the chip's
  // checks come from /readyz/details behind session auth.
  await page.route("**/readyz", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/readyz/details", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        checks: {
          hermes_adapter: "api",
          hermes: { kind: "api", available: true },
        },
      }),
    });
  });
  await page.route("**/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true }),
    });
  });
  await page.route("**/stt/transcribe", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transcript: "browser smoke phrase",
        provider: "gemini",
        model: "gemini-smoke",
        fallback: false,
      }),
    });
  });
}

async function waitForDrawerOpen(page: Page) {
  await page.waitForFunction(() => {
    const drawer = document.querySelector(".transcript");
    if (!drawer) return false;
    const transform = getComputedStyle(drawer).transform;
    return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
  });
}

for (const viewport of viewports) {
  test(`renders without overflow at ${viewport.name}`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await stubUnlockedSession(page);
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: AGENT_NAME })).toBeVisible();
    const orbButton = page.getByRole("button", { name: /Voice orb:/ });
    const muteButton = page.getByRole("button", { name: /^Mute$/ });
    const liveButton = page.getByRole("button", { name: /^Live$/ });
    const endButton = page.getByRole("button", { name: /^End$/ });
    const textInput = page.getByLabel(`Type a message to ${AGENT_NOUN}`);
    const transcriptTab = page.getByRole("button", {
      name: /Toggle transcript/,
    });
    await expect(orbButton).toBeVisible();
    await expect(muteButton).toHaveCount(0);
    await expect(liveButton).toBeVisible();
    await expect(endButton).toHaveCount(0);
    await expect(page.getByText(`Hold to talk to ${AGENT_NAME}`)).toBeVisible();
    await expect(
      page.getByLabel(/Agent connection: Agent connected/),
    ).toBeVisible();
    if (viewport.width <= DRAWER_BREAKPOINT) {
      await expect(textInput).toBeHidden();
    } else {
      await expect(textInput).toBeVisible();
    }
    await page.keyboard.press("Tab");
    await expect(orbButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(liveButton).toBeFocused();
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
    const screenshotTarget = screenshotTargets[viewport.name];
    if (WRITE_SCREENSHOTS && screenshotTarget) {
      // Committed README assets live under docs/assets/screenshots; write there
      // so `pnpm screenshots:update` refreshes them, plus a copy in the test
      // output dir for per-run evidence.
      await page.screenshot({
        path: `docs/assets/screenshots/${screenshotTarget}`,
        fullPage: true,
      });
      await page.screenshot({
        path: testInfo.outputPath(screenshotTarget),
        fullPage: true,
      });
    }
    if (viewport.width <= DRAWER_BREAKPOINT) {
      const controlRow = page.locator(".control-row");
      const controlBox = await controlRow.boundingBox();
      const transcriptBox = await transcriptTab.boundingBox();
      expect(controlBox).not.toBeNull();
      expect(transcriptBox).not.toBeNull();
      expect(
        (controlBox?.y ?? 0) + (controlBox?.height ?? 0),
      ).toBeLessThanOrEqual((transcriptBox?.y ?? 0) - 4);

      await transcriptTab.click();
      await expect(textInput).toBeVisible();
      await waitForDrawerOpen(page);
      const composerBox = await page.locator(".transcript-composer").boundingBox();
      expect(composerBox).not.toBeNull();
      expect(composerBox?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect(
        (composerBox?.x ?? 0) + (composerBox?.width ?? 0),
      ).toBeLessThanOrEqual(viewport.width);
      expect(
        (composerBox?.y ?? 0) + (composerBox?.height ?? 0),
      ).toBeLessThanOrEqual(viewport.height - 8);
    }
    expect(consoleErrors).toEqual([]);
  });
}

test("exposes local redacted diagnostics with launch budgets", async ({ page }) => {
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const diagnostics = await page.evaluate(() => {
    const api = (window as BrowserWindowWithDiagnostics).__HVC_DIAGNOSTICS__;
    if (!api) return null;
    const snapshot = api.snapshot();
    return {
      privacy: snapshot.privacy,
      budgets: snapshot.budgets,
      eventsLength: snapshot.events.length,
      copyText: api.copyText(),
      redacted: api.redactText(
        "Authorization=Bearer abc.def.ghi session_id=sess_123 token=secret\nAuthorization: Basic dXNlcjpwYXNz\nCookie: foo=bar; other=baz",
      ),
    };
  });

  expect(diagnostics).not.toBeNull();
  expect(diagnostics?.privacy).toMatchObject({
    localOnly: true,
    redacted: true,
  });
  expect(diagnostics?.eventsLength).toBe(0);
  expect(diagnostics?.budgets.firstAudioLatencyMs).toBeLessThanOrEqual(3000);
  expect(diagnostics?.budgets.toolResponseLatencyMs).toBeLessThanOrEqual(5000);
  expect(diagnostics?.budgets.reconnectResumeLatencyMs).toBeLessThanOrEqual(
    diagnostics?.budgets.firstAudioLatencyMs ?? 0,
  );
  expect(diagnostics?.budgets.smokeFlakeRate).toBeLessThanOrEqual(0.02);
  expect(diagnostics?.copyText).toContain('"localOnly": true');
  expect(diagnostics?.redacted).toContain("Authorization=[redacted]");
  expect(diagnostics?.redacted).toContain("Authorization: [redacted]");
  expect(diagnostics?.redacted).toContain("Cookie: [redacted]");
  expect(diagnostics?.redacted).toContain("session_id=[redacted]");
  expect(diagnostics?.redacted).toContain("token=[redacted]");
  expect(diagnostics?.redacted).not.toContain("abc.def.ghi");
  expect(diagnostics?.redacted).not.toContain("dXNlcjpwYXNz");
  expect(diagnostics?.redacted).not.toContain("foo=bar");
  expect(diagnostics?.redacted).not.toContain("other=baz");
  expect(diagnostics?.redacted).not.toContain("sess_123");
  expect(diagnostics?.redacted).not.toContain("secret");
});

test("prevents mobile long-press text and image selection on the voice surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubUnlockedSession(page);
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: AGENT_NAME })).toBeVisible();

  const selectionStyles = await page.evaluate(() => {
    const selectors = [".hero-panel", ".topbar h1", ".orb-stage", ".voice-orb"];
    const styles = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const style = getComputedStyle(element);
      return {
        selector,
        userSelect: style.userSelect,
        webkitUserSelect: style.getPropertyValue("-webkit-user-select"),
      };
    });
    return { styles };
  });
  const authoredStyles = await page
    .request.get(`${APP_URL}/src/styles.css`)
    .then((response) => response.text());

  expect(selectionStyles.styles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        selector: ".hero-panel",
        userSelect: "none",
        webkitUserSelect: "none",
      }),
      expect.objectContaining({
        selector: ".topbar h1",
        userSelect: "none",
        webkitUserSelect: "none",
      }),
      expect.objectContaining({
        selector: ".orb-stage",
        userSelect: "none",
        webkitUserSelect: "none",
      }),
      expect.objectContaining({
        selector: ".voice-orb",
        userSelect: "none",
        webkitUserSelect: "none",
      }),
    ]),
  );
  expect(authoredStyles).toContain("-webkit-touch-callout: none");
});

test("honors reduced motion preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubUnlockedSession(page);
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

test("shows and clears the private PIN gate", async ({ page }) => {
  await page.route("**/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Authentication required" }),
    });
  });
  await page.route("**/auth/pin", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        expires_at: "2026-01-01T00:00:00Z",
      }),
    });
  });

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await expect(
    page.getByRole("dialog", { name: `Unlock ${AGENT_NAME}` }),
  ).toBeVisible();
  await expect(page.getByLabel("Private PIN")).toBeFocused();

  await page.getByLabel("Private PIN").fill("abcdefgh");
  await page.getByRole("button", { name: /^Unlock$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("basic Hold submits recognized speech after normal pointer release", async ({
  page,
}) => {
  const chatRequests: unknown[] = [];

  await page.addInitScript(() => {
    const win = window as typeof window & {
      SpeechRecognition?: new () => unknown;
      webkitSpeechRecognition?: new () => unknown;
    };
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      maxAlternatives = 0;
      onresult: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onend: (() => void) | null = null;

      start() {
        window.setTimeout(() => {
          const alternative = {
            transcript: "browser smoke phrase",
            confidence: 0.9,
          };
          const result = {
            0: alternative,
            isFinal: true,
            length: 1,
            item: () => alternative,
          };
          const results = { 0: result, length: 1, item: () => result };
          const event = new Event("result");
          Object.defineProperties(event, {
            resultIndex: { value: 0 },
            results: { value: results },
          });
          this.onresult?.(event);
        }, 10);
      }

      stop() {
        window.setTimeout(() => this.onend?.(), 60);
      }

      abort() {}
    }
    win.SpeechRecognition = MockSpeechRecognition;
    win.webkitSpeechRecognition = MockSpeechRecognition;
  });
  await stubUnlockedSession(page);
  await page.route("**/chat/text", async (route) => {
    chatRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "completed",
        result: { display: "smoke ok", speakable: "smoke ok" },
      }),
    });
  });

  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const orb = page.getByRole("button", { name: /Voice orb:/ });
  const box = await orb.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();

  await expect(page.getByText("smoke ok")).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "browser smoke phrase" }),
  ).toBeVisible();
  expect(chatRequests).toEqual([
    expect.objectContaining({ message: "browser smoke phrase", job: true }),
  ]);
});

test("renders streamed background chat in the transcript", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await stubUnlockedSession(page);
  await page.route("**/chat/text", async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: {
        Location: "/chat/jobs/job-stream",
        "X-HVC-Chat-Job-Id": "job-stream",
      },
      body: JSON.stringify({
        job_id: "job-stream",
        state: "thinking",
        partial_text: "I am checking the current Hermes session...",
      }),
    });
  });
  await page.route("**/chat/jobs/job-stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        job_id: "job-stream",
        state: "complete",
        result: {
          status: "completed",
          result: {
            display: "Hermes session check complete.",
            speakable: "Hermes session check complete.",
          },
        },
      }),
    });
  });

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.getByLabel(`Type a message to ${AGENT_NOUN}`).fill("check session");
  await page.getByRole("button", { name: /Send typed message/ }).click();

  await expect(
    page.getByText("I am checking the current Hermes session..."),
  ).toBeVisible();
  await expect(page.getByText(/working \d+s/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Cancel background reply/ }),
  ).toBeVisible();
  await expect(page.getByText("Hermes session check complete.")).toBeVisible({
    timeout: 5_000,
  });
});

test.describe("real backend token flow", () => {
  test.skip(
    !RUN_TOKEN_FLOW,
    "Set HVC_E2E_RUN_TOKEN_FLOW=true with a real backend to run this check.",
  );

  test("connects from the browser app", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(APP_URL, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /^Live$/ }).click();
    await page.getByRole("button", { name: /Voice orb:/ }).click();
    await expect(
      page.getByText(
        new RegExp(
          `Connecting voice|Listening|${AGENT_NAME_PATTERN} is speaking|Hold-to-talk`,
          "i",
        ),
      ),
    ).toBeVisible({ timeout: 20_000 });
    await page.screenshot({
      path: testInfo.outputPath("real-browser-connected.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /^Hold$/ }).click();
    const actionableErrors = consoleErrors.filter(
      (line) => !line.includes("AudioContext"),
    );
    expect(actionableErrors).toEqual([]);
  });
});
