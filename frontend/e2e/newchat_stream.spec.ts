import { test, expect, type Page } from "@playwright/test";

/**
 * 复现：对话 A 流式回复中，点击「新对话」，观察对话 A 的 SSE stream 请求
 * 是否被 abort / 是否停止产生数据。
 */
test("new chat does not abort the previous chat's stream", async ({ page }) => {
  const streamUrls: string[] = [];
  const aborted: string[] = [];
  const streamResponses: string[] = [];

  page.on("request", (req) => {
    if (req.url().includes("/runs/stream")) streamUrls.push(req.url());
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes("/runs/stream"))
      aborted.push(`${req.url()} :: ${req.failure()?.errorText}`);
  });
  page.on("response", (resp) => {
    if (resp.url().includes("/runs/stream"))
      streamResponses.push(`${resp.url()} :: ${resp.status()}`);
  });

  await page.goto("/", { waitUntil: "networkidle" });

  // 发送一条消息
  const composer = page.locator("textarea, [contenteditable='true'], input").first();
  await composer.click();
  await composer.fill("请分十段介绍量子计算，每段之间停顿一下。");
  await composer.press("Enter");

  // 等待 stream 请求出现
  await expect
    .poll(() => streamUrls.length, { timeout: 20000 })
    .toBeGreaterThan(0);
  console.log("[test] stream started:", streamUrls);

  // 等 3 秒让回复进行中
  await page.waitForTimeout(3000);

  // 点击「新对话」
  await page.locator("button", { hasText: "新对话" }).first().click();
  console.log("[test] clicked 新对话");

  // 等 6 秒观察 stream 是否被 abort / 是否继续
  await page.waitForTimeout(6000);

  console.log("[test] stream requests:", streamUrls);
  console.log("[test] aborted:", aborted);
  console.log("[test] responses:", streamResponses);

  // 关键断言：新建对话不应 abort 旧对话的 stream 请求
  expect(aborted, "新对话不应 abort 旧对话的 stream 请求").toHaveLength(0);
});
