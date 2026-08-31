import { test, expect } from "@playwright/test";

test.describe("AI 回复复制", () => {
  test("AI 回复渲染后，快捷键可复制其内容", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "新对话" }).click();
    await expect(page.getByText("今天想完成什么？")).toBeVisible();

    const ta = page.getByRole("textbox", { name: "任务输入" });
    await ta.fill("不要调用任何工具，直接用中文回答：你好");
    await ta.press("Enter");

    // 等待 AI 回复消息块出现（第二个 copyable-msg）
    const wrap = page.locator('[data-testid="copyable-msg"]').nth(1);
    await expect(wrap).toBeVisible({ timeout: 120_000 });

    // 等待回复正文非空（复制按钮从 disabled 变为可点）
    const btn = wrap.locator('[data-testid="copy-msg"]');
    await expect(btn).toBeEnabled({ timeout: 120_000 });

    // 先清掉剪贴板基线，再聚焦回复并按 Ctrl+C
    await page.evaluate(() => navigator.clipboard.writeText("__baseline__"));
    await wrap.click();
    await page.keyboard.press("Control+C");

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).not.toBe("__baseline__");
    expect(clip.length).toBeGreaterThan(0);
  });
});