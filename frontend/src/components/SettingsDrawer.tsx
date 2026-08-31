import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModelInfo, SkillInfo } from "../lib/api";
import {
  loadSkills,
  createCustomSkill,
  getCustomSkill,
  updateCustomSkill,
  deleteCustomSkill,
  setSkillEnabled,
  loadMemory,
  deleteMemoryFact,
  loadMemoryConfig,
  modelLabel,
} from "../lib/api";
import type {
  MemoryData,
  MemoryConfig,
} from "../lib/api";
import type { ModelFormData, ProviderId } from "../lib/modelsStore";
import { PROVIDERS, providerLabel } from "../lib/modelsStore";
import { IconCheck, IconChevronDown, IconClose, IconPen, IconPlus, IconTrash } from "./icons";

/**
 * 设置面板：只承载真实存在的功能。
 * - 模型管理（添加 / 编辑 / 删除，直接写入后端 models.runtime.yaml，保存后立即生效）
 * - 真实技能列表（GET /api/skills）
 * - 真实记忆摘要与事实（GET /api/memory）
 * - 关于
 */

type TabId = "model" | "skills" | "memory" | "about";

export default function SettingsDrawer({
  open,
  models,
  selectedModel,
  onModel,
  onAddModel,
  onUpdateModel,
  onRemoveModel,
  onClose,
  onNote,
}: {
  open: boolean;
  models: ModelInfo[];
  selectedModel: string | null;
  onModel: (name: string) => void;
  onAddModel: (m: ModelFormData) => Promise<void>;
  onUpdateModel: (oldName: string, m: ModelFormData) => Promise<void>;
  onRemoveModel: (name: string) => Promise<void>;
  onClose: () => void;
  onNote: (msg: string, tone?: "info" | "error") => void;
}) {
  const [tab, setTab] = useState<TabId>("model");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const TABS = [
    { id: "model", label: "模型" },
    { id: "skills", label: "技能" },
    { id: "memory", label: "记忆" },
    { id: "about", label: "关于" },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/20 anim-fade"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-[min(400px,94vw)] max-w-full flex-col border-l border-black/10 bg-surface shadow-[-8px_0_30px_rgba(0,0,0,0.05)] anim-fade"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        {/* 顶部：标题 + 关闭 */}
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-[14px] font-semibold text-ink">设置</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <IconClose size={15} />
          </button>
        </div>

        {/* 横向 Tab —— 文字 Tab，active 深色字 + 极浅灰底 */}
        <div className="flex shrink-0 gap-1.5 border-b border-line px-3 pt-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`h-8 rounded-md px-3 text-[14px] transition ${
                tab === t.id
                  ? "bg-surface-2 font-medium text-ink"
                  : "text-ink-2 hover:bg-surface-2/60 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {tab === "model" && (
            <ModelTab
              models={models}
              selectedModel={selectedModel}
              onModel={onModel}
              onAddModel={onAddModel}
              onUpdateModel={onUpdateModel}
              onRemoveModel={onRemoveModel}
              onClose={onClose}
              onNote={onNote}
            />
          )}
          {tab === "skills" && <SkillsTab onNote={onNote} />}
          {tab === "memory" && <MemoryTab onNote={onNote} />}
          {tab === "about" && <AboutTab />}
        </div>
      </aside>
    </div>
  );
}

/* ----------------------------- Model Tab ----------------------------- */

function ModelTab({
  models,
  selectedModel,
  onModel,
  onAddModel,
  onUpdateModel,
  onRemoveModel,
  onClose,
  onNote,
}: {
  models: ModelInfo[];
  selectedModel: string | null;
  onModel: (name: string) => void;
  onAddModel: (m: ModelFormData) => Promise<void>;
  onUpdateModel: (oldName: string, m: ModelFormData) => Promise<void>;
  onRemoveModel: (name: string) => Promise<void>;
  onClose: () => void;
  onNote: (msg: string, tone?: "info" | "error") => void;
}) {
  const [editing, setEditing] = useState<
    { mode: "new" } | { mode: "edit"; model: ModelInfo } | null
  >(null);
  const [busy, setBusy] = useState(false);

  if (editing) {
    const initial: ModelFormData | null =
      editing.mode === "edit"
        ? {
            name: editing.model.name,
            label: editing.model.display_name || editing.model.name,
            provider: (editing.model.provider as ProviderId) || "custom",
            model: editing.model.model,
            apiBase: editing.model.api_base || "",
            apiKey: "",
          }
        : null;
    return (
      <ModelForm
        initial={initial}
        existingNames={models
          .filter((m) => editing.mode !== "edit" || m.name !== editing.model.name)
          .map((m) => m.name)}
        busy={busy}
        onCancel={() => setEditing(null)}
        onSave={async (m) => {
          setBusy(true);
          try {
            if (editing.mode === "new") {
              await onAddModel(m);
              onNote(`已添加模型「${m.name}」，保存后立即生效`);
            } else {
              await onUpdateModel(editing.model.name, m);
              onNote(`已保存模型「${m.name}」`);
            }
            setEditing(null);
          } catch (e) {
            onNote(e instanceof Error ? e.message : "保存失败", "error");
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink">模型</p>
          <button
            onClick={() => setEditing({ mode: "new" })}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink"
          >
            <IconPlus size={14} />
            添加模型
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          添加 / 修改的模型会写入后端 models.runtime.yaml，保存后立即在对话中生效，无需重启。
        </p>

        {models.length === 0 && (
          <p className="text-[14px] text-muted">暂无可读取的模型，请确认后端 Gateway 已启动。</p>
        )}

        <div className="space-y-1.5">
          {models.map((m) => {
            const active = m.name === selectedModel;
            const isRuntime = m.source === "runtime";
            return (
              <div
                key={m.name}
                className={`rounded-md border px-3 py-2 ${
                  active ? "border-primary-soft bg-primary-tint" : "border-line bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">
                        {modelLabel(m)}
                      </span>
                      <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-muted">
                        {isRuntime ? "运行时" : "config"}
                      </span>
                      {active && (
                        <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-deep">
                          当前
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="mt-1 text-[13px] text-muted">{m.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted">
                      <span className="rounded bg-canvas px-1.5 py-0.5">{m.name}</span>
                      {m.model && m.model !== m.name && (
                        <span className="rounded bg-canvas px-1.5 py-0.5">{m.model}</span>
                      )}
                      {m.provider && (
                        <span className="rounded bg-canvas px-1.5 py-0.5">
                          {providerLabel(m.provider)}
                        </span>
                      )}
                      {m.supports_thinking && (
                        <span className="rounded bg-canvas px-1.5 py-0.5">thinking</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => onModel(m.name)}
                      title="设为当前"
                      className="rounded-md px-2 py-1 text-[12px] text-ink-2 transition hover:bg-white hover:text-ink"
                    >
                      选用
                    </button>
                    {isRuntime && (
                      <>
                        <button
                          onClick={() => setEditing({ mode: "edit", model: m })}
                          title="编辑"
                          className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-white hover:text-ink"
                          aria-label="编辑"
                        >
                          <IconPen size={14} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`确定删除模型「${modelLabel(m)}」？删除后无法恢复。`)) {
                              void onRemoveModel(m.name)
                                .then(() => onNote(`已删除模型「${m.name}」`))
                                .catch((e) =>
                                  onNote(e instanceof Error ? e.message : "删除失败", "error"),
                                );
                            }
                          }}
                          title="删除"
                          className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-error-soft hover:text-error"
                          aria-label="删除"
                        >
                          <IconTrash size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <button
        onClick={onClose}
        className="ml-auto mt-4 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-white transition hover:bg-primary-deep"
      >
        完成
      </button>
    </div>
  );
}

/* ----------------------------- Model Form ----------------------------- */

function ModelForm({
  initial,
  existingNames,
  busy,
  onCancel,
  onSave,
}: {
  initial: ModelFormData | null;
  existingNames: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (m: ModelFormData) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [label, setLabel] = useState(initial?.label ?? "");
  const [provider, setProvider] = useState<ProviderId>(initial?.provider ?? "openai");
  const [model, setModel] = useState(initial?.model ?? "");
  const [apiBase, setApiBase] = useState(
    initial?.apiBase ?? PROVIDERS.find((p) => p.id === "openai")!.apiBase,
  );
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [err, setErr] = useState<string | null>(null);

  const onProvider = (id: ProviderId) => {
    setProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (preset?.apiBase) setApiBase(preset.apiBase);
  };

  const submit = () => {
    const n = name.trim();
    if (!n) return setErr("模型标识（name）必填，且会作为对话时使用的 model_name。");
    if (!/^[A-Za-z0-9._-]+$/.test(n))
      return setErr("模型标识只能包含字母、数字、点、下划线、连字符。");
    if (existingNames.includes(n))
      return setErr("该模型标识已存在（config.yaml 或运行时模型），请换一个。");
    if (!model.trim()) return setErr("真实模型 ID 必填（如 gpt-4o、deepseek-chat）。");
    onSave({
      name: n,
      label: label.trim() || n,
      provider,
      model: model.trim(),
      apiBase: apiBase.trim(),
      apiKey: apiKey.trim(),
    });
  };

  return (
    <div className="space-y-3.5">
      <p className="text-[13px] font-medium text-ink">
        {initial ? "编辑模型" : "添加模型"}
      </p>

      <Field label="模型标识（name）" hint="作为对话请求的 model_name，须唯一">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="如 my-gpt4o"
          className="form-input"
        />
      </Field>

      <Field label="显示名" hint="界面上展示的名称，可留空">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="如 我的 GPT-4o"
          className="form-input"
        />
      </Field>

      <Field label="提供方">
        <ProviderSelect value={provider} onChange={onProvider} />
      </Field>

      <Field label="真实模型 ID" hint="后端模型列表里的 model 字段">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="如 gpt-4o"
          className="form-input"
        />
      </Field>

      <Field label="API Base" hint="OpenAI 兼容接口地址">
        <input
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
          placeholder="https://api.openai.com/v1"
          className="form-input"
        />
      </Field>

      <Field label="API Key" hint={initial ? "留空则保留原有 Key" : "保存到后端 models.runtime.yaml"}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="form-input"
        />
      </Field>

      {err && (
        <p className="rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error-text">{err}</p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink-2 transition hover:bg-white disabled:opacity-60"
        >
          取消
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 rounded-lg border border-line bg-primary px-3 py-2 text-[14px] font-medium text-white transition hover:bg-primary-deep disabled:opacity-60"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">
        保存后写入后端 models.runtime.yaml，立即在对话中生效，无需重启 Gateway。
      </p>
    </div>
  );
}

/* 自定义提供方下拉（替代浏览器原生 select，风格与选择器一致） */
function ProviderSelect({
  value,
  onChange,
}: {
  value: ProviderId;
  onChange: (id: ProviderId) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const current = PROVIDERS.find((p) => p.id === value) ?? PROVIDERS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`form-input flex items-center justify-between gap-2 text-left ${
          open ? "border-ink-2" : ""
        }`}
      >
        <span>{current.label}</span>
        <IconChevronDown
          size={15}
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="scroll-slim absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-line-2 bg-surface py-1 shadow-sm anim-fade"
        >
          {PROVIDERS.map((p) => {
            const sel = p.id === value;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={sel}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[15px] transition hover:bg-surface-2"
              >
                <span className={sel ? "font-medium text-ink" : "font-medium text-ink-2"}>
                  {p.label}
                </span>
                {sel && <IconCheck size={14} className="text-ink" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

/* ----------------------------- Skills Tab ---------------------------- */

/** 将友好的名称规范化为 hyphen-case slug（与后端 validate_skill_name 约定一致）。 */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 解析 SKILL.md 前页，返回描述与正文；失败返回 null。 */
function parseSkillContent(content: string): { description: string; body: string } | null {
  const m = content.match(/\n?---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const desc = m[1].match(/^description:\s*"?([^"\n]*?)"?\s*$/m)?.[1] ?? "";
  const body = content.slice(m[0].length).trim();
  return { description: desc.trim(), body };
}

/** 保留原前页其他键（如 allowed-tools），仅替换 description 与正文。 */
function rebuildSkillMarkdown(original: string, description: string, body: string): string {
  const m = original.match(/\n?---\n([\s\S]*?)\n---/);
  if (!m) return original;
  const value = _yamlScalarSafe(description);
  let fmLines = m[1].split("\n");
  const idx = fmLines.findIndex((l) => l.replace(/^description:.*$/, "") !== l || /^description:/.test(l));
  if (idx >= 0) {
    fmLines[idx] = `description: ${value}`;
  } else {
    fmLines = fmLines
      .filter((l) => l.trim() !== "")
      .concat(`description: ${value}`);
  }
  return `---\n${fmLines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** 后端同款：普通安全字符不加引号，其余用双引号转义，避免 YAML 前页被破坏。 */
function _yamlScalarSafe(value: string): string {
  const v = value.replace(/\r/g, " ").replace(/\n/g, " ").trim();
  if (!v) return '""';
  const plain = /^[A-Za-z0-9]/.test(v) && /^[A-Za-z0-9 ,.()/-_]*$/.test(v);
  if (plain) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

type SkillEditorState =
  | { mode: "create"; name: string; description: string; instructions: string }
  | { mode: "edit"; skillName: string; original: string; description: string; instructions: string }
  | null;

function SkillsTab({ onNote }: { onNote: (msg: string, tone?: "info" | "error") => void }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editor, setEditor] = useState<SkillEditorState>(null);

  const reload = async () => {
    setErr(null);
    const s = await loadSkills();
    setSkills([...s].sort((a, b) => a.name.localeCompare(b.name)));
  };

  useEffect(() => {
    let dead = false;
    loadSkills()
      .then((s) => {
        if (!dead) setSkills(s);
      })
      .catch((e) => {
        if (!dead) {
          setErr(e instanceof Error ? e.message : "加载失败");
          setSkills([]);
        }
      });
    return () => {
      dead = true;
    };
  }, []);

  const toggle = async (s: SkillInfo) => {
    try {
      const updated = await setSkillEnabled(s.name, !s.enabled);
      setSkills((prev) => prev?.map((x) => (x.name === s.name ? { ...x, enabled: updated.enabled } : x)) ?? prev);
      onNote(updated.enabled ? `已启用「${s.name}」` : `已禁用「${s.name}」`);
    } catch (e) {
      onNote(e instanceof Error ? e.message : "切换失败", "error");
    }
  };

  const openCreate = () => setEditor({ mode: "create", name: "", description: "", instructions: "" });

  const openEdit = async (s: SkillInfo) => {
    try {
      const c = await getCustomSkill(s.name);
      const parsed = parseSkillContent(c.content);
      setEditor({
        mode: "edit",
        skillName: s.name,
        original: c.content,
        description: parsed?.description ?? "",
        instructions: parsed?.body ?? "",
      });
    } catch (e) {
      onNote(e instanceof Error ? e.message : "读取技能失败", "error");
    }
  };

  const onDelete = async (s: SkillInfo) => {
    if (!confirm(`确定删除自定义技能「${s.name}」？删除后无法恢复。`)) return;
    try {
      await deleteCustomSkill(s.name);
      onNote(`已删除「${s.name}」`);
      void reload().then(() => setSkills((cur) => cur));
    } catch (e) {
      onNote(e instanceof Error ? e.message : "删除技能失败", "error");
    }
  };

  const onSave = async (state: Exclude<SkillEditorState, null>) => {
    if (state.mode === "create") {
      const slug = slugify(state.name);
      if (!slug) {
        onNote("名称只能包含字母、数字与连字符，且不能为空", "error");
        return;
      }
      if (skills?.some((s) => s.name === slug)) {
        onNote(`技能「${slug}」已存在`, "error");
        return;
      }
      try {
        await createCustomSkill({ name: slug, description: state.description, instructions: state.instructions });
        onNote(`已创建「${slug}」`);
        setEditor(null);
        setSkills(null);
        void reload();
      } catch (e) {
        onNote(e instanceof Error ? e.message : "创建技能失败", "error");
      }
    } else {
      const content = rebuildSkillMarkdown(state.original, state.description, state.instructions);
      try {
        await updateCustomSkill(state.skillName, content);
        onNote(`已保存「${state.skillName}」`);
        setEditor(null);
        setSkills(null);
        void reload();
      } catch (e) {
        onNote(e instanceof Error ? e.message : "保存技能失败", "error");
      }
    }
  };

  if (err) {
    return (
      <div>
        <p className="text-[13px] text-muted">无法加载技能列表。</p>
        <p className="mt-2 rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error-text">
          {err}
        </p>
      </div>
    );
  }

  if (skills === null) {
    return <p className="text-[14px] text-muted">加载中…</p>;
  }

  const custom = skills.filter((s) => s.category === "custom");
  const others = skills.filter((s) => s.category !== "custom");

  return (
    <div>
      {editor && (
        <SkillEditor
          state={editor}
          onCancel={() => setEditor(null)}
          onSave={(st) => onSave(st)}
        />
      )}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] text-muted">
          技能是 Agent 在执行任务时可调用的能力定义。可创建、编辑、启用或禁用自定义技能。
        </p>
        <button
          onClick={openCreate}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[13px] font-medium text-ink-2 transition hover:bg-surface-3 hover:text-ink"
        >
          <IconPlus size={14} />
          新建技能
        </button>
      </div>

      <div className="space-y-2">
        {custom.map((s) => (
          <SkillCard
            key={s.name}
            skill={s}
            editable
            onToggle={toggle}
            onEdit={openEdit}
            onDelete={onDelete}
          />
        ))}

        {others.map((s) => (
          <SkillCard key={s.name} skill={s} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  editable,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: SkillInfo;
  editable?: boolean;
  onToggle: (s: SkillInfo) => void;
  onEdit?: (s: SkillInfo) => void;
  onDelete?: (s: SkillInfo) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-ink">{skill.name}</span>
          <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] capitalize text-ink-2">
            {skill.category}
          </span>
          {skill.enabled ? (
            <span className="rounded-full bg-success-soft px-1.5 py-0.5 text-[11px] text-success-text">
              已启用
            </span>
          ) : (
            <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-muted">
              已禁用
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-1 text-[13px] text-ink-2">{skill.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {editable && onEdit && (
          <button
            onClick={() => onEdit(skill)}
            title="编辑技能"
            aria-label="编辑技能"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-white hover:text-ink"
          >
            <IconPen size={14} />
          </button>
        )}
        {editable && onDelete && (
          <button
            onClick={() => onDelete(skill)}
            title="删除技能"
            aria-label="删除技能"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-error-soft hover:text-error"
          >
            <IconTrash size={14} />
          </button>
        )}
        <Toggle checked={skill.enabled} onChange={() => onToggle(skill)} />
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${
        checked ? "bg-primary" : "bg-surface-3"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function SkillEditor({
  state,
  onCancel,
  onSave,
}: {
  state: NonNullable<SkillEditorState>;
  onCancel: () => void;
  onSave: (state: NonNullable<SkillEditorState>) => void;
}) {
  const [name, setName] = useState(state.mode === "create" ? state.name : "");
  const [description, setDescription] = useState(state.description);
  const [instructions, setInstructions] = useState(state.instructions);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = () => {
    setLocalErr(null);
    if (state.mode === "create") {
      const slug = slugify(name);
      if (!slug) return setLocalErr("技能名称必填，且只能包含字母、数字与连字符。");
      if (!description.trim()) return setLocalErr("请填写技能描述。");
      if (!instructions.trim()) return setLocalErr("请填写技能指令（Instructions）。");
      onSave({ mode: "create", name: slug, description: description.trim(), instructions: instructions.trim() });
    } else {
      if (!description.trim()) return setLocalErr("请填写技能描述。");
      if (!instructions.trim()) return setLocalErr("请填写技能指令（Instructions）。");
      onSave({
        mode: "edit",
        skillName: state.skillName,
        original: state.original,
        description: description.trim(),
        instructions: instructions.trim(),
      });
    }
  };

  const title = state.mode === "create" ? "新建技能" : `编辑技能 · ${state.skillName}`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 p-4 anim-fade"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-[600px] flex-col rounded-xl border border-line bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[14px] font-semibold text-ink">{title}</span>
          <button
            onClick={onCancel}
            aria-label="关闭"
            className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <IconClose size={15} />
          </button>
        </div>

        {state.mode === "edit" && (
          <div className="px-4 pt-3 pb-1 text-[12px] text-muted">
            技能名称不可更改。要重命名请删除后新建。
          </div>
        )}

        <div className="scroll-slim min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-3">
          <Field label="名称" hint={state.mode === "create" ? "将转为英文连字符标识" : undefined}>
            <input
              value={name}
              disabled={state.mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 Code Review"
              className="form-input disabled:opacity-60"
            />
            {state.mode === "create" && (
              <div className="mt-0.5 text-[11px] text-muted">
                标识：{slugify(name) || "—"}
              </div>
            )}
          </Field>

          <Field label="描述" hint="列表里展示的一句话说明">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="概述这个技能做什么"
              className="form-input"
            />
          </Field>

          <Field label="指令（Instructions）" hint="Agent 使用此技能时遵循的说明">
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={9}
              placeholder={
                "例如：\n使用这个技能时，请按照以下步骤检查 Python 代码…"
              }
              className="form-input resize-y leading-relaxed"
            />
          </Field>

          {localErr && (
            <p className="rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error-text">
              {localErr}
            </p>
          )}

          <div className="flex gap-2 pb-1 pt-1">
            <button
              onClick={onCancel}
              className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink-2 transition hover:bg-white"
            >
              取消
            </button>
            <button
              onClick={submit}
              className="flex-1 rounded-lg border border-line bg-primary px-3 py-2 text-[14px] font-medium text-white transition hover:bg-primary-deep"
            >
              保存技能
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Memory Tab ---------------------------- */

function MemoryTab({ onNote }: { onNote: (msg: string) => void }) {
  const [mem, setMem] = useState<MemoryData | null | "loading" | "unsupported">(
    "loading",
  );
  const [cfg, setCfg] = useState<MemoryConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    setMem("loading");
    setErr(null);
    Promise.all([loadMemory(), loadMemoryConfig()])
      .then(([m, c]) => {
        if (dead) return;
        setMem(m);
        setCfg(c);
      })
      .catch((e) => {
        if (dead) return;
        const msg = e instanceof Error ? e.message : "加载失败";
        if (/501/.test(msg)) {
          setMem("unsupported");
        } else {
          setErr(msg);
          setMem(null);
        }
      });
    return () => {
      dead = true;
    };
  }, []);

  if (mem === "loading") {
    return <p className="text-[14px] text-muted">加载中…</p>;
  }
  if (mem === "unsupported") {
    return (
      <p className="text-[14px] text-muted">
        当前 Memory 后端不支持读取完整视图。Agent 仍可在运行中自动使用记忆。
      </p>
    );
  }
  if (err) {
    return (
      <p className="rounded-lg bg-error-soft px-3 py-2 text-[13px] text-error-text">
        {err}
      </p>
    );
  }
  if (!mem) {
    return <p className="text-[14px] text-muted">暂无记忆。</p>;
  }

  const Section = ({ title, data }: { title: string; data: { summary: string; updatedAt: string } }) => {
    if (!data.summary) return null;
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-medium uppercase tracking-wider text-muted">
            {title}
          </span>
          {data.updatedAt && (
            <span className="text-[11px] text-muted">
              {new Date(data.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
          {data.summary}
        </p>
      </div>
    );
  };

  const onDelete = async (factId: string) => {
    try {
      const next = await deleteMemoryFact(factId);
      if (next) setMem(next);
    } catch (e) {
      onNote(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="space-y-3">
      {cfg && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
          <span className="rounded-full bg-canvas px-1.5 py-0.5">
            {cfg.manager_class}
          </span>
          <span className="rounded-full bg-canvas px-1.5 py-0.5">
            {cfg.mode}
          </span>
          <span
            className={`rounded-full px-1.5 py-0.5 ${
              cfg.enabled
                ? "bg-success-soft text-success-text"
                : "bg-canvas text-muted"
            }`}
          >
            {cfg.enabled ? "已启用" : "未启用"}
          </span>
        </div>
      )}
      <Section title="工作上下文" data={mem.user.workContext} />
      <Section title="个人上下文" data={mem.user.personalContext} />
      <Section title="当前关注" data={mem.user.topOfMind} />
      <Section title="近期" data={mem.history.recentMonths} />
      <Section title="更早" data={mem.history.earlierContext} />
      <Section title="长期背景" data={mem.history.longTermBackground} />

      {mem.facts.length > 0 && (
        <div className="rounded-lg border border-line bg-surface-2">
          <div className="border-b border-line px-3.5 py-2 text-[12px] font-medium uppercase tracking-wider text-muted">
            事实 · {mem.facts.length}
          </div>
          <div className="divide-y divide-line/70">
            {mem.facts.map((f) => (
              <div
                key={f.id}
                className="flex items-start gap-2 px-3.5 py-2.5 text-[13.5px] text-ink"
              >
                <span className="mt-0.5 rounded-full bg-canvas px-1.5 py-0.5 text-[11px] text-ink-2">
                  {f.category}
                </span>
                <span className="min-w-0 flex-1">{f.content}</span>
                <button
                  onClick={() => onDelete(f.id)}
                  title="删除事实"
                  className="grid h-6 w-6 place-items-center rounded text-[12px] text-muted transition hover:bg-error-soft hover:text-error"
                  aria-label="删除事实"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- About Tab ----------------------------- */

function AboutTab() {
  return (
    <div className="space-y-4 text-[14px] text-ink">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-lg bg-canvas-2 text-[22px] font-semibold text-ink">
          W
        </div>
        <div>
          <div className="text-[16px] font-semibold">WorkGuide</div>
          <div className="text-[13px] text-muted">桌面级 AI 助手</div>
        </div>
      </div>

      <p className="text-[14px] leading-relaxed text-ink-2">
        一个简洁的桌面 AI Agent。
        <br />
        会话、能力、记忆都在本地网关内运行。
      </p>

      <p className="text-[12px] text-muted">
        按
        <kbd className="mx-1 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
          Esc
        </kbd>
        关闭此面板。
      </p>
    </div>
  );
}
