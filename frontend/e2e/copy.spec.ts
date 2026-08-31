import { test, expect } from "@playwright/test";

test.describe("消息复制", () => {
  test("用户消息有复制按钮，点击后真实写入剪贴板", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "新对话" }).click();
    await expect(page.getByText("今天想完成什么？")).toBeVisible();

    const text = `可复制的用户消息-${Date.now()}`;
    const ta = page.getByRole("textbox", { name: "任务输入" });
    await ta.fill(text);
    await ta.press("Enter");

    // 消息区（.scroll-slim）里的用户气泡 + 复制按钮（侧边栏不含 copy-msg）
    const btn = page.locator('[data-testid="copy-msg"]').first();
    await btn.hover(); // hover 按钮 / 所在 group 使其显形
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByText("已复制").first()).toBeVisible();

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(text);
  });

  test("用户消息聚焦后 Ctrl+C 快捷键复制整条", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page.getByRole("button", { name: "新对话" }).click();
    await expect(page.getByText("今天想完成什么？")).toBeVisible();

    const text = `快捷键复制的用户消息-${Date.now()}`;
    const ta = page.getByRole("textbox", { name: "任务输入" });
    await ta.fill(text);
    await ta.press("Enter");

    const wrap = page.locator('[data-testid="copyable-msg"]').first();
    await expect(wrap).toBeVisible();
    await wrap.click(); // 点击聚焦该消息
    await page.keyboard.press("Control+C");

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(text);
  });
});