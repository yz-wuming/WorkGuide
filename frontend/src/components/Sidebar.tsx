import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import type { ThreadSummary } from "../lib/api";
import {
  IconClose,
  IconGear,
  IconMoreHorizontal,
  IconPen,
  IconPlus,
  IconSearch,
  IconTrash,
} from "./icons";

/**
 * Sidebar —— 264px 桌面 Agent 工作台导航（向参考图密度靠拢）。
 * 极浅中性灰 #F7F8FA 底，右侧仅 1px #E6E8EB 分割线；
 * 顶部 64px 品牌区：Logo 标记 + WorkGuide + 搜索（可过滤会话）；
 * 新对话按钮 42px/10px 圆角，transparent 底，
 * 最近会话列表 56px 高/8px 圆角/无边框无卡片，
 * 底部设置 52px 固定在最低端，
 * 整体保持克制、低视觉噪声、石墨灰中性色系统。
 */
export default function Sidebar({
  threads,
  currentId,
  streamingIds,
  loading,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onOpenSettings,
  open,
  onClose,
}: {
  threads: ThreadSummary[];
  currentId: string | null;
  /** 后台仍在生成中的会话 id，用于列表展示“生成中”标识 */
  streamingIds?: string[];
  loading: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  open: boolean;
  onClose: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const visible = kw
    ? threads.filter((t) => (t.title || "").toLowerCase().includes(kw))
    : threads;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 anim-fade md:hidden"
          onClick={onClose}
          aria-label="关闭侧边栏"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] shrink-0 flex-col border-r border-[#E6E8EB] bg-[#F7F8FA] transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand —— 64px high: Logo 标记 + 名称 + 搜索 */}
        <div className="flex h-16 shrink-0 items-center gap-2.5 pl-5 pr-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#ECEEF1] text-[16px] font-semibold text-[#17191C]">
            W
          </span>
          <span className="truncate text-[18px] font-semibold leading-6 text-[#17191C]">
            WorkGuide
          </span>
          <button
            type="button"
            title="搜索会话"
            aria-label="搜索会话"
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQ("");
            }}
            className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#8A9199] transition hover:bg-[#EEF0F2] hover:text-[#17191C]"
          >
            {searchOpen ? <IconClose size={16} /> : <IconSearch size={16} />}
          </button>
        </div>

        {/* 展开的搜索框 */}
        {searchOpen && (
          <div className="px-4 pb-2">
            <div className="flex h-9 items-center gap-2 rounded-[9px] bg-[#EEF0F2] px-2.5 transition focus-within:ring-2 focus-within:ring-[rgba(120,130,145,0.15)]">
              <IconSearch size={14} className="shrink-0 text-[#8A9199]" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索最近会话..."
                aria-label="搜索最近会话"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-[#30343A] outline-none placeholder:text-[#9AA0A8]"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-[#9AA0A8] hover:bg-white/70 hover:text-[#30343A]"
                  aria-label="清空搜索"
                >
                  <IconClose size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* New Conversation —— 42px/10px 圆角, transparent */}
        <div className="mx-4 mb-4 mt-1">
          <button
            onClick={() => {
              onNew();
              onClose();
            }}
            disabled={loading}
            className="flex h-[44px] w-full items-center gap-2 rounded-[10px] bg-transparent px-3 text-[15px] font-medium text-[#30343A] transition hover:bg-[#ECEEF1] disabled:opacity-60"
          >
            <IconPlus size={17} className="shrink-0 text-[#30343A]" />
            <span>新对话</span>
          </button>
        </div>

        {/* Recent conversations —— closely spaced */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 ml-4 text-[13px] font-medium text-[#8A9098]">
            {searchOpen ? "搜索结果" : "最近"}
          </div>

          <nav className="scroll-slim min-h-0 flex-1 overflow-y-auto pb-2 ml-2 w-[calc(100%-8px)]">
            {visible.length === 0 && !loading && (
              <p className="px-2 py-8 text-center text-[13px] text-[#9AA0A8]">
                {searchOpen ? "没有匹配的会话" : "暂无对话历史"}
              </p>
            )}
            {searchOpen
              ? visible.map((t) => (
                  <ThreadRow
                    key={t.thread_id}
                    thread={t}
                    active={t.thread_id === currentId}
                    streaming={!!streamingIds?.includes(t.thread_id)}
                    onSelect={onSelect}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                ))
              : groupThreads(visible).map((g) => (
                  <div className="mb-1" key={g.label}>
                    {g.items.length > 0 && (
                      <div className="mb-0.5 px-2 pt-1.5 pb-0.5 text-[12px] font-medium text-[#9AA0A8]">
                        {g.label}
                      </div>
                    )}
                    {g.items.map((t) => (
                      <ThreadRow
                        key={t.thread_id}
                        thread={t}
                        active={t.thread_id === currentId}
                        streaming={!!streamingIds?.includes(t.thread_id)}
                        onSelect={onSelect}
                        onRename={onRename}
                        onDelete={onDelete}
                      />
                    ))}
                  </div>
                ))}
          </nav>
        </div>

        {/* Footer —— 设置，固定在底部，52px */}
        <div className="mt-auto shrink-0 border-t border-[#E6E8EB]">
          <button
            onClick={onOpenSettings}
            className="flex h-[52px] w-full items-center gap-2.5 px-4 text-[15px] text-[#555B63] transition hover:bg-[#EEF0F2] hover:text-[#17191C]"
          >
            <IconGear size={17} className="shrink-0" />
            <span>设置</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const p = (n: number) => String(n).padStart(2, "0");
  if (sameDay) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  if (sameYear) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 把会话按「今天 / 昨天 / 更早」分组，保持该顺序 */
function groupThreads(list: ThreadSummary[]): { label: string; items: ThreadSummary[] }[] {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = dayStart - 86400000;
  const memo: { 今天: ThreadSummary[]; 昨天: ThreadSummary[]; 更早: ThreadSummary[] } = {
    今天: [],
    昨天: [],
    更早: [],
  };
  for (const t of list) {
    const ts = new Date(t.updated_at || t.created_at).getTime();
    const bucket = Number.isNaN(ts)
      ? "更早"
      : ts >= dayStart
        ? "今天"
        : ts >= yesterdayStart
          ? "昨天"
          : "更早";
    memo[bucket].push(t);
  }
  return [
    { label: "今天", items: memo["今天"] },
    { label: "昨天", items: memo["昨天"] },
    { label: "更早", items: memo["更早"] },
  ];
}

function ThreadRow({
  thread,
  active,
  streaming,
  onSelect,
  onRename,
  onDelete,
}: {
  thread: ThreadSummary;
  active: boolean;
  streaming: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const title = thread.title || "新对话";

  // 关闭菜单：点击外部 / 滚动 / Esc。
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenu({ x: window.innerWidth - r.right + 8, y: r.bottom + 6 });
  };

  if (editing) {
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const v = draft.trim();
      if (v) onRename(thread.thread_id, v);
      setEditing(false);
    };
    return (
      <form
        onSubmit={submit}
        className="flex items-center gap-1 rounded-md px-1.5 py-1"
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-[14px] text-ink outline-none"
        />
      </form>
    );
  }

  return (
    <div
      onClick={() => onSelect(thread.thread_id)}
      className={`group flex h-14 cursor-pointer items-center rounded-[8px] px-3 py-2 transition ${
        active ? "bg-[#E5E7EA]" : "bg-transparent hover:bg-[#EEF0F2]"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-normal leading-5 text-[#34383D]">
            {title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#9AA0A8]">
          {streaming && (
            <span className="inline-flex items-center gap-1 text-[#5B7CFA]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#5B7CFA] anim-pulse" aria-hidden />
              生成中
            </span>
          )}
          {formatTime(thread.updated_at || thread.created_at)}
        </div>
      </div>

      {/* Hover 才出现的 ⋯ 菜单入口 */}
      <button
        ref={btnRef}
        title="更多操作"
        aria-label="更多操作"
        onClick={openMenu}
        className={`hidden h-6 w-6 shrink-0 place-items-center rounded-md text-[#9AA0A8] transition group-hover:grid hover:bg-surface-3 hover:text-ink ${
          menu ? "grid bg-surface-3 text-ink" : ""
        }`}
      >
        <IconMoreHorizontal size={14} />
      </button>

      {menu &&
        createPortal(
        <div
          className="fixed z-50 anim-fade"
          style={{ top: menu.y, right: menu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-md">
            <button
              onClick={() => {
                setDraft(title);
                setMenu(null);
                setEditing(true);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-ink-2 transition hover:bg-surface-2 hover:text-ink"
            >
              <IconPen size={14} />
              重命名
            </button>
            <button
              onClick={() => {
                setMenu(null);
                setConfirming(true);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] text-error transition hover:bg-error-soft"
            >
              <IconTrash size={14} />
              删除
            </button>
          </div>
        </div>
      , document.body)}

      {confirming && (
        <DeleteConfirmDialog
          title={title}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete(thread.thread_id);
          }}
        />
      )}
    </div>
  );
}

/** 删除确认模态框 —— 居中、遮罩全屏覆盖、ESC/点遮罩/取消关闭 */
function DeleteConfirmDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-4 anim-fade"
      onClick={onCancel}
    >
      <div
        className="w-[min(340px,92vw)] rounded-xl border border-line bg-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="删除对话"
      >
        <p className="text-[14px] font-medium text-ink">删除对话？</p>
        <p className="mt-1.5 truncate text-[13px] text-ink-2">「{title}」</p>
        <p className="mt-0.5 text-[12px] text-muted">删除后无法恢复。</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-error px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-[#a04848]"
          >
            删除
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}