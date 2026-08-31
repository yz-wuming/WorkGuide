/**
 * SSE(Server-Sent Events)流式读取工具。
 * 后端智能体通过 text/event-stream 逐条推送事件,每条 SSE 由
 * `event:`(事件名)、`data:`(JSON 负载)、`id:`(序号)组成。
 * 我们用 fetch + ReadableStream 逐帧读取并切分成条。
 */

export interface SSEEvent {
  event: string;
  id: string | null;
  data: unknown;
}

async function responseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`;
}

export async function streamSSE(
  url: string,
  init: RequestInit,
  onEvent: (evt: SSEEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    ...init,
    signal,
    headers: {
      Accept: "text/event-stream",
      ...(init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
    },
  });

  if (!res.ok || !res.body) {
    throw new Error(await responseError(res));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔,逐条切出来
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const evt = parseBlock(raw);
      if (evt) onEvent(evt);
    }
  }
}

function parseBlock(raw: string): SSEEvent | null {
  let event = "message";
  let id: string | null = null;
  let data = "";

  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("id:")) {
      id = line.slice("id:".length).trim();
    } else if (line.startsWith("data:")) {
      const value = line.slice("data:".length).trim();
      if (value && value !== "[DONE]") data += value;
    }
  }

  if (data === "") return null;
  let parsed: unknown = data;
  try {
    parsed = JSON.parse(data);
  } catch {
    // 保持字符串负载
  }
  return { event, id, data: parsed };
}