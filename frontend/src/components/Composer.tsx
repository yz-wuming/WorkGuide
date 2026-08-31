import { useRef, useState } from "react";
import type { ModelInfo, UploadedFile } from "../lib/api";
import ModelDropdown from "./ModelDropdown";
import { IconPaperclip, IconSend } from "./icons";

/**
 * Agent Task Composer —— 整页最核心输入区（.composer）。
 * - 宽 ≤760px（min(760px, calc(100%-48px))），18px 圆角，二级边框 + 柔和多层悬浮阴影
 * - 默认高 112px，可增长至 240px；输入文字 16px 居中大字
 * - 底部工具栏：左侧 附件 + 模型选择，右侧 38×38 圆形发送钮（石墨深色）
 * - Enter 发送 / Shift+Enter 换行 / disabled / loading 完整
 */
export default function Composer({
  streaming,
  uploading,
  disabled,
  models,
  selectedModel,
  onModel,
  onSend,
  onAttach,
  uploaded,
  onRemoveUploaded,
}: {
  streaming: boolean;
  uploading: boolean;
  disabled?: boolean;
  models: ModelInfo[];
  selectedModel: string | null;
  onModel: (name: string) => void;
  onSend: (text: string) => void;
  onAttach?: (files: File[]) => void;
  uploaded?: UploadedFile[];
  onRemoveUploaded?: (name: string) => void;
}) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const trimmed = text.trim();
  const canSend = !streaming && !disabled && trimmed.length > 0;

  const MIN_H = 112;
  const MAX_H = 240;

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(Math.max(ta.scrollHeight, MIN_H), MAX_H)}px`;
  };

  const send = () => {
    if (!canSend) return;
    const t = trimmed;
    setText("");
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.style.height = `${MIN_H}px`;
    }
    onSend(t);
  };

  return (
    <div className="mx-auto w-[min(760px,calc(100%-48px))]">
      <div className="composer relative flex min-h-[112px] flex-col">
      {/* 输入区 */}
      <textarea
        ref={taRef}
        value={text}
        rows={1}
        onChange={(e) => {
          setText(e.target.value);
          autoGrow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="输入任务..."
        disabled={disabled}
        className="block min-h-[112px] max-h-[240px] w-full resize-none overflow-y-auto bg-transparent px-[20px] pb-[52px] pt-[18px] text-[16px] leading-7 text-[#17191C] outline-none placeholder:text-[#9AA1A9]"
        aria-label="任务输入"
      />

        {/* 已上传文件（持久状态） */}
        {uploaded && uploaded.length > 0 && (
          <div className="absolute bottom-[56px] left-[18px] right-[18px] flex flex-wrap items-center gap-2">
            {uploaded.map((f) => (
              <span
                key={f.filename}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[#F0F2F5] px-2 py-1 text-[13px] text-[#17191C] ring-1 ring-black/5"
                data-testid="upload-chip"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4F8A68]" aria-hidden />
                <span className="max-w-[260px] truncate" title={f.filename}>
                  {f.filename}
                </span>
                {onRemoveUploaded && (
                  <button
                    type="button"
                    aria-label={`移除 ${f.filename}`}
                    onClick={() => onRemoveUploaded(f.filename)}
                    className="shrink-0 pl-0.5 text-[#9CA3AF] transition hover:text-[#111827]"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* 底部工具栏：36px 高，padding 0 12px 10px 12px */}
        <div className="absolute inset-x-0 bottom-0 flex h-9 items-center justify-between px-3 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {onAttach && (
              <>
                <button
                  type="button"
                  title="添加文件"
                  aria-label="添加文件"
                  disabled={streaming || uploading || disabled}
                  onClick={() => fileRef.current?.click()}
                  className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] text-[#7B828A] transition hover:bg-[#F1F2F4] hover:text-[#20242A] disabled:opacity-40"
                >
                  <IconPaperclip size={18} />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) onAttach(files);
                    e.target.value = "";
                  }}
                />
              </>
            )}
            <ModelDropdown models={models} value={selectedModel} onSelect={onModel} />
            {uploading && (
              <span className="text-[13px] text-[#4F8A68]" aria-live="polite">
                上传中…
              </span>
            )}
          </div>

          {/* 圆形发送钮：34×34 / 圆，空态浅灰、可发时石墨深色 */}
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="发送"
            data-testid="send-arrow"
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full transition duration-150 ease-out
              disabled:cursor-not-allowed disabled:bg-[#F0F2F4] disabled:text-[#A0A6AD]
              enabled:bg-[#30343A] enabled:text-white enabled:hover:bg-[#20242A] enabled:active:bg-[#17191C]"
          >
            <IconSend size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}