import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../lib/api";
import { modelLabel } from "../lib/api";
import { IconCheck, IconChevronDown } from "./icons";

/**
 * 自定义模型选择 Dropdown（非浏览器原生 select）。
 * 中性配色：浅灰 hover、细浅灰边框、弱阴影；当前模型 ✓。
 */
export default function ModelDropdown({
  models,
  value,
  onSelect,
}: {
  models: ModelInfo[];
  value: string | null;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const current = models.find((m) => m.name === value) ?? models[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const idx = models.findIndex((m) => m.name === value);
      setActive(idx >= 0 ? idx : 0);
    }
  }, [open, models, value]);

  const choose = (m: ModelInfo) => {
    onSelect(m.name);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, models.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = models[active];
      if (m) choose(m);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-[7px] px-2 text-[15px] transition ${
          open ? "text-[#17191C]" : "text-[#363B41] hover:text-[#17191C]"
        }`}
      >
        <span className="font-medium text-[#363B41]">{current ? modelLabel(current) : "—"}</span>
        <IconChevronDown
          size={15}
          className={`text-[#8A9199] transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="scroll-slim absolute bottom-full left-0 z-50 mb-1.5 max-h-72 w-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-md anim-fade"
        >
          <div className="px-3 py-1.5 text-[12px] font-medium text-muted">选择模型</div>
          {models.length === 0 && (
            <div className="px-3 py-2.5 text-[13px] text-muted">暂无可用模型</div>
          )}
          {models.map((m, i) => {
            const sel = m.name === value;
            return (
              <button
                key={m.name}
                type="button"
                role="option"
                aria-selected={sel}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(m)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[14px] transition ${
                  i === active ? "bg-surface-2" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className={sel ? "font-medium text-ink" : "text-ink-2"}>
                    {modelLabel(m)}
                  </span>
                  {m.source === "runtime" && (
                    <span className="ml-1.5 text-[11px] text-muted">运行时</span>
                  )}
                  {m.model && m.model !== m.name && (
                    <span className="block truncate text-[12px] text-muted">{m.model}</span>
                  )}
                </span>
                {sel && <IconCheck size={14} className="text-primary-deep" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}