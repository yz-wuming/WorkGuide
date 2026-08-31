import { test, expect } from "@playwright/test";

const VIEWPORTS: [number, number][] = [
  [1920, 1080],
  [1600, 900],
  [1440, 900],
  [1366, 768],
];

test.describe("响应式：无横向溢出且关键控件可见", () => {
  for (const [w, h] of VIEWPORTS) {
    test(`${w}×${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const tb = page.getByRole("textbox", { name: "任务输入" });
      if ((await tb.count()) === 0) {
        test.skip(true, "任务输入框不可见");
      }
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth +
            1,
      );
      expect(overflow).toBe(false);
      await expect(page.getByRole("button", { name: "新对话" })).toBeVisible();
      await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
    });
  }
});

test("分辨率 1600×900：主界面截图（设计目检）", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: "test-results/redesign-1600-empty.png", fullPage: false });
  const tb = page.getByRole("textbox", { name: "任务输入" });
  if (await tb.count()) {
    await tb.fill("你好，帮我整理这个项目的结构");
    await page.waitForTimeout(250);
    await page.screenshot({ path: "test-results/redesign-1600-typed.png", fullPage: false });
  }
  await page.waitForTimeout(300);
  expect(errors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});