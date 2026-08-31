import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { IconCheck, IconCopy } from "./icons";

/**
 * 极简 Markdown 渲染：
 * - 标题/段落/列表/引用/分隔线/链接/inline-code/表格
 * - 代码块使用主题化风格（与 prose-md CSS 类一致），含语言标签
 * - 代码块过长可折叠，按复制按钮即可复制
 */

const KEYWORDS = new Set([
  "def",
  "class",
  "import",
  "from",
  "return",
  "if",
  "elif",
  "else",
  "for",
  "while",
  "in",
  "not",
  "and",
  "or",
  "None",
  "True",
  "False",
  "async",
  "await",
  "try",
  "except",
  "with",
  "function",
  "const",
  "let",
  "var",
  "new",
  "this",
  "export",
  "default",
  "typeof",
  "switch",
  "case",
  "break",
  "continue",
  "public",
  "private",
  "params",
  "as",
  "out",
]);

type TokKind = "kw" | "str" | "cmt" | "num" | "plain";

function tokenizeLine(line: string): { kind: TokKind; text: string }[] {
  const out: { kind: TokKind; text: string }[] = [];
  // very small tokenizer — strings / line-comments / numbers / identifiers
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#[^\n]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|([^\sA-Za-z_])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const [, str, cmt, num, word, ws, sym] = m;
    if (str) out.push({ kind: "str", text: str });
    else if (cmt) out.push({ kind: "cmt", text: cmt });
    else if (num) out.push({ kind: "num", text: num });
    else if (word)
      out.push({ kind: KEYWORDS.has(word) ? "kw" : "plain", text: word });
    else if (ws) out.push({ kind: "plain", text: ws });
    else if (sym) out.push({ kind: "plain", text: sym });
  }
  return out;
}

const TOKEN_COLOR: Record<TokKind, string> = {
  kw: "text-[#4b6fb0]",
  str: "text-[#5f9277]",
  cmt: "text-[#7f9c80] italic",
  num: "text-[#6b84b8]",
  plain: "",
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  const lines = code.split("\n");
  const tooLong = lines.length > 16;
  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-line bg-surface-3">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5 text-[13px]">
        <span className="font-medium tracking-wider text-ink-2 uppercase">
          {lang || "code"}
        </span>
        <button
          onClick={onCopy}
          className="grid place-items-center rounded p-1 text-ink-2 transition hover:bg-primary-tint hover:text-primary-deep"
          aria-label="复制代码"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </button>
      </div>
      <pre className="scroll-slim overflow-x-auto p-3 text-[13.5px] leading-relaxed text-ink">
        {tooLong ? (
          <details>
            <summary className="cursor-pointer text-ink-2 hover:text-primary-deep">
              共 {lines.length} 行，点击展开
            </summary>
            <div className="mt-2">
              {lines.map((line, i) => (
                <CodeLine key={i} line={line} />
              ))}
            </div>
          </details>
        ) : (
          lines.map((line, i) => <CodeLine key={i} line={line} />)
        )}
      </pre>
    </div>
  );
}

function CodeLine({ line }: { line: string }) {
  const tokens = useMemo(() => tokenizeLine(line), [line]);
  return (
    <div className="whitespace-pre">
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_COLOR[t.kind]}>
          {t.text}
        </span>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(~~[^~]+~~)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, code, bold, em, del, , linkText, linkUrl] = m;
    if (code)
      parts.push(
        <code key={k++}>{code.slice(1, -1)}</code>,
      );
    else if (bold)
      parts.push(
        <strong key={k++} className="font-semibold text-ink">
          {bold.slice(2, -2)}
        </strong>,
      );
    else if (em)
      parts.push(
        <em key={k++} className="italic">
          {em.slice(1, -1)}
        </em>,
      );
    else if (del)
      parts.push(
        <del key={k++} className="text-muted">
          {del.slice(2, -2)}
        </del>,
      );
    else if (linkUrl)
      parts.push(
        <a
          key={k++}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
        >
          {linkText}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function parseTable(lines: string[]): {
  head: string[];
  rows: string[][];
} | null {
  const cellOf = (l: string) =>
    l
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  if (lines.length < 2) return null;
  if (!/^\|?[\s:|-]+\|?\s*$/.test(lines[1])) return null;
  if (!/\|/.test(lines[0])) return null;
  const head = cellOf(lines[0]);
  if (!head.length) return null;
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) continue;
    if (!/\|/.test(ln)) break;
    rows.push(cellOf(ln));
  }
  return { head, rows };
}

export default function Markdown({ content }: { content: string }) {
  const nodes = useMemo(() => {
    const src = content.replace(/^\n+|\n+$/g, "");
    const lines = src.split("\n");
    const out: ReactNode[] = [];
    let i = 0;
    let k = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {
        const lang = line.slice(3).trim();
        const buf: string[] = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push(<CodeBlock key={k++} lang={lang} code={buf.join("\n")} />);
        continue;
      }

      if (/^\s*\|.*\|\s*$/.test(line)) {
        const block: string[] = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          block.push(lines[i]);
          i++;
        }
        const tbl = parseTable(block);
        if (tbl) {
          out.push(
            <div
              key={k++}
              className="my-2 overflow-x-auto rounded-lg border border-line"
            >
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr>
                    {tbl.head.map((h, hi) => (
                      <th key={hi}>{renderInline(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tbl.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, ci) => (
                        <td key={ci}>{renderInline(c)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          );
          continue;
        }
      }

      if (/^#\s+/.test(line)) {
        out.push(<h1 key={k++}>{renderInline(line.replace(/^#\s+/, ""))}</h1>);
        i++;
        continue;
      }
      if (/^##\s+/.test(line)) {
        out.push(<h2 key={k++}>{renderInline(line.replace(/^##\s+/, ""))}</h2>);
        i++;
        continue;
      }
      if (/^###\s+/.test(line)) {
        out.push(<h3 key={k++}>{renderInline(line.replace(/^###\s+/, ""))}</h3>);
        i++;
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items: ReactNode[] = [];
        while (
          i < lines.length &&
          /^\s*[-*]\s+/.test(lines[i])
        ) {
          items.push(
            <li key={items.length}>
              {renderInline(lines[i].replace(/^\s*[-*]\s+/, ""))}
            </li>,
          );
          i++;
        }
        out.push(
          <ul key={k++} className="list-disc pl-5">
            {items}
          </ul>,
        );
        continue;
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: ReactNode[] = [];
        while (
          i < lines.length &&
          /^\s*\d+[.)]\s+/.test(lines[i])
        ) {
          items.push(
            <li key={items.length}>
              {renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}
            </li>,
          );
          i++;
        }
        out.push(
          <ol key={k++} className="list-decimal pl-5">
            {items}
          </ol>,
        );
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const buf: string[] = [];
        while (
          i < lines.length &&
          /^\s*>\s?/.test(lines[i])
        ) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out.push(
          <blockquote key={k++}>
            {buf.map((pl, pi) => (
              <Fragment key={pi}>
                {pi > 0 && <br />}
                {renderInline(pl)}
              </Fragment>
            ))}
          </blockquote>,
        );
        continue;
      }

      if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
        out.push(<hr key={k++} />);
        i++;
        continue;
      }

      if (!line.trim()) {
        i++;
        continue;
      }

      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^```/.test(lines[i]) &&
        !/^\s*\|.*\|\s*$/.test(lines[i]) &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+[.)]\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*(---|\*\*\*)\s*$/.test(lines[i])
      ) {
        para.push(lines[i].replace(/  +$/g, ""));
        i++;
      }
      out.push(
        <p key={k++}>
          {para.map((pl, pi) => (
            <Fragment key={pi}>
              {pi > 0 && <br />}
              {renderInline(pl)}
            </Fragment>
          ))}
        </p>,
      );
    }
    return out;
  }, [content]);

  return <div className="prose-md text-ink">{nodes}</div>;
}
