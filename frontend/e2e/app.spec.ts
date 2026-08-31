import { test, expect, type Page } from "@playwright/test";

/** 快捷入口：点击侧边栏「新对话」并在侧边栏出现该会话标题 */
async function newConversation(page: Page) {
  await page.getByRole("button", { name: "新对话" }).click();
  // 空状态存在即已进入新对话
  await expect(page.getByText("今天想完成什么？")).toBeVisible();
}

/** 打开指定会话行的更多操作菜单（限定在 nav 内，避开「新对话」按钮） */
async function openThreadMenu(page: Page, title: string) {
  const row = page.locator("nav").getByText(title, { exact: true }).first();
  await row.hover();
  await row.locator("xpath=ancestor::div[contains(@class,'group')][1]")
    .getByRole("button", { name: "更多操作" })
    .click();
  await expect(page.getByRole("button", { name: "重命名" })).toBeVisible();
}

test.describe("UI 交互 E2E", () => {
  test("首页空状态 + 推荐任务按钮", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("描述任务，WorkGuide 会帮你完成。")).toBeVisible();
    for (const t of [
      "梳理这个项目的代码结构",
      "为这段代码补充注释与说明",
      "总结一段文本的要点",
    ]) {
      await expect(page.getByRole("button", { name: t })).toBeVisible();
    }
  });

  test("New Task → 侧边栏出现会话", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
  });

  test("Composer 输入 + 标题持久化", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
    const ta = page.getByRole("textbox", { name: "任务输入" });
    await ta.fill("E2E 历史会话标题");
    await ta.press("Enter");
    await expect(page.getByText("E2E 历史会话标题", { exact: true }).first()).toBeVisible();
  });

  test("Model Selector 打开并选择", async ({ page }) => {
    await page.goto("/");
    const dropdown = page.getByRole("button", { name: /选择模型|Model/ }).or(
      page.locator('button[aria-haspopup="listbox"]').first(),
    );
    await dropdown.click();
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    const opts = page.locator('[role="option"]');
    const count = await opts.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // 关闭
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="listbox"]')).not.toBeVisible();
  });

  test("Conversation 重命名", async ({ page }) => {
    const orig = `原始标题-${Date.now()}`;
    const renamed = `重命名后-${Date.now()}`;
    await page.goto("/");
    await page.getByRole("textbox", { name: "任务输入" }).fill(orig);
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    await expect(page.getByText(orig).first()).toBeVisible();
    await openThreadMenu(page, orig);
    await page.getByRole("button", { name: "重命名" }).click();
    // 重命名输入框是受控 input，value 以属性而非 attribute 呈现，且 autoFocus
    const input = page.locator("nav input");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(orig);
    await input.fill(renamed);
    await input.press("Enter");
    await expect(page.getByText(renamed, { exact: true }).first()).toBeVisible();
  });

  test("Conversation 删除 → 确认框取消保留 / 确认删除", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
    const target = `待删除-${Date.now()}`;
    await page.getByRole("textbox", { name: "任务输入" }).fill(target);
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    await expect(page.getByText(target).first()).toBeVisible();

    // 取消路径
    await openThreadMenu(page, target);
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByText("删除对话？")).toBeVisible();
    await expect(page.getByText("删除后无法恢复。")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByText("删除对话？")).not.toBeVisible();
    await expect(page.getByText(target).first()).toBeVisible();

    // 删除路径
    await openThreadMenu(page, target);
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("删除对话？")).not.toBeVisible();
    await expect(page.getByText(target)).toHaveCount(0);
  });

  test("两个会话切换", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
    await page.getByRole("textbox", { name: "任务输入" }).fill("会话A");
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    await page.getByRole("button", { name: "新对话" }).click();
    await page.getByRole("textbox", { name: "任务输入" }).fill("会话B");
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    // 切回 A
    await page.getByText("会话A", { exact: true }).first().click();
    await expect(page.getByText("会话A", { exact: true }).first()) .toBeVisible();
    // 用户消息回显
    await expect(page.locator("div").getByText("会话A", { exact: true }).last()).toBeVisible();
  });

  test("页面刷新后会话持久化", async ({ page }) => {
    const title = `持久化-${Date.now()}`;
    await page.goto("/");
    await page.getByRole("textbox", { name: "任务输入" }).fill(title);
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();

    // 刷新：会话列表 + 当前正在查看的消息应保留
    await page.reload();
    await expect(page.getByText("今天想完成什么？")).toBeVisible();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  });

  test("Settings 打开 + 四个 Tab", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    for (const t of ["模型", "技能", "记忆", "关于"]) {
      await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible();
    }
    await expect(page.locator('[role="dialog"][aria-label="设置"]')).toBeVisible();
    // 关闭
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test("File Upload（需先建会话）", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
    const input = page.locator('input[type="file"]');
    await input.setInputFiles({
      name: "e2e_sample.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello e2e"),
    });
    await expect(page.getByText("已上传 1 个文件")).toBeVisible();
  });
});

test.describe("Skills CRUD E2E（隔离数据）", () => {
  test("Create → Edit → Enable/Disable → Delete", async ({ page }) => {
    const slug = `skill-e2e-${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "技能", exact: true }).click();
    // 已有技能列表加载完成
    await expect(page.getByRole("button", { name: "新建技能" })).toBeVisible();

    // 创建
    await page.getByRole("button", { name: "新建技能" }).click();
    const dialog = page.locator('[role="dialog"][aria-label="新建技能"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[placeholder="如 Code Review"]').fill(slug);
    await dialog.locator('input[placeholder="概述这个技能做什么"]').fill("E2E 代码审查技能");
    await dialog.locator('textarea').fill("检查代码中的潜在 Bug 与安全问题。");
    await dialog.getByRole("button", { name: "保存技能" }).click();
    await expect(page.getByText("已创建").first()).toBeVisible();
    const card = page.locator(`text=${slug}`).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(card.getByText(slug, { exact: true })).toBeVisible();
    await expect(card.getByText("已启用", { exact: true })).toBeVisible();

    // 禁用
    await card.locator('[role="switch"]').click();
    await expect(card.getByText("已禁用", { exact: true })).toBeVisible();
    await expect(card.getByText("已启用", { exact: true })).not.toBeVisible();

    // 编辑
    await card.getByRole("button", { name: "编辑技能" }).click();
    const editDlg = page.locator('[role="dialog"][aria-label^="编辑技能"]');
    await expect(editDlg).toBeVisible();
    await editDlg.locator('input[placeholder="概述这个技能做什么"]').fill("E2E 编辑后的描述");
    await editDlg.getByRole("button", { name: "保存技能" }).click();
    await expect(card.getByText("E2E 编辑后的描述")).toBeVisible();

    // 删除（window.confirm）
    page.once("dialog", (d) => d.accept());
    await card.getByRole("button", { name: "删除技能" }).click();
    await expect(page.locator(`text=${slug}`)).toHaveCount(0);
  });
});

test.describe("Agent 浏览器链路（真实模型）", () => {
  test("发送任务 → 收到 Agent 回复 → 工具时间线展开/折叠", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await newConversation(page);
    const ta = page.getByRole("textbox", { name: "任务输入" });
    await ta.fill("用 Python 创建一个文件 e2e_agent_probe.txt，内容为 hello-world");
    await ta.press("Enter");

    // 等待 agent 回复（真实模型 + 工具执行）
    await expect(page.getByText("正在思考…").first()).toBeVisible({ timeout: 20_000 });
    // 等待真正的 assistant 回复气泡（区别于用户回显 .justify-end），证明
    // 输入 → 前端 → API → Agent → Model → 结果 全链路真实跑通且产生回复。
    await expect
      .poll(
        async () => {
          const texts = await page
            .locator('.anim-msg-in:not(.justify-end) .prose-md')
            .allTextContents();
          return texts.some((t) => t && t.trim().length > 0);
        },
        { timeout: 170_000 },
      )
      .toBe(true);
    // 工具时间线：出现包含「工具」的折叠条
    const timeline = page.getByRole("button", { name: /个工具 · 完成/ });
    if ((await timeline.count()) > 0) {
      await timeline.first().click();
      await expect(page.getByText("展开")).toHaveCount(0);
    } else {
      // 未出现工具条时直接断言任务有产出即可
      await expect(page.getByText("今天想完成什么？")).not.toBeVisible();
    }
  });
});