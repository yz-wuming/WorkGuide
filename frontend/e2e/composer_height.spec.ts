import { test, expect } from "@playwright/test";

test("Composer 初始高度落在文档规格 90–150 且贴近紧凑偏好", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "新对话" }).click();
  const ta = page.getByRole("textbox", { name: "任务输入" });
  const b = (await ta.boundingBox())!;
  console.log(`COMPOSER_INITIAL_HEIGHT=${Math.round(b.height * 10) / 10}`);
  expect(b.height).toBeGreaterThanOrEqual(90);
  expect(b.height).toBeLessThanOrEqual(150);
  // 长文本封顶 320
  await ta.fill(Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join("\n"));
  const b2 = (await ta.boundingBox())!;
  console.log(`COMPOSER_GROWN_HEIGHT=${Math.round(b2.height * 10) / 10}`);
  expect(b2.height).toBeLessThanOrEqual(325);
});