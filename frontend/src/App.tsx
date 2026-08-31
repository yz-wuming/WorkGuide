import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "./lib/useChat";
import type { UploadedFile } from "./lib/api";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import { MessageList, QUICK_TASKS } from "./components/MessageList";
import Composer from "./components/Composer";
import SettingsDrawer from "./components/SettingsDrawer";
import { IconMenu } from "./components/icons";

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    tone?: "info" | "error";
    action?: { label: string; id: string };
  } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);

  const note = useCallback(
    (
      msg: string,
      tone: "info" | "error" = "info",
      opts?: { duration?: number; action?: { label: string; id: string } },
    ) => {
      setToast({ msg, tone, action: opts?.action });
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => setToast(null), opts?.duration ?? 2600);
    },
    [],
  );

  // 后台会话完成通知：旧对话其实在后台继续生成，完成时提示用户可跳转查看
  const chatRef = useRef<ReturnType<typeof useChat> | null>(null);
  const handleBackgroundComplete = useCallback(
    (id: string) => {
      const t = chatRef.current?.threads.find((x) => x.thread_id === id);
      const title = t?.title || "对话";
      note(`「${title}」已完成回复`, "info", {
        duration: 6000,
        action: { label: "查看", id },
      });
    },
    [note],
  );
  const chat = useChat(handleBackgroundComplete);
  chatRef.current = chat;

  // 切换会话后，上传指示清空（文件归属于旧线程）
  useEffect(() => {
    setUploaded([]);
  }, [chat.currentId]);

  const handleAttach = useCallback(
    async (files: File[]) => {
      const prevNames = files.map((f) => f.name);
      try {
        const names = await chat.attachFiles(files);
        if (names && names.length) {
          setUploaded((cur) =>
            Array.from(
              new Map([...cur, ...names].map((f) => [f.filename, f])).values(),
            ),
          );
          note(`已上传 ${names.length} 个文件`);
        } else {
          note(`未上传任何文件：${prevNames.join("、")}`, "error");
        }
      } catch (e) {
        note((e as Error).message, "error");
      }
    },
    [chat, note],
  );

  const handleRename = useCallback(
    (id: string, title: string) => {
      void chat.renameThread(id, title);
    },
    [chat],
  );

  return (
    <div className="flex h-screen overflow-hidden text-ink">
      <Sidebar
        threads={chat.threads}
        currentId={chat.currentId}
        streamingIds={chat.streamingIds}
        loading={chat.loading}
        onNew={() => void chat.newChat()}
        onSelect={(id) => void chat.selectThread(id)}
        onRename={handleRename}
        onDelete={(id) => void chat.deleteThread(id)}
        onOpenSettings={() => setSettingsOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="relative flex min-w-0 flex-1 flex-col bg-canvas">
        <Header
          selectedModel={chat.selectedModel}
          models={chat.models}
          connected={chat.connected}
        />

        {chat.error && (
          <div className="relative z-10 shrink-0 border-b border-line bg-error-soft px-6 py-2 text-[14px] text-error-text">
            <span className="mr-1" aria-hidden>
              !
            </span>
            {chat.error}
          </div>
        )}

        {chat.messages.length === 0 ? (
          /* ===== Home：垂直居中 + 大字 Welcome + 居中悬浮 Composer ===== */
          <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
            <div className="mx-auto flex w-[min(820px,calc(100%-64px))] flex-col items-center px-4 text-center">
              <h1 className="text-[38px] font-bold leading-[1.2] tracking-[-0.6px] text-[#17191C]">
                今天想完成什么？
              </h1>
              <p className="mt-[12px] text-[16px] font-normal leading-6 text-[#6B7280]">
                描述任务，WorkGuide 会帮你完成。
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-8">
                {QUICK_TASKS.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      if (!chat.currentId) void chat.newChat();
                      void chat.send(t);
                    }}
                    className="text-[15px] text-[#6D747D] transition hover:text-[#20242A]"
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="mt-[40px] w-full">
                <Composer
                  streaming={chat.streaming}
                  uploading={chat.uploading}
                  disabled={!chat.ready && !chat.currentId && !chat.models.length}
                  models={chat.models}
                  selectedModel={chat.selectedModel}
                  onModel={chat.setModel}
                  onSend={(t) => void chat.send(t, uploaded)}
                  onAttach={(f) => void handleAttach(f)}
                  uploaded={uploaded}
                  onRemoveUploaded={(name) =>
                    setUploaded((cur) => cur.filter((x) => x.filename !== name))
                  }
                />
              </div>
            </div>
          </div>
        ) : (
          /* ===== Chat：消息 + 底部输入 ===== */
          <>
            <MessageList
              messages={chat.messages}
              streaming={chat.streaming}
              phase={chat.agentPhase}
              activeTool={chat.activeTool}
              onQuickTask={(t) => {
                if (!chat.currentId) void chat.newChat();
                void chat.send(t);
              }}
            />
            <div className="relative z-10 shrink-0 px-6 pb-6 pt-2">
              <Composer
                streaming={chat.streaming}
                uploading={chat.uploading}
                disabled={!chat.ready && !chat.currentId && !chat.models.length}
                models={chat.models}
                selectedModel={chat.selectedModel}
                onModel={chat.setModel}
                onSend={(t) => void chat.send(t, uploaded)}
                onAttach={(f) => void handleAttach(f)}
                uploaded={uploaded}
                onRemoveUploaded={(name) =>
                  setUploaded((cur) => cur.filter((x) => x.filename !== name))
                }
              />
            </div>
          </>
        )}
      </div>

      <SettingsDrawer
        open={settingsOpen}
        models={chat.models}
        selectedModel={chat.selectedModel}
        onModel={chat.setModel}
        onAddModel={chat.addModel}
        onUpdateModel={chat.updateModel}
        onRemoveModel={chat.removeModel}
        onClose={() => setSettingsOpen(false)}
        onNote={note}
      />

      {/* Mobile menu trigger */}
      <button
        onClick={() => setSidebarOpen(true)}
        aria-label="打开侧边栏"
        className="fixed bottom-16 right-4 z-40 grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface text-ink-2 shadow-sm transition hover:text-ink md:hidden"
      >
        <IconMenu size={20} />
      </button>

      {toast && (
        <div
          className={`fixed left-1/2 top-14 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-1.5 text-[12.5px] shadow-lg anim-fade ${
            toast.tone === "error"
              ? "border-error/20 bg-error-soft text-error"
              : "border-line bg-surface-2 text-ink"
          }`}
        >
          <span className="truncate">{toast.msg}</span>
          {toast.action && (
            <button
              onClick={() => {
                void chat.selectThread(toast.action!.id);
                setToast(null);
              }}
              className="shrink-0 font-medium text-[#5B7CFA] transition hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
