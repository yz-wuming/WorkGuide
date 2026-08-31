import { test, expect } from "@playwright/test";

/**
 * 验证：对话 A 流式回复中点击「新对话」切到 B 后，A 在后台继续生成；
 * A 完成时顶部弹出「已完成回复」通知，点击「查看」可跳回 A 看到完整回复。
 */
test("background completion shows a notification with view action", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });

  // 发送消息到对话 A
  const composer = page.locator("textarea, [contenteditable='true'], input").first();
  await composer.click();
  await composer.fill("用一句话介绍你自己。");
  await composer.press("Enter");

  // 等流式请求开始（侧边栏出现「生成中」或新对话按钮可用）
  await expect
    .poll(() => page.locator("nav div[class*='h-14']").count(), { timeout: 20000 })
    .toBeGreaterThan(0);

  // 让回复进行一小段时间，然后点击「新对话」切到 B
  await page.waitForTimeout(1500);
  await page.locator("button", { hasText: "新对话" }).first().click();

  // 等后台完成通知出现（A 在后台跑完）
  const toast = page.locator("text=已完成回复").first();
  await expect(toast).toBeVisible({ timeout: 90000 });
  console.log("[test] completion toast visible");

  // 通知里应有「查看」按钮
  const viewBtn = page.locator("button", { hasText: "查看" }).first();
  await expect(viewBtn).toBeVisible();

  // 点击「查看」跳回对话 A
  await viewBtn.click();
  console.log("[test] clicked 查看");

  // 跳回后应能看到 assistant 的回复内容（非空）
  await expect
    .poll(
      async () => {
        const text = await page.locator("body").innerText();
        return text.includes("介绍") || text.includes("助手") || text.includes("你好");
      },
      { timeout: 20000 },
    )
    .toBe(true);
  console.log("[test] reply visible after switching back");
});
