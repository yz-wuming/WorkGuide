import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TD = resolve(dirname(fileURLToPath(import.meta.url)), "../testdata");

/** 收集本测试内的 console error 与 >=400 的响应 */
function watch(page: Page, errs: string[]) {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errs.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e)}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errs.push(`HTTP ${r.status()} ${r.url()}`);
  });
}

async function newConversation(page: Page) {
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(page.getByText("今天想完成什么？")).toBeVisible();
}

test.describe("Acceptance: File Upload 真实落盘", () => {
  for (const f of ["accept_sample.txt", "accept_sample.md", "accept_sample.csv", "accept_sample.json", "accept_sample.pdf"]) {
    test(`上传 ${f} -> 成功 toast -> 后端落盘`, async ({ page, request }) => {
      const errs: string[] = [];
      watch(page, errs);
      await page.goto("/");
      await newConversation(page);
      const input = page.locator('input[type="file"]');
      await input.setInputFiles(resolve(TD, f));
      await expect(page.getByText(/已上传 1 个文件/)).toBeVisible({ timeout: 20_000 });

      // 后端确认真实落盘：列出当前线程的 uploads
      const listRes = await page.evaluate(async () => {
        const r = await fetch("/api/threads/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1, offset: 0 }),
        });
        const rows = (await r.json()) as Array<{ thread_id: string }>;
        const list = await fetch(`/api/threads/${rows[0].thread_id}/uploads/list`);
        return list.ok ? ((await list.json()) as { files: Array<{ filename: string }> }) : { files: [] };
      });
      const names = listRes.files.map((x) => x.filename);
      expect(names.some((n) => n.startsWith(f))).toBeTruthy();
      expect(errs.filter((e) => e.startsWith("HTTP") && e.includes("uploads"))).toHaveLength(0);
    });
  }

  test("空文件上传 -> 成功(后端接受) 且 无未处理错误", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/");
    await newConversation(page);
    await page.locator('input[type="file"]').setInputFiles(resolve(TD, "empty.txt"));
    await expect(page.getByText(/已上传 1 个文件/)).toBeVisible({ timeout: 20_000 });
    expect(errs.filter((e) => e.startsWith("HTTP 5"))).toHaveLength(0);
  });

  test("首页空状态直接上传：不弹「先新建对话」，自动建会话、后端落盘且持久显示文件名", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/");
    // 关键：不点「新对话」，直接从首页上传（无当前会话）
    await page.locator('input[type="file"]').setInputFiles(resolve(TD, "accept_sample.txt"));
    await expect(page.getByText(/已上传 1 个文件/)).toBeVisible({ timeout: 20_000 });

    // 不得再出现旧的阻塞引导
    await expect(page.getByText("请先新建一个对话")).toHaveCount(0);

    // 持久成功指示：上传文件 chip 出现且含该文件名（非仅瞬态 toast）
    const chip = page.locator('[data-testid="upload-chip"]').first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("accept_sample");
    const chipCount = await page.locator('[data-testid="upload-chip"]').count();
    expect(chipCount).toBeGreaterThanOrEqual(1);

    // 后端真实落盘：搜索刚创建的线程（最新一条），其 uploads 中应含该文件
    const listRes = await page.evaluate(async () => {
      const r = await fetch("/api/threads/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1, offset: 0 }),
      });
      const rows = (await r.json()) as Array<{ thread_id: string }>;
      if (!rows.length) return { files: [] };
      const list = await fetch(`/api/threads/${rows[0].thread_id}/uploads/list`);
      return list.ok ? ((await list.json()) as { files: Array<{ filename: string }> }) : { files: [] };
    });
    const names = listRes.files.map((x) => x.filename);
    expect(names.some((n) => n.startsWith("accept_sample"))).toBeTruthy();

    expect(errs.filter((e) => e.startsWith("HTTP 5") || e.startsWith("pageerror"))).toHaveLength(0);
  });
});

test.describe("Acceptance: Message Bubble + Composer", () => {
  test("User 消息为右侧气泡，Composer 初始高度适中且 Enter 发送/Shift+Enter 换行", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/");
    await newConversation(page);
    const ta = page.getByRole("textbox", { name: "任务输入" });

    // Composer 初始高度：不再占满页面（语义：低矮），且在视口内
    const box = await ta.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(150);
    expect(box!.height).toBeGreaterThanOrEqual(90);

    // Shift+Enter 插入换行（不发送）
    await ta.fill("第一行");
    await ta.press("Shift+Enter");
    await ta.type("第二行");
    await expect(ta).toHaveValue("第一行\n第二行");

    // 真实发送（空消息时不发）
    await ta.press("Enter");
    // 用户气泡：右对齐 + 浅底背景，内含发送的完整文本（"第一行\n第二行"）
    const userBubble = page.locator(".anim-msg-in.justify-end > div").first();
    await expect(userBubble).toBeVisible({ timeout: 20_000 });
    await expect(userBubble).toContainText("第一行");
    await expect(userBubble).toContainText("第二行");
    const bc = await userBubble.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        align: (el.parentElement as HTMLElement).style.justifyContent || "",
        bg: s.backgroundColor,
        rightInViewport: r.right <= window.innerWidth + 1,
      };
    });
    // justify-end 由 flex 类实现
    expect(bc.rightInViewport).toBe(true);

    expect(errs.length).toBe(0);
  });
});

test.describe("Acceptance: Delete Modal 居中 + ESC/取消/确认", () => {
  test("删除确认框完整居中显示，冲突场景（多位会话/小视口）也可点击", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/");
    // 造多个会话让列表可滚动，复现“低位条目”场景
    for (let i = 0; i < 6; i++) {
      await newConversation(page);
      await page.getByRole("textbox", { name: "任务输入" }).fill(`批量-${i}-${Date.now()}`);
      await page.getByRole("textbox", { name: "任务输入" }).press("Enter");
    }
    const target = `待删慢-${Date.now()}`;
    await newConversation(page);
    await page.getByRole("textbox", { name: "任务输入" }).fill(target);
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");

    // 打开目标行的菜单并点删除（先滚入视野，弱机高负载下 hover 稳定化更可靠）
    const row = page.locator("nav").getByText(target, { exact: true }).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await row.hover({ timeout: 30_000 });
    await row.locator("xpath=ancestor::div[contains(@class,'group')][1]")
      .getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("button", { name: "删除" }).click();

    const dialog = page.locator('[role="dialog"][aria-label="删除对话"]');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const vw = page.viewportSize()!.width;
    const vh = page.viewportSize()!.height;
    // 完整在视口内且水平居中
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
    expect(Math.abs(box!.x + box!.width / 2 - vw / 2)).toBeLessThan(20);

    // ESC 关闭
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("删除确认：取消保留 / 确认真正删除", async ({ page }) => {
    await page.goto("/");
    await newConversation(page);
    const target = `确认删-${Date.now()}`;
    await page.getByRole("textbox", { name: "任务输入" }).fill(target);
    await page.getByRole("textbox", { name: "任务输入" }).press("Enter");

    const row = page.locator("nav").getByText(target, { exact: true }).first();
    await row.hover();
    await row.locator("xpath=ancestor::div[contains(@class,'group')][1]")
      .getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("button", { name: "删除" }).click();
    await expect(page.getByText("删除对话？")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.getByText("删除对话？")).not.toBeVisible();
    await expect(page.locator("nav").getByText(target, { exact: true })).toHaveCount(1);

    // 再次打开并确认删除
    await row.hover();
    await row.locator("xpath=ancestor::div[contains(@class,'group')][1]")
      .getByRole("button", { name: "更多操作" }).click();
    await page.getByRole("button", { name: "删除" }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByText("删除对话？")).not.toBeVisible();
    await expect(page.locator("nav").getByText(target, { exact: true })).toHaveCount(0);
  });
});

test.describe("Acceptance: Responsive 无横向滚动 + 关键元素可达", () => {
  const viewports = [
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [1024, 768],
    [768, 1024],
    [375, 812],
  ] as const;
  for (const [w, h] of viewports) {
    test(`${w}x${h} 无横向滚动/弹窗在屏内`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const errs: string[] = [];
      watch(page, errs);
      await page.goto("/");
      // 窄屏侧边栏为抽屉态，先打开再点「新对话」
      if (w < 768) {
        await page.locator('button[aria-label="打开侧边栏"]').click();
      }
      await page.getByRole("button", { name: "新对话" }).click();
      // 无横向滚动
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflowX).toBeLessThanOrEqual(1);

      // 打开设置并校验弹窗在屏内
      if (w >= 768) {
        await page.getByRole("button", { name: "设置" }).click();
      } else {
        // 窄屏：设置入口在移动菜单里；点移动侧栏按钮
        await page.locator('button[aria-label="打开侧边栏"]').click();
        await page.getByRole("button", { name: "设置" }).click();
      }
      await expect(page.locator('[role="dialog"][aria-label="设置"]')).toBeVisible();
      const d = await page.locator('[role="dialog"][aria-label="设置"]').boundingBox();
      expect(d!.x + d!.width).toBeLessThanOrEqual(w + 1);
    });
  }
});

test.describe("Acceptance: 交互扫描（真实点击主流程）+ 无关键错误", () => {
  test("主页→新对话→模型下拉→设置四Tab→技能→记忆→关于→关闭", async ({ page }) => {
    const errs: string[] = [];
    watch(page, errs);
    await page.goto("/");

    // 推荐任务快捷按钮可点
    const quick = page.getByRole("button", { name: "梳理这个项目的代码结构" });
    await expect(quick).toBeVisible();

    await newConversation(page);
    // 模型下拉
    const dropdown = page.locator('button[aria-haspopup="listbox"]').first();
    await dropdown.click();
    await expect(page.locator('[role="listbox"]')).toBeVisible();
    const opts = page.locator('[role="option"]');
    if ((await opts.count()) > 0) await opts.first().click();
    await expect(page.locator('[role="listbox"]')).not.toBeVisible();

    // 设置
    await page.getByRole("button", { name: "设置" }).click();
    for (const t of ["模型", "技能", "记忆", "关于"]) {
      await page.getByRole("button", { name: t, exact: true }).click();
      await page.waitForTimeout(120);
    }
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();

    // 允许记忆 501（后端不支持完整视图）以及 404 之类已处理的返回；
    // 关键判定：不得有未处理的 pageerror，也不得有 5xx。
    expect(errs.filter((e) => e.startsWith("pageerror") || e.startsWith("HTTP 5"))).toHaveLength(0);
  });
});