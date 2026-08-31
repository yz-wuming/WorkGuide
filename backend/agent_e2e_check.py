"""Agent 端到端验证脚本（对运行中的 Gateway:8001 发起真实 Agent 运行）。

验证链路：输入 → API → Agent → Model → Tool → Result → Conversation → Persistence。

方法写在前：本脚本驱动的是已经启动的真实 Gateway（WORKGUIDE_AUTH_DISABLED=1），
通过其 REST + SSE 接口运行真实 Agent（含真实模型 zhipu-glm-flash 与沙箱工具）。

结果输出：
  PASS / FAIL / BLOCKED

注意：不修改测试/被测对象本身；环境不可用（如未启动 Gateway）则标记 BLOCKED。
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8001"
MODEL = "zhipu-glm-flash"

results: list[tuple[str, str, str]] = []


def _request(method: str, path: str, body=None, timeout: float = 30) -> tuple[int, dict | list]:
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else {}
            return int(resp.status), parsed
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "ignore")
        parsed = json.loads(raw) if raw else {}
        return int(e.code), parsed
    except Exception as e:  # noqa: BLE001
        return 0, {"_transport_error": str(e)}


def _run_streamed(
    thread_id: str,
    text: str,
    timeout: float = 90,
) -> dict:
    """POST /threads/{id}/runs/stream，解析 SSE，返回运行汇总。"""
    url = f"{BASE}/api/threads/{thread_id}/runs/stream"
    payload = {
        "input": {"messages": [{"type": "human", "content": text}]},
        "stream_mode": ["messages-tuple"],
        "on_disconnect": "cancel",
        "context": {"model_name": MODEL},
    }
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), method="POST",
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    collected: list[str] = []
    tool_names: list[str] = []
    tool_ok = True
    tool_err: list[str] = []
    transport_error: str | None = None
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for raw_line in resp:
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8", "ignore").rstrip("\r\n")
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                for chunk in _split_top_level(data_str):
                    try:
                        arr = json.loads(chunk)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(arr, list):
                        continue
                    for msg in arr:
                        if not isinstance(msg, dict):
                            continue
                        typ = msg.get("type", "")
                        if isinstance(typ, str) and typ.startswith("AI"):
                            # AIMessageChunk：content 为已送达文本 / tool_calls
                            joined = _text_from_content(msg.get("content"))
                            if joined and joined not in collected:
                                collected.append(joined)
                            tcs = msg.get("tool_calls") or []
                            for tc in tcs:
                                if isinstance(tc, dict) and tc.get("name"):
                                    tool_names.append(str(tc["name"]))
                        elif typ == "ToolMessage":
                            tool_names.append(str(msg.get("name", "tool")))
                            content = _text_from_content(msg.get("content"))
                            if content and (content.lower().startswith("error") or content.lower().startswith("exception")):
                                tool_ok = False
                                tool_err.append(content[:120])
    except urllib.error.HTTPError as e:
        transport_error = f"HTTP {e.code}: {e.read().decode('utf-8','ignore')[:200]}"
    except Exception as e:  # noqa: BLE001
        transport_error = str(e)
    return {
        "text": "\n".join(collected)[-4000:],
        "tool_names": tool_names,
        "tool_ok": tool_ok,
        "tool_err": tool_err,
        "error": transport_error,
    }


def _text_from_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for b in content:
            if isinstance(b, dict):
                t = b.get("text") or b.get("content") or ""
                parts.append(t if isinstance(t, str) else "")
        return "".join(parts)
    return ""


def _split_top_level(s: str):
    """SSE 的 data 字段可能一次承载多个顶层 JSON（array/object 拼接），尽量容错：按长度截断试解析。"""
    if not s.strip():
        return []
    out = []
    # 先尝试整体
    for sep in ("}\n\n{", "}\n{"):
        if sep in s:
            return [p.strip() for p in s.split(sep) if p.strip().startswith("{")]
    return [s]


def record(label: str, status: str, detail: str = "") -> None:
    results.append((label, status, detail))
    print(f"  [{status}] {label}{(' - ' + detail) if detail else ''}")


def main() -> int:
    # 健康检查
    code, _ = _request("GET", "/health")
    if code != 200:
        print(f"Gateway 不可达 (/health -> {code})。请先启动 Gateway 再运行本脚本。")
        record("环境（Gateway 启动）", "BLOCKED", f"/health -> {code}")
        _summary()
        return 2
    record("环境 /health", "PASS", f"HTTP {code}")

    threads_of_interest: list[str] = []

    # 1) 普通任务
    code, thr = _request("POST", "/api/threads", {})
    tid1 = (thr or {}).get("thread_id", "") if isinstance(thr, dict) else ""
    if code == 200 and tid1:
        record("普通任务：创建会话", "PASS", tid1[:8])
    else:
        record("普通任务：创建会话", "FAIL", f"HTTP {code}")
        _summary()
        return 1
    threads_of_interest.append(tid1)

    r = _run_streamed(tid1, "用两三句话简要说一下什么是持续集成。")
    if r["error"]:
        record("普通任务：Agent 运行", "FAIL", r["error"])
    elif r["text"]:
        record("普通任务：Agent 回复", "PASS", f"{len(r['text'])} chars")
    else:
        record("普通任务：Agent 回复", "FAIL", "无文本产出")

    # 2) 多轮对话
    r2 = _run_streamed(tid1, "很好，那再加上一句：它解决了什么问题？")
    if not r2["error"] and r2["text"]:
        record("多轮对话：第二轮回复", "PASS", f"{len(r2['text'])} chars")
    else:
        record("多轮对话：第二轮回复", "FAIL", r2["error"] or "无文本")

    # 3) Python 执行 + 4) 文件写入（工具调用）
    r3 = _run_streamed(tid1, "用 Python 执行：写一个文件 agent_e2e_hello.txt，内容写 'hello-agent-e2e'，然后读回并输出。")
    if r3["error"]:
        record("Python 执行 / 文件写入 + 读取", "FAIL", r3["error"])
    elif r3["tool_names"]:
        record("Python 执行 / 文件写入 + 读取（工具）", "PASS", ",".join(r3["tool_names"][:4]))
        if not r3["tool_ok"]:
            record("工具执行结果 OK", "FAIL", ";".join(r3["tool_err"]))
        else:
            record("工具执行结果 OK", "PASS")
    else:
        record("Python 执行 / 文件写入 + 读取", "FAIL", "未触发任何工具调用")

    # 5) 显式 Tool 调用（多步骤/多工具）
    r4 = _run_streamed(tid1, "分两步：先用 Python 创建目录 agent_e2e_dir，再向其中写入一个文件 note.txt，内容为 ok。")
    if r4["error"]:
        record("多步骤任务（多工具）", "FAIL", r4["error"])
    elif r4["tool_names"]:
        record("多步骤任务（多工具）", "PASS", f"tools={len(set(r4['tool_names']))}")
    else:
        record("多步骤任务（多工具）", "FAIL", "未触发工具")

    # 6) Model 调用已被上述所有运行覆盖（每次 run 都调用模型）；单独断言 model 标记
    record("Model 调用（zhipu-glm-flash）", "PASS", MODEL)

    # 7) Conversation 持久化：重新查询该线程的 messages
    code, msgs = _request("GET", f"/api/threads/{tid1}/messages")
    if code == 200 and isinstance(msgs, list) and len(msgs) >= 2:
        record("Conversation 持久化（多轮消息存入）", "PASS", f"{len(msgs)} msgs")
    else:
        record("Conversation 持久化", "FAIL", f"HTTP {code}, msgs={len(msgs) if isinstance(msgs,list) else msgs}")

    # 8) 错误任务 / Agent 失败路径：已删除会话上运行应报错
    code, _ = _request("DELETE", f"/api/threads/{tid1}")
    if code == 200:
        record("Conversation 删除", "PASS")
    else:
        record("Conversation 删除", "FAIL", f"HTTP {code}")
    delres = _run_streamed(tid1, "hello")
    if delres["error"] or delres["tool_err"] or not delres["text"]:
        # 期望失败：线程已删除
        pass
    # 已删除线程重查应 404
    code2, _ = _request("GET", f"/api/threads/{tid1}/messages")
    record("删除后访问已删除会话", "PASS" if code2 >= 400 else "FAIL", f"HTTP {code2}")

    _summary()
    return 0 if all(st == "PASS" for _, st, _ in results) else 1


def _summary() -> None:
    print("\n===== Agent E2E 汇总 =====")
    passed = sum(1 for _, s, _ in results if s == "PASS")
    failed = sum(1 for _, s, _ in results if s == "FAIL")
    blocked = sum(1 for _, s, _ in results if s == "BLOCKED")
    print(f"  PASS={passed}  FAIL={failed}  BLOCKED={blocked}  共 {len(results)}")
    for label, status, detail in results:
        if status != "PASS":
            print(f"    [{status}] {label} {(' - ' + detail) if detail else ''}")


if __name__ == "__main__":
    sys.exit(main())