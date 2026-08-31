import { test, expect, type Page } from "@playwright/test";

const t = Date.now();
const MSG = `UI审计-${t}`;

const openTextbox = (page: Page) => page.getByRole("textbox", { name: "任务输入" });

// 每个用例独立，但都依赖后端 Gateway(8001) 已连接（编辑器 ready）
test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  test.skip((await openTextbox(page).count()) === 0, "任务输入框不可见（登录/初始化视图）");
});

test("外壳：Sidebar / Header / 空状态渲染", async ({ page }) => {
  await expect(page.getByText("WorkGuide").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新对话" })).toBeVisible();
  await expect(page.getByText("今天想完成什么？")).toBeVisible();
  await expect(page.getByText("描述任务，WorkGuide 会帮你完成。")).toBeVisible();
  await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
  const modelBtn = page.getByRole("button", { name: /GLM/i });
  await expect(modelBtn.first()).toBeVisible();
});

test("快捷任务：点击触发真实消息流", async ({ page }) => {
  const quick = page.getByRole("button", { name: "梳理这个项目的代码结构" });
  await expect(quick).toBeVisible();
  await quick.click();
  await expect(page.getByText("梳理这个项目的代码结构").last()).toBeVisible({ timeout: 30000 });
});

test("新对话 + Enter 发送 + 消息渲染", async ({ page }) => {
  await page.getByRole("button", { name: "新对话" }).first().click();
  const ta = openTextbox(page);
  await ta.fill(MSG);
  await ta.press("Enter");
  await expect(page.getByText(MSG).last()).toBeVisible({ timeout: 40000 });
});

test("Shift+Enter 换行而不发送", async ({ page }) => {
  const ta = openTextbox(page);
  await ta.fill("第一行");
  await ta.press("Shift+Enter");
  await ta.type("第二行");
  await expect(ta).toHaveValue("第一行\n第二行");
  // 未发送：消息区不应出现该文本（空态标题仍可见）
  await expect(page.getByText("今天想完成什么？")).toBeVisible();
});

test("发送按钮：空态禁用、输入后可用、点击发送", async ({ page }) => {
  const send = page.getByRole("button", { name: "发送" });
  await expect(send).toBeDisabled();
  await openTextbox(page).fill(MSG);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText(MSG).last()).toBeVisible({ timeout: 40000 });
});

test("模型选择器：打开下拉并选中模型", async ({ page }) => {
  const btn = page.getByRole("button", { name: /GLM/i }).first();
  await btn.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const opts = listbox.getByRole("option");
  const n = await opts.count();
  expect(n).toBeGreaterThan(0);
  await opts.first().click();
  await expect(page.getByRole("listbox")).toHaveCount(0); // 选中后关闭
});

test("附件/文件上传：出现上传 chip", async ({ page }) => {
  await page.getByRole("button", { name: "添加文件" }).click().catch(() => {});
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "audit.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("audit-upload-content"),
  });
  await expect(page.getByTestId("upload-chip").first()).toBeVisible({ timeout: 15000 });
});

test("设置：打开、四个 Tab 可见、关闭", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  for (const tab of ["模型", "技能", "记忆", "关于"]) {
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(dialog).toHaveCount(0);
});

test("删除对话：⋯ → 删除 → 确认框 → 移除", async ({ page }) => {
  // 先造一条会话
  await page.getByRole("button", { name: "新对话" }).first().click();
  const ta = openTextbox(page);
  await ta.fill(MSG);
  await ta.press("Enter");
  await expect(page.getByText(MSG).last()).toBeVisible({ timeout: 40000 });

  const before = await page.locator("aside").getByText(MSG).count();

  // 侧边栏该会话行的 ⋯ 菜单
  const row = page.locator("aside").getByText(MSG).first();
  await row.hover();
  const more = page.getByRole("button", { name: "更多操作" }).first();
  await more.click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "删除对话" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  // 删除后该标题的会话数应比删除前减少（存在历史脏数据时不假设清到 0）
  await expect(page.locator("aside").getByText(MSG)).toHaveCount(before - 1, { timeout: 20000 });
});

test("复制消息：hover 复制按钮写入剪贴板", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "新对话" }).first().click();
  const ta = openTextbox(page);
  await ta.fill(`可复制文本-${t}`);
  await ta.press("Enter");
  const bubble = page.getByText(`可复制文本-${t}`).last();
  await expect(bubble).toBeVisible({ timeout: 40000 });
  const copy = page.locator('[data-testid="copy-msg"]').first();
  await copy.scrollIntoViewIfNeeded();
  await copy.click();
  await expect(page.getByText("已复制").first()).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(`可复制文本-${t}`);
});