import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, ModelInfo, ThreadSummary, ToolEvent, UploadedFile } from "./api";
import {
  createModel as apiCreateModel,
  createThread,
  deleteModel as apiDeleteModel,
  deleteThread as apiDeleteThread,
  loadMessages,
  loadModels,
  modelLabel,
  renameThread as apiRenameThread,
  searchThreads,
  streamRun,
  updateModel as apiUpdateModel,
  uploadFiles,
} from "./api";
import type { ModelFormData } from "./modelsStore";

const TITLE_KEY = "workguide_thread_titles";

interface TitleCache {
  [id: string]: string;
}
function readTitles(): TitleCache {
  try {
    return JSON.parse(localStorage.getItem(TITLE_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeTitles(cache: TitleCache) {
  localStorage.setItem(TITLE_KEY, JSON.stringify(cache));
}

/**
 * 每个会话各自的流式中间态。切换/新建会话时不再中止旧会话，
 * 让它在后台继续生成，切回时消息完整、不会出现“空内容卡住”。
 */
interface LiveThread {
  messages: ChatMessage[];
  streaming: boolean;
  agentPhase: ChatState["agentPhase"];
  activeTool: string | null;
  controller: AbortController | null;
}

export interface ChatState {
  threads: ThreadSummary[];
  currentId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  /** 后台仍在生成中的会话 id（用于会话列表展示”生成中”标识） */
  streamingIds: string[];
  error: string | null;
  models: ModelInfo[];
  selectedModel: string | null;
  modelLabel: string;
  agentPhase: "thinking" | "tool" | "composing" | null;
  activeTool: string | null;
  loading: boolean;
  uploading: boolean;
  ready: boolean;
  /** 后端 Gateway 是否真实可达（models / threads 任一请求成功） */
  connected: boolean;
  // 模型管理（直接写入后端 models.runtime.yaml，保存后立即生效）
  refreshModels: () => Promise<void>;
  addModel: (m: ModelFormData) => Promise<void>;
  updateModel: (oldName: string, m: ModelFormData) => Promise<void>;
  removeModel: (name: string) => Promise<void>;
  // actions
  refreshThreads: () => Promise<void>;
  newChat: () => Promise<void>;
  selectThread: (id: string) => Promise<void>;
  renameThread: (id: string, title: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  send: (text: string, files?: UploadedFile[]) => Promise<void>;
  stop: () => void;
  attachFiles: (files: File[]) => Promise<UploadedFile[]>;
  setModel: (name: string) => void;
}

const none: [] = [];

export function useChat(onBackgroundComplete?: (id: string) => void): ChatState {
  const [threads, setThreads] = useState<ThreadSummary[]>(none);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(none);
  const [streaming, setStreaming] = useState(false);
  const [streamingIds, setStreamingIds] = useState<string[]>(none);
  const [error, setError] = useState<string | null>(null);
  const [backendModels, setBackendModels] = useState<ModelInfo[]>(none);
  const models = backendModels;
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<ChatState["agentPhase"]>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [connected, setConnected] = useState(false);

  // 所有会话的流式状态（含后台仍在生成的会话）
  const liveRef = useRef(new Map<string, LiveThread>());
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;
  const messagesRef = useRef<ChatMessage[]>(none);
  messagesRef.current = messages;
  const streamingRef = useRef(false);
  streamingRef.current = streaming;
  const phaseRef = useRef<ChatState["agentPhase"]>(null);
  phaseRef.current = agentPhase;
  const toolRef = useRef<string | null>(null);
  toolRef.current = activeTool;
  const bgCompleteRef = useRef(onBackgroundComplete);
  bgCompleteRef.current = onBackgroundComplete;

  const ensureLive = useCallback((id: string): LiveThread => {
    let e = liveRef.current.get(id);
    if (!e) {
      e = { messages: [], streaming: false, agentPhase: null, activeTool: null, controller: null };
      liveRef.current.set(id, e);
    }
    return e;
  }, []);

  const recomputeStreaming = useCallback(() => {
    const arr: string[] = [];
    for (const [tid, e] of liveRef.current) if (e.streaming) arr.push(tid);
    setStreamingIds(arr);
  }, []);

  const stashCurrent = useCallback(() => {
    const id = currentIdRef.current;
    if (!id) return;
    const e = ensureLive(id);
    e.messages = messagesRef.current;
    e.streaming = streamingRef.current;
    e.agentPhase = phaseRef.current ?? null;
    e.activeTool = toolRef.current ?? null;
  }, [ensureLive]);

  /** 修改某会话的流式状态；若它是当前会话则同步到渲染态，并在 streaming 翻转时刷新列表“生成中”标识 */
  const applyLive = useCallback(
    (id: string, fn: (live: LiveThread) => void) => {
      const live = ensureLive(id);
      const wasStreaming = live.streaming;
      fn(live);
      if (live.streaming !== wasStreaming) recomputeStreaming();
      if (id === currentIdRef.current) {
        setMessages(live.messages);
        setStreaming(live.streaming);
        setAgentPhase(live.agentPhase);
        setActiveTool(live.activeTool);
      }
    },
    [ensureLive, recomputeStreaming],
  );

  /** 立即切换当前会话（同步更新 ref，避免异步回调读到旧 id） */
  const switchTo = useCallback((id: string | null) => {
    currentIdRef.current = id;
    setCurrentId(id);
  }, []);

  const refreshThreads = useCallback(async () => {
    try {
      const list = await searchThreads(50);
      // 服务器列表中标题为空时，用本地缓存标题补齐——避免“刚发首条消息
      // 就切走”时后端重命名尚未落库，刷新反而把标题冲成“新对话”的竞态。
      const cache = readTitles();
      setThreads(
        list.map((t) =>
          !t.title && cache[t.thread_id] ? { ...t, title: cache[t.thread_id] } : t,
        ),
      );
      setConnected(true);
    } catch {
      /* 列表失败不致命,保留旧列表 */
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const ms = await loadModels();
      setBackendModels(ms);
      setSelectedModel((cur) => {
        if (cur && ms.some((m) => m.name === cur)) return cur;
        return ms[0]?.name ?? null;
      });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
    void refreshThreads();
  }, [refreshModels, refreshThreads]);

  const threadTitle = useCallback(
    (id: string, messagesNow: ChatMessage[]): string | null => {
      const existing = threads.find((t) => t.thread_id === id);
      if (existing?.title) return existing.title;
      const cached = readTitles()[id];
      if (cached) return cached;
      const firstUser = messagesNow.find((m) => m.role === "user");
      return firstUser ? firstUser.content.slice(0, 60) : null;
    },
    [threads],
  );

  const persistTitle = useCallback(
    async (id: string, title: string) => {
      const cache = readTitles();
      if (cache[id] !== title) {
        cache[id] = title;
        writeTitles(cache);
      }
      setThreads((prev) => prev.map((t) => (t.thread_id === id ? { ...t, title } : t)));
      try {
        await apiRenameThread(id, title);
      } catch {
        /* title 已本地保存,远端失败不阻塞 */
      }
    },
    [],
  );

  const loadThread = useCallback(
    async (id: string): Promise<ChatMessage[]> => {
      const ms = await loadMessages(id);
      const title = threadTitle(id, ms);
      if (title && !threads.find((t) => t.thread_id === id)?.title) {
        const cache = readTitles();
        if (!cache[id]) {
          cache[id] = title;
          writeTitles(cache);
        }
      }
      return ms;
    },
    [threads, threadTitle],
  );

  const selectThread = useCallback(
    async (id: string) => {
      if (id === currentIdRef.current) return;
      stashCurrent();
      switchTo(id);
      setError(null);
      const live = ensureLive(id);
      // 该会话仍在后台生成或缓冲里已有消息时，直接用缓冲（含后台新增内容），不再请求服务器
      if (live.messages.length > 0) {
        applyLive(id, () => {});
        return;
      }
      setLoading(true);
      try {
        const ms = await loadThread(id);
        // 确保 assistant 每条都有唯一 id
        let ai = 0;
        let ui = 0;
        const norm = ms.map((m) =>
          m.role === "assistant" ? { ...m, id: m.id || `ai-${ai++}` } : { ...m, id: m.id || `u-${ui++}` },
        );
        applyLive(id, (l) => {
          l.messages = norm;
          l.streaming = false;
          l.agentPhase = null;
          l.activeTool = null;
        });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [stashCurrent, switchTo, ensureLive, applyLive, loadThread],
  );

  const newChat = useCallback(async () => {
    setLoading(true);
    try {
      stashCurrent();
      const id = await createThread();
      switchTo(id);
      applyLive(id, (l) => {
        l.messages = none;
        l.streaming = false;
        l.agentPhase = null;
        l.activeTool = null;
        l.controller = null;
      });
      setError(null);
      await refreshThreads();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [stashCurrent, switchTo, ensureLive, applyLive, refreshThreads]);

  const renameThread = useCallback(
    async (id: string, title: string) => {
      if (!id || !title.trim()) return;
      await persistTitle(id, title.trim());
    },
    [persistTitle],
  );

  const deleteThread = useCallback(async (id: string) => {
    if (!id) return;
    const wasCurrent = id === currentIdRef.current;
    // 删除前先中止该会话自身的运行（否则后端返回 409 work in flight）
    const entry = liveRef.current.get(id);
    entry?.controller?.abort();
    try {
      // 线程仍有运行进行中时后端返回 409。中止后短暂重试等待运行真正结束、
      // 释放线程写锁后再删除，避免删除失败。
      let delay = 400;
      for (let attempt = 0; ; attempt++) {
        try {
          await apiDeleteThread(id);
          break;
        } catch (e) {
          const inFlight = (e as Error)?.message?.includes("409");
          if (inFlight && attempt < 10) {
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 1600);
            continue;
          }
          throw e;
        }
      }
      liveRef.current.delete(id);
      recomputeStreaming();
      setThreads((prev) => prev.filter((t) => t.thread_id !== id));
      const cache = readTitles();
      delete cache[id];
      writeTitles(cache);
      if (wasCurrent) {
        switchTo(null);
        setMessages(none);
        setStreaming(false);
        setError(null);
        setAgentPhase(null);
        setActiveTool(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [switchTo, recomputeStreaming]);

  const stop = useCallback(() => {
    const id = currentIdRef.current;
    if (!id) return;
    const live = ensureLive(id);
    live.controller?.abort();
    applyLive(id, (l) => {
      l.streaming = false;
      l.agentPhase = null;
      l.activeTool = null;
      l.controller = null;
      l.messages = l.messages.map((m) => (m.role === "assistant" && !m.done ? { ...m, done: true } : m));
    });
  }, [ensureLive, applyLive]);

  const send = useCallback(
    async (text: string, files?: UploadedFile[]) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      let id = currentIdRef.current;
      if (!id) {
        try {
          id = await createThread();
          switchTo(id);
          await refreshThreads();
        } catch (e) {
          setError((e as Error).message);
          return;
        }
      }
      const live = ensureLive(id);
      if (live.streaming) return;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        tools: [],
        done: true,
      };
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: "",
        tools: [],
        done: false,
      };
      const firstUser = !live.messages.find((m) => m.role === "user");
      if (firstUser) void persistTitle(id, trimmed.slice(0, 60));

      applyLive(id, (l) => {
        l.messages = [...l.messages.map((m) => ({ ...m, done: true })), userMsg, aiMsg];
        l.streaming = true;
        l.agentPhase = "thinking";
        l.activeTool = null;
      });
      live.controller = new AbortController();
      const signal = live.controller.signal;
      let aborted = false;

      try {
        await streamRun(
          id,
          trimmed,
          selectedModel,
          {
            onToken: (tok) =>
              applyLive(id, (l) => {
                l.agentPhase = "composing";
                const last = l.messages.length - 1;
                if (last >= 0) {
                  const prev = l.messages[last];
                  l.messages[last] = { ...prev, content: prev.content + tok };
                }
              }),
            onToolStart: (ev) =>
              applyLive(id, (l) => {
                l.activeTool = ev.name;
                l.agentPhase = "tool";
                const last = l.messages.length - 1;
                if (last >= 0) {
                  const prev = l.messages[last];
                  l.messages[last] = {
                    ...prev,
                    tools: patchTools(prev.tools, ev.id, ev.name, "running"),
                  };
                }
              }),
            onToolEnd: (ev) =>
              applyLive(id, (l) => {
                const last = l.messages.length - 1;
                if (last >= 0) {
                  const prev = l.messages[last];
                  l.messages[last] = {
                    ...prev,
                    tools: patchTools(prev.tools, ev.id, ev.name, ev.ok ? "success" : "error", ev.error),
                  };
                }
              }),
            onRuntimeModel: (name) => {
              setSelectedModel(name);
            },
          },
          signal,
          files,
        );
      } catch (e) {
        if ((e as Error).name === "AbortError") aborted = true;
        else if (id === currentIdRef.current) setError((e as Error).message);
      } finally {
        applyLive(id, (l) => {
          l.streaming = false;
          l.agentPhase = null;
          l.activeTool = null;
          l.controller = null;
          l.messages = l.messages.map((m) =>
            m.role === "assistant" ? { ...m, done: true } : m,
          );
        });
        // 后台会话（非当前）正常完成时通知上层，让用户知道旧对话并没有“停止回复”
        if (!aborted && id !== currentIdRef.current) bgCompleteRef.current?.(id);
      }
    },
    [selectedModel, persistTitle, refreshThreads, ensureLive, applyLive, switchTo],
  );

  const attachFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return [];
      // 无当前会话时先自动新建（与 send() 一致），确保上传总挂在真实线程上，
      // 否则文件没有归属线程会“假上传”。
      let id = currentIdRef.current;
      if (!id) {
        id = await createThread();
        switchTo(id);
        await refreshThreads();
      }
      setUploading(true);
      try {
        return await uploadFiles(id, files);
      } finally {
        setUploading(false);
      }
    },
    [switchTo, refreshThreads],
  );

  const setModel = useCallback((name: string) => setSelectedModel(name), []);

  /** 模型增删改：直接写入后端 models.runtime.yaml，保存后重新拉取并立即生效 */
  const addModel = useCallback(
    async (m: ModelFormData) => {
      await apiCreateModel({
        name: m.name,
        display_name: m.label || m.name,
        provider: m.provider,
        model: m.model,
        api_base: m.apiBase || undefined,
        api_key: m.apiKey || undefined,
      });
      await refreshModels();
      setSelectedModel(m.name);
    },
    [refreshModels],
  );

  const updateModel = useCallback(
    async (oldName: string, m: ModelFormData) => {
      await apiUpdateModel(oldName, {
        name: m.name,
        display_name: m.label || m.name,
        provider: m.provider,
        model: m.model,
        api_base: m.apiBase || undefined,
        api_key: m.apiKey || undefined,
      });
      await refreshModels();
      setSelectedModel((cur) => (cur === oldName ? m.name : cur));
    },
    [refreshModels],
  );

  const removeModel = useCallback(
    async (name: string) => {
      await apiDeleteModel(name);
      await refreshModels();
    },
    [refreshModels],
  );

  const label = models.find((m) => m.name === selectedModel);
  const modelDisplay = label ? modelLabel(label) : selectedModel ?? "当前模型";

  return {
    threads,
    currentId,
    messages,
    streaming,
    streamingIds,
    error,
    models,
    selectedModel,
    modelLabel: modelDisplay,
    refreshModels,
    addModel,
    updateModel,
    removeModel,
    agentPhase,
    activeTool,
    loading,
    uploading,
    ready: !!threads.length || !!currentId,
    connected,
    refreshThreads,
    newChat,
    selectThread,
    renameThread,
    deleteThread,
    send,
    stop,
    attachFiles,
    setModel,
  };
}

function patchTools(
  tools: ToolEvent[],
  id: string,
  name: string,
  state: ToolEvent["state"],
  error?: string,
): ToolEvent[] {
  const idx = tools.findIndex((t) => t.id === id && t.name === name);
  if (idx === -1) return [...tools, { id, name, state, error }];
  const copy = tools.slice();
  copy[idx] = { ...copy[idx], state, error };
  return copy;
}