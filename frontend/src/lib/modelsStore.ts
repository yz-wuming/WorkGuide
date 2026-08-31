/**
 * 模型表单数据类型与提供方元数据。
 *
 * 模型的新增 / 修改 / 删除都直接调用后端 /api/models 写接口，
 * 持久化在服务端的 models.runtime.yaml，保存后立即在对话中生效，
 * 不再依赖浏览器 localStorage。
 */

export type ProviderId =
  | "openai"
  | "deepseek"
  | "qwen"
  | "zhipu"
  | "anthropic"
  | "ollama"
  | "custom";

export interface ModelFormData {
  /** 作为 model_name 传给后端，必须唯一 */
  name: string;
  /** 界面显示名 */
  label: string;
  provider: ProviderId;
  /** 后端实际模型 id（如 gpt-4o、deepseek-chat） */
  model: string;
  /** api_base 地址（OpenAI 兼容） */
  apiBase: string;
  /** API Key（仅保存在后端 models.runtime.yaml） */
  apiKey: string;
}

export const PROVIDERS: { id: ProviderId; label: string; apiBase: string }[] = [
  { id: "openai", label: "OpenAI 兼容", apiBase: "https://api.openai.com/v1" },
  { id: "deepseek", label: "DeepSeek", apiBase: "https://api.deepseek.com/v1" },
  { id: "qwen", label: "通义千问", apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "zhipu", label: "智谱 GLM", apiBase: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "anthropic", label: "Anthropic", apiBase: "https://api.anthropic.com/v1" },
  { id: "ollama", label: "Ollama", apiBase: "http://localhost:11434" },
  { id: "custom", label: "自定义", apiBase: "" },
];

export function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}
