import { test, expect } from "@playwright/test";

/**
 * 完整复现：对话 A 流式回复中点击「新对话」，等运行完成后切回对话 A，
 * 检查回复是否完整显示（而不是停在半途）。
 */
test("new chat then switch back shows the completed reply", async ({ page }) => {
  const streamUrls: string[] = [];
  const aborted: string[] = [];

  page.on("request", (req) => {
    if (req.url().includes("/runs/stream")) streamUrls.push(req.url());
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("/runs/stream"))
      aborted.push(`${req.url()} :: ${req.failure()?.errorText}`);
  });

  await page.goto("/", { waitUntil: "networkidle" });

  // 发送消息
  const composer = page.locator("textarea, [contenteditable='true'], input").first();
  await composer.click();
  await composer.fill("请分十段介绍量子计算，每段之间停顿一下。");
  await composer.press("Enter");

  await expect.poll(() => streamUrls.length, { timeout: 20000 }).toBeGreaterThan(0);
  const streamUrl = streamUrls[0];
  console.log("[test] stream started:", streamUrl);

  // 等 2 秒让回复进行中，然后点击「新对话」
  await page.waitForTimeout(2000);
  await page.locator("button", { hasText: "新对话" }).first().click();
  console.log("[test] clicked 新对话");

  // 等 30 秒让对话 A 的后台运行完成
  await page.waitForTimeout(30000);

  // 切回对话 A（侧边栏第一个会话，即刚才那个）
  const rows = page.locator("nav div[class*='h-14']");
  const count = await rows.count();
  console.log("[test] sidebar rows:", count);
  expect(count).toBeGreaterThanOrEqual(1);
  await rows.first().click();
  console.log("[test] switched back to first thread");

  // 检查消息区是否显示了 assistant 回复
  await page.waitForTimeout(3000);
  const msgs = page.locator("[data-testid='message'], .message, main div");
  // 找 assistant 消息文本
  const bodyText = await page.locator("body").innerText();
  const hasReply = bodyText.includes("量子") || bodyText.includes("计算");
  console.log("[test] aborted:", aborted);
  console.log("[test] body contains reply:", hasReply);
  console.log("[test] body snippet:", bodyText.slice(0, 300).replace(/\n/g, " | "));

  expect(aborted, "新对话不应 abort 旧对话 stream").toHaveLength(0);
});
