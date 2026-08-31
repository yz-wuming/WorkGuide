import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ChatMessage } from "../lib/api";
import Markdown from "./Markdown";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconGitBranch,
  IconGlobe,
  IconPenTool,
  IconRefresh,
  IconSearch,
  IconTerminal,
  IconWrench,
} from "./icons";

/** 按工具名映射 Lucide 图标：`Run Python / Shell` → 终端，`Read/Write File` → 文件，Git、Web 各归其类 */
function ToolGlyph({ name }: { name: string }) {
  const n = name.toLowerCase();
  const size = 13;
  if (/(run|python|exec|shell|bash|terminal|python|command)/.test(n)) {
    return <IconTerminal size={size} aria-hidden />;
  }
  if (/(read|write|sed|edit|patch|file|open|create)/.test(n)) {
    return <IconFileText size={size} aria-hidden />;
  }
  if (/git|branch|diff|merge|push|pull|commit/.test(n)) {
    return <IconGitBranch size={size} aria-hidden />;
  }
  if (/search|grep|find|locate|lint|scan/.test(n)) {
    return <IconSearch size={13} aria-hidden />;
  }
  if (/web|http|fetch|request|url|browser/.test(n)) {
    return <IconGlobe size={13} aria-hidden />;
  }
  if (/write|answer|respond|compose/.test(n)) {
    return <IconPenTool size={13} aria-hidden />;
  }
  return <IconWrench size={13} aria-hidden />;
}

/**
 * Agent Conversation Workspace。
 * - 用户消息：右侧浅底气泡（bg-primary-soft，圆角、低阴影），与左侧 Agent 明显区分
 * - Agent 消息：左侧干净正文区（.prose-md），无独立填充容器，Markdown 完整渲染
 * - Agent 执行过程以克制的时间线（Activity/Timeline）呈现，工具调用默认折叠
 * - 空状态：时间问候 + 建议任务快速入口，围绕 Task Composer
 */

export const QUICK_TASKS = [
  "梳理这个项目的代码结构",
  "为这段代码补充注释与说明",
  "总结一段文本的要点",
  "检查代码并指出可以改进的地方",
];

export function MessageList({
  messages,
  streaming,
  phase,
  activeTool,
  onQuickTask,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  phase: "thinking" | "tool" | "composing" | null;
  activeTool: string | null;
  onQuickTask?: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !streaming) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const lastIsEmptyAgent =
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "assistant" &&
    messages[messages.length - 1]?.content === "" &&
    messages[messages.length - 1]?.tools.length === 0;

  // 单一 thinking 指示：只由 AgentRow 的 isLive 分支渲染，杜绝两处同时出现
  void lastIsEmptyAgent;

  return (
    <div ref={ref} className="scroll-slim min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[980px] flex-col px-6 pb-4 pt-8 lg:px-6">
        {messages.length === 0 && !streaming ? (
          <EmptyState onQuickTask={onQuickTask} />
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <CopyableMessage
                  key={m.id || i}
                  text={m.content}
                  className="anim-msg-in group relative flex justify-end"
                >
                  <div className="max-w-[min(760px,82%)] whitespace-pre-wrap break-words rounded-[16px] bg-[#F0F2F5] px-[16px] py-[12px] text-left text-[16px] leading-[1.7] text-[#17191C]">
                    {m.content}
                  </div>
                </CopyableMessage>
              ) : (
                <AgentRow
                  key={m.id || i}
                  msg={m}
                  isLive={streaming && i === messages.length - 1}
                  phase={phase}
                  activeTool={activeTool}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 把一段文本写入剪贴板；优先 Clipboard API，失败则兜底 execCommand。 */
function writeClipboard(value: string): Promise<void> {
  try {
    return navigator.clipboard.writeText(value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }
}

/**
 * 可复制消息容器（用户消息与 Agent 回复共用）：
 * - 支持键盘快捷键：聚焦该消息后按 [Ctrl/Cmd]+C 复制整条；若已框选文本则交给浏览器复制选区
 * - hover 显示“复制”按钮，点击复制全文并短暂提示“已复制”
 * - 焦点高亮仅在键盘导航时出现（避免鼠标点击带来的虚线框）
 */
function CopyableMessage({
  text,
  className = "",
  children,
}: {
  text: string;
  className?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const flash = () => {
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const onCopy = async () => {
    if (!text) return;
    await writeClipboard(text);
    flash();
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!(e.metaKey || e.ctrlKey) || !/^c$/i.test(e.key)) return;
    // 已有文本选区时让浏览器复制选区；否则复制整条消息
    if (window.getSelection()?.toString()) return;
    e.preventDefault();
    onCopy();
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="copyable-msg"
      className={`focus-visible:ring-1 focus-visible:ring-line rounded ${className}`}
    >
      {children}
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "消息已复制" : "复制消息"}
        disabled={!text}
        className="absolute -top-3 right-1 grid place-items-center rounded bg-surface p-1 text-muted opacity-0 ring-1 ring-line transition group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 disabled:hidden"
        data-testid="copy-msg"
      >
        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      </button>
    </div>
  );
}

function EmptyState({ onQuickTask }: { onQuickTask?: (text: string) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="anim-fade flex flex-col items-center text-center">
        <p className="text-[38px] font-bold leading-[1.2] tracking-[-0.6px] text-[#17191C]">
          今天想完成什么？
        </p>
        <p className="mt-[12px] text-[16px] leading-6 text-[#6B7280]">
          描述任务，WorkGuide 会帮你完成。
        </p>
      </div>

      {onQuickTask && (
        <div className="anim-fade mt-8 flex flex-wrap items-center justify-center gap-8">
          {QUICK_TASKS.map((t) => (
            <button
              key={t}
              onClick={() => onQuickTask(t)}
              className="text-[15px] text-[#6D747D] transition hover:text-[#20242A]"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Agent 执行：时间线 + 可折叠工具调用 ---------------- */

function AgentRow({
  msg,
  isLive,
  phase,
  activeTool,
}: {
  msg: ChatMessage;
  isLive: boolean;
  phase: "thinking" | "tool" | "composing" | null;
  activeTool: string | null;
}) {
  return (
    <CopyableMessage text={msg.content} className="anim-msg-in group relative min-w-0">
      <ToolTimeline
        msg={msg}
        isLive={isLive}
        phase={phase}
        activeTool={activeTool}
      />
      {msg.content ? (
        <div className="prose-md max-w-[760px]">
          <Markdown content={msg.content} />
        </div>
      ) : isLive && !msg.tools.length ? (
        <AgentPhase phase={phase} activeTool={activeTool} />
      ) : null}
    </CopyableMessage>
  );
}

/** Agent 执行状态条：默认折叠，展示运行/工具摘要 */
function ToolTimeline({
  msg,
  isLive,
  phase,
  activeTool,
}: {
  msg: ChatMessage;
  isLive: boolean;
  phase: "thinking" | "tool" | "composing" | null;
  activeTool: string | null;
}) {
  const [open, setOpen] = useState(false);
  const tools = msg.tools;
  const running = isLive && phase === "tool";
  const runningName =
    activeTool ?? tools.find((t) => t.state === "running")?.name;
  const runningCount = tools.filter((t) => t.state === "running").length;
  const done = tools.filter((t) => t.state === "success").length;
  const failed = tools.filter((t) => t.state === "error").length;
  const total = tools.length;

  const hasLive = running || runningCount > 0;
  if (!total && !hasLive) return null;

  const summary = hasLive && runningName
    ? `正在运行 ${runningName}…`
    : `${total} 个工具 · 完成 ${done}${failed ? ` · 失败 ${failed}` : ""}`;

  const glyphName = runningName ?? (tools[0]?.name || "");
  const glyphTone = hasLive
    ? "text-ink-2"
    : failed
      ? "text-error-text"
      : "text-ink-2";

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-line/80 bg-canvas/60">
      <button
        type="button"
        onClick={() => total > 0 && setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-ink-2 ${
          total > 0 ? "hover:bg-surface-2" : "cursor-default"
        }`}
      >
        {total === 0 ? (
          <IconRefresh size={13} className="shrink-0 animate-spin text-ink-2" />
        ) : open ? (
          <IconChevronDown size={13} className="shrink-0 text-muted" />
        ) : (
          <IconChevronRight size={13} className="shrink-0 text-muted" />
        )}
        <span className={`shrink-0 ${glyphTone}`}>
          <ToolGlyph name={glyphName} />
        </span>
        <span className="truncate">{summary}</span>
        {total > 0 && (
          <span className="ml-auto shrink-0 text-[11px] text-muted">
            {open ? "收起" : "展开"}
          </span>
        )}
      </button>

      {open && total > 0 && (
        <div className="anim-fade px-3 pb-2">
          <div className="ml-[5px] border-l border-line pl-3">
            {tools.map((t, i) => (
              <div className="flex items-start gap-2 py-1" key={t.id || i}>
                <span
                  className={`mt-px shrink-0 ${
                    t.state === "running"
                      ? "text-ink-2"
                      : t.state === "error"
                        ? "text-error-text"
                        : "text-muted"
                  }`}
                >
                  <ToolGlyph name={t.name} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-ink-2">
                    {t.name}
                  </div>
                  <div className="text-[11px] text-muted">
                    {t.state === "running"
                      ? "运行中…"
                      : t.state === "success"
                        ? "完成"
                        : "失败"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentPhase({
  phase,
}: {
  phase: "thinking" | "tool" | "composing" | null;
  activeTool: string | null;
}) {
  const text =
    phase === "thinking"
      ? "正在思考…"
      : phase === "composing"
        ? "正在整理回复…"
        : null;
  // 全局唯一「正在思考…」：thinking/composing 才在此渲染；tool 状态仅由 ToolTimeline 显示，避免双指示
  if (!text) return null;
  return (
    <div className="anim-msg-in flex items-center gap-2 pb-2 text-[13px] font-normal text-[#8A9199]" data-testid="thinking-indicator">
      <IconRefresh size={14} className="spin-soft shrink-0" aria-hidden />
      <span>{text}</span>
    </div>
  );
}