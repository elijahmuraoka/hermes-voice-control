import { test, expect } from "@playwright/test";

const APP_URL = process.env.HVC_E2E_APP_URL ?? "http://127.0.0.1:5173";
const AGENT_NAME = process.env.HVC_E2E_AGENT_NAME ?? "Hermes Agent";
const AGENT_NAME_PATTERN = AGENT_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SCREENSHOT_DIR = "docs/assets/screenshots";
const viewports = [
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1280", width: 1280, height: 900 },
];

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
    await expect(
      page.getByRole("button", { name: /Voice orb:/ }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Mute$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^End$/ })).toBeVisible();
    await expect(
      page.getByLabel("Type a message to your Hermes agent"),
    ).toBeVisible();
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
    await page.screenshot({
      path: `${SCREENSHOT_DIR}/${viewport.name}.png`,
      fullPage: true,
    });
    expect(consoleErrors).toEqual([]);
  });
}

test("real backend token flow connects from the browser app", async ({
  page,
}) => {
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
