import { streamSSE } from "./sse";

const API = "/api";

/* ============================== Types ============================== */

export interface ThreadSummary {
  thread_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  title?: string;
}

export interface ModelInfo {
  name: string;
  model: string;
  display_name: string | null;
  description: string | null;
  supports_thinking: boolean;
  supports_reasoning_effort?: boolean;
  /** 模型来源：config.yaml（只读）或运行时新增（可编辑/删除） */
  source?: "config" | "runtime";
  provider?: string | null;
  api_base?: string | null;
  has_api_key?: boolean;
}

export interface ToolEvent {
  id: string;
  name: string;
  state: "running" | "success" | "error";
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolEvent[];
  done: boolean;
}

export type AgentPhase =
  | null
  | "thinking"
  | "tool"
  | "composing";

/* Skills */

export interface SkillInfo {
  name: string;
  description: string;
  license: string | null;
  category: "public" | "custom" | "legacy";
  enabled: boolean;
  editable: boolean;
}

/* Memory */

export interface MemorySection {
  summary: string;
  updatedAt: string;
}

export interface MemoryFact {
  id: string;
  content: string;
  category: string;
  confidence: number;
  createdAt: string;
}

export interface MemoryData {
  version: string;
  revision: number | null;
  lastUpdated: string;
  user: {
    workContext: MemorySection;
    personalContext: MemorySection;
    topOfMind: MemorySection;
  };
  history: {
    recentMonths: MemorySection;
    earlierContext: MemorySection;
    longTermBackground: MemorySection;
  };
  facts: MemoryFact[];
}

export interface MemoryConfig {
  enabled: boolean;
  mode: "middleware" | "tool";
  injection_enabled: boolean;
  manager_class: string;
  shutdown_flush_timeout_seconds: number;
}

export interface MemoryStatus {
  config: MemoryConfig;
  data: MemoryData;
}

export interface FeaturesResponse {
  agents_api: { enabled: boolean };
  browser_control: { enabled: boolean };
  mcp_tasks: { enabled: boolean };
  subagent_batches: { enabled: boolean; worker_running: boolean; max_running: number };
}

/* ============================== Helpers ============================== */

async function responseError(res: Response, fallback: string): Promise<Error> {
  const text = await res.text().catch(() => "");
  const detail = text ? ` ${text.slice(0, 260)}` : "";
  return new Error(`${fallback} (HTTP ${res.status})${detail}`);
}

async function json(res: Response, fallback: string): Promise<unknown> {
  if (!res.ok) throw await responseError(res, fallback);
  try {
    return await res.json();
  } catch {
    throw new Error(`${fallback}：响应不是有效 JSON`);
  }
}

/* ============================== Threads ============================== */

export async function createThread(): Promise<string> {
  const res = await fetch(`${API}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const d = (await json(res, "创建会话失败")) as { thread_id: string };
  return d.thread_id;
}

export async function searchThreads(limit = 50): Promise<ThreadSummary[]> {
  const res = await fetch(`${API}/threads/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, offset: 0 }),
  });
  const arr = (await json(res, "加载会话列表失败")) as Record<string, unknown>[];
  return arr.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    return {
      thread_id: String(t.thread_id ?? ""),
      status: String(t.status ?? "idle"),
      created_at: String(t.created_at ?? ""),
      updated_at: String(t.updated_at ?? ""),
      title: typeof meta.title === "string" ? meta.title : undefined,
    };
  });
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  const res = await fetch(`${API}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId, metadata: { title } }),
  });
  if (!res.ok) throw await responseError(res, "重命名失败");
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(`${API}/threads/${threadId}`, { method: "DELETE" });
  if (!res.ok) throw await responseError(res, "删除会话失败");
}

/* ============================== Messages ============================== */

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== "object") return "";
        const o = b as Record<string, unknown>;
        if (typeof o.text === "string") return o.text;
        if (typeof o.content === "string") return o.content;
        return "";
      })
      .join("");
  }
  return "";
}

export async function loadMessages(threadId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API}/threads/${threadId}/messages`, {
    headers: { Accept: "application/json" },
  });
  const rows = (await json(res, "加载消息失败")) as Array<Record<string, unknown>>;
  const out: ChatMessage[] = [];
  let userId = 0;
  let aiId = 0;
  for (const row of rows) {
    const content = row.content as unknown;
    let type: unknown = row.type;
    let raw: unknown = content;
    if (content && typeof content === "object") {
      const c = content as Record<string, unknown>;
      type = c.type ?? type;
      raw = c.content ?? c;
    }
    const role =
      type === "ai" || type === "AIMessage"
        ? "assistant"
        : type === "human"
          ? "user"
          : null;
    const clean = textFromContent(raw).trim();
    if (!role || !clean) continue;
    out.push({
      id: role === "assistant" ? `ai-${aiId++}` : `u-${userId++}`,
      role,
      content: clean,
      tools: [],
      done: true,
    });
  }
  return out;
}

/* ============================== Models ============================== */

export async function loadModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API}/models`);
  const d = (await json(res, "加载模型失败")) as { models: ModelInfo[] };
  return d.models ?? [];
}

export function modelLabel(m: ModelInfo): string {
  return m.display_name || m.model || m.name;
}

export interface ModelWritePayload {
  name: string;
  display_name?: string | null;
  provider: string;
  model: string;
  api_base?: string | null;
  api_key?: string | null;
  supports_thinking?: boolean;
  max_tokens?: number | null;
  context_window?: number | null;
}

export async function createModel(p: ModelWritePayload): Promise<ModelInfo> {
  const res = await fetch(`${API}/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return (await json(res, "添加模型失败")) as ModelInfo;
}

export async function updateModel(
  name: string,
  p: ModelWritePayload,
): Promise<ModelInfo> {
  const res = await fetch(`${API}/models/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return (await json(res, "保存模型失败")) as ModelInfo;
}

export async function deleteModel(name: string): Promise<void> {
  const res = await fetch(`${API}/models/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await responseError(res, "删除模型失败");
}

/* ============================== Upload ============================== */

export interface UploadedFile {
  filename: string;
  size: number;
}

export async function uploadFiles(
  threadId: string,
  files: File[],
): Promise<UploadedFile[]> {
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await fetch(`${API}/threads/${threadId}/uploads`, {
    method: "POST",
    body: fd,
  });
  const d = (await json(res, "上传失败")) as {
    message?: string;
    files?: Array<{ filename?: string; size?: number }>;
  };
  return (d.files ?? []).map((f) => ({
    filename: f.filename ?? "",
    size: typeof f.size === "number" ? f.size : 0,
  }));
}

/* ============================== Skills ============================== */

export async function loadSkills(): Promise<SkillInfo[]> {
  const res = await fetch(`${API}/skills`);
  const d = (await json(res, "加载技能失败")) as { skills: SkillInfo[] };
  return d.skills ?? [];
}

export interface CustomSkillContent extends SkillInfo {
  content: string;
}

export async function createCustomSkill(p: {
  name: string;
  description: string;
  instructions: string;
}): Promise<CustomSkillContent> {
  const res = await fetch(`${API}/skills/custom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  return (await json(res, "创建技能失败")) as CustomSkillContent;
}

export async function getCustomSkill(name: string): Promise<CustomSkillContent> {
  const res = await fetch(`${API}/skills/custom/${encodeURIComponent(name)}`, {
    headers: { Accept: "application/json" },
  });
  return (await json(res, "读取技能失败")) as CustomSkillContent;
}

export async function updateCustomSkill(
  name: string,
  content: string,
): Promise<CustomSkillContent> {
  const res = await fetch(`${API}/skills/custom/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return (await json(res, "保存技能失败")) as CustomSkillContent;
}

export async function deleteCustomSkill(name: string): Promise<void> {
  const res = await fetch(`${API}/skills/custom/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await responseError(res, "删除技能失败");
}

export async function setSkillEnabled(
  name: string,
  enabled: boolean,
): Promise<SkillInfo> {
  const res = await fetch(`${API}/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return (await json(res, "切换技能状态失败")) as SkillInfo;
}

/* ============================== Memory ============================== */

export async function loadMemory(): Promise<MemoryData | null> {
  const res = await fetch(`${API}/memory`);
  if (res.status === 501) return null; // backend 不支持
  if (!res.ok) throw await responseError(res, "加载记忆失败");
  return (await res.json()) as MemoryData;
}

export async function loadMemoryConfig(): Promise<MemoryConfig | null> {
  const res = await fetch(`${API}/memory/config`);
  if (!res.ok) return null;
  return (await res.json()) as MemoryConfig;
}

export async function deleteMemoryFact(
  factId: string,
): Promise<MemoryData | null> {
  const res = await fetch(`${API}/memory/facts/${encodeURIComponent(factId)}`, {
    method: "DELETE",
  });
  if (res.status === 501) return null;
  if (!res.ok) throw await responseError(res, "删除记忆失败");
  return (await res.json()) as MemoryData;
}

/* ============================== Features ============================== */

export async function loadFeatures(): Promise<FeaturesResponse | null> {
  try {
    const res = await fetch(`${API}/features`);
    if (!res.ok) return null;
    return (await res.json()) as FeaturesResponse;
  } catch {
    return null;
  }
}

/* ============================== Streaming ============================== */

export interface RunCallbacks {
  onToken?: (text: string) => void;
  onToolStart?: (ev: { id: string; name: string }) => void;
  onToolEnd?: (ev: { id: string; name: string; ok: boolean; error?: string }) => void;
  onRuntimeModel?: (name: string) => void;
}

export async function streamRun(
  threadId: string,
  text: string,
  modelName: string | null,
  cb: RunCallbacks,
  signal?: AbortSignal,
  files?: UploadedFile[],
): Promise<void> {
  const human: Record<string, unknown> = { type: "human", content: text };
  if (files && files.length) {
    human.additional_kwargs = {
      files: files.map((f) => ({ filename: f.filename, size: f.size })),
    };
  }
  const body: Record<string, unknown> = {
    input: { messages: [human] },
    stream_mode: ["messages-tuple"],
    on_disconnect: "cancel",
  };
  if (modelName) body.context = { model_name: modelName };

  await streamSSE(
    `${API}/threads/${threadId}/runs/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    (evt) => {
      if (evt.event === "end") return;
      if (evt.event !== "messages") return;
      const items = Array.isArray(evt.data)
        ? (evt.data as Array<Record<string, unknown>>)
        : [];
      for (const itm of items) {
        const t = itm?.type;
        if (typeof t === "string") {
          if (t.startsWith("AI")) {
            const textPart = textFromContent(itm?.content).trim();
            if (textPart) cb.onToken?.(textPart);
            const calls = (itm?.tool_calls as Array<Record<string, unknown>>) ?? [];
            for (const c of calls) {
              if (c?.id && c?.name)
                cb.onToolStart?.({ id: String(c.id), name: String(c.name) });
            }
          } else if (t === "ToolMessage") {
            const name = String(itm?.name ?? "tool");
            const content = textFromContent(itm?.content);
            const ok =
              !/^error|^exception|失败/i.test(content.trim()) &&
              !("status" in itm);
            cb.onToolEnd?.({
              id: String(itm?.tool_call_id ?? name),
              name,
              ok,
              error: ok ? undefined : content.slice(0, 200),
            });
          }
        } else if (!t && itm && typeof itm === "object") {
          if (typeof itm.model_name === "string") cb.onRuntimeModel?.(itm.model_name);
        }
      }
    },
    signal,
  );
}
