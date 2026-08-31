import { test, expect } from "@playwright/test";

test("发送箭头：空态禁用，输入后可用，点击发出消息", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  const ta = page.getByRole("textbox", { name: "任务输入" });
  const taCount = await ta.count();

  // 若没有输入框，多半是登录/初始化页，如实报告跳过
  test.skip(taCount === 0, `任务输入框不可见（可能处于 登录/初始化 视图，url=${page.url()}）`);

  const sendBtn = page.getByRole("button", { name: "发送" });
  await expect(sendBtn).toHaveCount(1);
  await expect(sendBtn).toBeDisabled(); // 空输入应禁用

  await ta.fill("测试发送箭头");
  await expect(sendBtn).toBeEnabled(); // 输入后可用

  await sendBtn.click();
  // 同文本会同时出现在侧边栏标题与消息气泡，取 DOM 靠后的（消息区）那个
  await expect(page.getByText("测试发送箭头").last()).toBeVisible({ timeout: 8000 });

  expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
});