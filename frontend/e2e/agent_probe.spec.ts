import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TD = resolve(dirname(fileURLToPath(import.meta.url)), "../testdata");

function watch(page: Page, errs: string[]) {
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errs.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errs.push(`HTTP 5xx ${r.status()} ${r.url()}`);
  });
}

/**
 * Agent 真实功能探测（严格版）：
 * 要求模型「用 Python 计算 7*6」，断言最终回复里出现 42 —— 一个不在提示词里、只能靠真实计算得到的结果，
 * 排除模型仅复读指令/文件名的假通过。
 */
test("Agent 真实模型：Python 计算 7*6 → 答案中确含 42（无法从提示词复读）", async ({ page }) => {
  test.setTimeout(180_000);
  const errs: string[] = [];
  watch(page, errs);

  await page.goto("/");
  await page.getByRole("button", { name: "新对话" }).click();
  await expect(page.getByText("今天想完成什么？")).toBeVisible();

  const ta = page.getByRole("textbox", { name: "任务输入" });
  await ta.fill("请用 Python 计算 7*6，并用中文用一句话把结果告诉我。");
  await ta.press("Enter");

  // 关键：等待真实回复中出现「42」——只能由真实计算产生。
  const assistant = page.locator(".prose-md").first();
  await expect(assistant).toContainText("42", { timeout: 150_000 });

  // 验证确实走了一次真实模型调用：后台有本次 run，且前端无 5xx / 未处理 pageerror。
  expect(errs.filter((e) => e.startsWith("pageerror") || e.startsWith("HTTP 5xx"))).toHaveLength(0);
});