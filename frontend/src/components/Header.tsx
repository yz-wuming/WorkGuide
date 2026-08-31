import type { ModelInfo } from "../lib/api";
import { modelLabel } from "../lib/api";

/**
 * 克制型 Desktop Header —— 64px 高，半透明浅白 + 轻微模糊。
 * 左侧产品名 16px/600，右侧真实连接状态 + 当前模型（弱化显示，二级层级）。
 * 仅极浅底边框，无阴影、无多余按钮。
 */
export default function Header({
  selectedModel,
  models,
  connected,
}: {
  selectedModel: string | null;
  models: ModelInfo[];
  connected: boolean;
}) {
  const display = (() => {
    const m = models.find((x) => x.name === selectedModel);
    return m ? modelLabel(m) : selectedModel || "—";
  })();

  return (
    <header className="relative z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[rgba(220,223,227,0.7)] bg-white/70 px-5 backdrop-blur-md">
      <span className="truncate text-[17px] font-semibold tracking-tight text-[#17191C]">
        WorkGuide
      </span>

      <div className="flex shrink-0 items-center text-[15px] text-[#68707A]">
        <span
          className="inline-flex items-center gap-2"
          title={connected ? "已连接 Gateway" : "未连接 Gateway（8001）"}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? "bg-[#4F8A68]" : "bg-[#dc2626]"
            }`}
            aria-hidden
          />
          {connected ? "已连接" : "未连接"}
        </span>
        <span className="mx-3 h-3.5 w-px bg-[#E6E8EB]" aria-hidden />
        <span className="inline-flex items-center">
          <span className="text-[#68707A]">Model</span>
          <span className="mx-1 text-[#8A9199]">·</span>
          <span className="text-[#68707A]">{display}</span>
        </span>
      </div>
    </header>
  );
}