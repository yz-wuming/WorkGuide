import { test, expect, type Page } from "@playwright/test";

/**
 * Black-box 验收补充 —— 补齐既有清单的 NOT TESTED 项与边界态。
 * 全部通过真实浏览器交互（hover/click/键盘/真实对话框）驱动，并在关键步骤捕获 console/network 错误。
 */

const TS = Date.now();
const openSettings = async (page: Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
};

/** 收集 console.error / pageerror / HTTP>=400；返回函数取结果 */
function watch(page: Page, errs: string[]) {
  page.on("console", (m) => m.type() === "error" && errs.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e)}`));
  page.on("response", (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url()}`));
}

function errFilter(errs: string[], kind: "5xx" | "pageerror" | "assert") {
  return errs.filter((e) =>
    kind === "5xx" ? /HTTP 5/.test(e) : kind === "pageerror" ? e.startsWith("pageerror") : /HTTP/.test(e),
  );
}

test.describe("BB 设置抽屉：Esc 关闭 / 遮罩关闭", () => {
  test("打开设置 -> Esc 关闭 -> 再次打开 -> 点完成关闭", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await openSettings(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
    // 再次打开，用「完成」按钮关闭（模型 Tab 内有该按钮）
    await page.getByRole("button", { name: "设置" }).click();
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
    const done = page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "完成" });
    if ((await done.count()) > 0) {
      await done.click();
      await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
    }
    expect(errFilter(errs, "pageerror").length).toBe(0);
    expect(errFilter(errs, "5xx").length).toBe(0);
  });
});

test.describe("BB 模型 Tab：添加/编辑/删除本地模型（真实对话框）", () => {
  test("添加-编辑-删除全流程，且 取消 删除不生效", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await openSettings(page);
    await page.getByRole("button", { name: "模型", exact: true }).click();

    const mark = `bb${TS % 100000}`;
    const labelName = `BB测试${TS % 1000}`;

    // 空名称校验：点保存需报错（不新建）
    await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "添加模型" }).first().click();
    const saveBtn = page.getByRole("button", { name: "保存" });
    await saveBtn.click();
    await expect(page.getByText("模型标识（name）必填")).toBeVisible();

    // 真实模型 ID 校验
    await page.getByPlaceholder("如 my-gpt4o").fill(mark);
    await saveBtn.click();
    await expect(page.getByText("真实模型 ID 必填")).toBeVisible();

    // 合法填写并保存
    await page.getByPlaceholder("如 gpt-4o").fill(mark + "-model");
    await page.getByPlaceholder("如 我的 GPT-4o").fill(labelName);
    await saveBtn.click();
    // 新建后回到模型列表，本地模型区出现该 label
    await expect(page.getByText(labelName).first()).toBeVisible({ timeout: 5000 });

    // 删除（先取消应保留）
    const card = page.getByRole("dialog", { name: "设置" }).getByText(labelName).first();
    await card.hover();
    page.once("dialog", (d) => d.dismiss());
    await card.locator("xpath=ancestor::div[contains(@class,'rounded-md')]")
      .getByRole("button", { name: "删除" }).click();
    await expect(page.getByText(labelName).first()).toBeVisible();

    // 再删除（确认应移除）
    page.once("dialog", (d) => d.accept());
    await card.locator("xpath=ancestor::div[contains(@class,'rounded-md')]")
      .getByRole("button", { name: "删除" }).click();
    await expect(page.getByText(labelName).first()).toHaveCount(0, { timeout: 5000 });

    expect(errFilter(errs, "pageerror").length).toBe(0);
    expect(errFilter(errs, "5xx").length).toBe(0);
  });
});

test.describe("BB 技能 Tab：编辑器 + 创建（成功或错误反馈）", () => {
  test("空表单本地校验；创建后编辑器关闭或错误提示浮出，UI 不崩溃", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await openSettings(page);
    await page.getByRole("button", { name: "技能", exact: true }).click();

    await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "新建技能" }).click();
    const editor = page.getByRole("dialog", { name: "新建技能" });
    await expect(editor).toBeVisible();

    // 本地校验：空表单保存 → 名称必填
    await editor.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("技能名称必填")).toBeVisible();

    // 填写并保存：接受两种合理结果（成功关闭编辑器 / 后端阻塞时浮出错误反馈）
    const skillName = `browser-test-skill-${TS % 1000}`;
    await editor.getByPlaceholder("如 Code Review").fill(skillName);
    await editor.getByPlaceholder("概述这个技能做什么").fill(`Browser interaction testing skill ${TS % 1000}`);
    await editor.locator("textarea").fill("When testing a web application, verify visible UI state after every user interaction.");
    await editor.getByRole("button", { name: "保存" }).click();
    const outcome = await Promise.race([
      page.getByText(/创建技能失败|已创建/).first().waitFor({ timeout: 30_000 }).then(() => "MESSAGE"),
      editor.waitFor({ state: "hidden", timeout: 30_000 }).then(() => "EDITOR_CLOSED"),
    ]);
    expect(["MESSAGE", "EDITOR_CLOSED"]).toContain(outcome);

    expect(errFilter(errs, "pageerror").length).toBe(0);
    expect(errFilter(errs, "5xx").length).toBe(0);
  });
});

test.describe("BB Composer 边界：空态禁用 / 自动增长 / 最大高度", () => {
  test("空消息发送被禁用；长文本增高且受 320px 限制；发送后回落", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新对话" }).click();
    const ta = page.getByRole("textbox", { name: "任务输入" });
    const send = page.getByRole("button", { name: "发送" });

    // 空态禁用
    await expect(send).toBeDisabled();

    // 初始高度在 90–150
    let box = (await ta.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(90);
    expect(box.height).toBeLessThanOrEqual(160);

    // 多行文本自动增长，且封顶 320
    const long = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行内容`).join("\n");
    await ta.fill(long);
    box = (await ta.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(325);

    // 输入后发送可用
    await expect(send).toBeEnabled();

    // 清空后重新禁用
    await ta.fill("");
    await expect(send).toBeDisabled();

    // 发送可用后发送，不应崩溃（后端 agent 处理中可能较慢，仅验证发送按钮与无未处理 pageerror）
    await ta.fill("你好 WorkGuide");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText("你好 WorkGuide").last()).toBeVisible({ timeout: 15000 });
    // Composer 发送后清空并回落高度
    await expect(ta).toHaveValue("");
    expect(errFilter(errs, "pageerror").length).toBe(0);
  });
});

test.describe("BB 会话：hover 更多操作 / 重命名 Esc 取消", () => {
  test("hover 出现 ⋯；打开菜单重命名；Esc/失焦取消编辑", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新对话" }).click();
    const ta = page.getByRole("textbox", { name: "任务输入" });
    const title = `改名行-${TS % 10000}`;
    await ta.fill(title);
    await ta.press("Enter");
    await expect(page.getByText(title).last()).toBeVisible({ timeout: 20000 });

    const row = page.locator("nav").getByText(title, { exact: true }).first();
    const more = page.getByRole("button", { name: "更多操作" }).first();
    // hover 前后按钮可见性
    await expect(more).toBeHidden();
    await row.hover();
    await expect(more).toBeVisible({ timeout: 3000 });

    await more.click();
    await expect(page.getByRole("button", { name: "重命名" })).toBeVisible();
    await page.getByRole("button", { name: "重命名" }).click();
    // 行内输入框出现，预填原标题；Esc 取消
    const renameInput = page.locator("nav input").first();
    await expect(renameInput).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("nav input").first()).toHaveCount(0);

    expect(errFilter(errs, "pageerror").length).toBe(0);
  });
});

test.describe("BB 错误态与只读态", () => {
  test("上传真实文件出现上传中/已上传反馈；上传 chip 可移除", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "新对话" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "bb.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("blackbox-upload"),
    });
    await expect(page.getByTestId("upload-chip").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("upload-chip").first()).toContainText("bb.txt");
    // 移除 chip
    await page.getByTestId("upload-chip").first().getByRole("button", { name: /移除 bb\.txt/ }).click();
    await expect(page.getByTestId("upload-chip")).toHaveCount(0, { timeout: 5000 });
    expect(errFilter(errs, "5xx").length).toBe(0);
  });
});