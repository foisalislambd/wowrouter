import { Fragment, type ReactNode } from "react";

export function MarkdownView({ text }: { text: string }) {
  return <div className="space-y-3 text-[15px] leading-7 text-gray-800 dark:text-gray-100">{parseMarkdown(text)}</div>;
}

function parseMarkdown(source: string): ReactNode[] {
  return splitFences(source).flatMap((part, index) => {
    if (part.kind === "code") {
      return (
        <pre key={`code-${index}`} className="overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-xs leading-5 text-gray-100">
          {part.lang ? <div className="mb-2 text-[10px] uppercase tracking-wide text-gray-400">{part.lang}</div> : null}
          <code>{part.text}</code>
        </pre>
      );
    }
    return parseBlocks(part.text, index);
  });
}

function splitFences(source: string) {
  const parts = source.split("```");
  const out: Array<{ kind: "text" | "code"; text: string; lang?: string }> = [];
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part) out.push({ kind: "text", text: part });
      return;
    }
    const breakAt = part.indexOf("\n");
    const lang = breakAt === -1 ? part.trim() : part.slice(0, breakAt).trim();
    const body = breakAt === -1 ? "" : part.slice(breakAt + 1).replace(/\n$/, "");
    out.push({ kind: "code", text: body, lang });
  });
  return out;
}

function parseBlocks(source: string, blockIndex: number): ReactNode[] {
  const lines = source.replace(/\n$/, "").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const className = level === 1 ? "text-lg font-semibold" : level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
      nodes.push(
        <div key={`${blockIndex}-h-${index}`} className={className}>
          {inlineNodes(heading[2], `${blockIndex}-h-${index}`)}
        </div>,
      );
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|")) {
        if (!isSeparator(lines[index])) rows.push(splitRow(lines[index]));
        index += 1;
      }
      nodes.push(<MarkdownTable key={`${blockIndex}-t-${index}`} rows={rows} />);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      nodes.push(
        <List key={`${blockIndex}-l-${index}`} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{inlineNodes(item, `${blockIndex}-li-${index}-${itemIndex}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote key={`${blockIndex}-q-${index}`} className="border-l-2 border-gray-300 pl-3 text-gray-600 dark:border-gray-600 dark:text-gray-300">
          {inlineNodes(quote.join(" "), `${blockIndex}-q-${index}`)}
        </blockquote>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[index]) && !lines[index].startsWith(">") && !isTableStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    nodes.push(
      <p key={`${blockIndex}-p-${index}`} className="whitespace-pre-wrap">
        {inlineNodes(paragraph.join("\n"), `${blockIndex}-p-${index}`)}
      </p>,
    );
  }
  return nodes;
}

function isTableStart(lines: string[], index: number) {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isSeparator(lines[index + 1]));
}

function isSeparator(line: string) {
  const cells = splitRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function MarkdownTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} className="border-b border-gray-200 px-2 py-1.5 font-medium dark:border-gray-700">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="border-b border-gray-100 px-2 py-1.5 dark:border-gray-800">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inlineNodes(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]]+\]\([^)\s]+\)|!\[[^\]]*\]\([^)\s]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(<Fragment key={`${keyPrefix}-t-${index}`}>{text.slice(last, match.index)}</Fragment>);
    nodes.push(renderInline(match[0], `${keyPrefix}-m-${index}`));
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(<Fragment key={`${keyPrefix}-t-end`}>{text.slice(last)}</Fragment>);
  return nodes;
}

function renderInline(token: string, key: string): ReactNode {
  if (token.startsWith("`")) {
    return (
      <code key={key} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[13px] text-gray-800 dark:bg-white/10 dark:text-gray-100">
        {token.slice(1, -1)}
      </code>
    );
  }
  if (token.startsWith("**")) return <strong key={key}>{token.slice(2, -2)}</strong>;
  if (token.startsWith("*")) return <em key={key}>{token.slice(1, -1)}</em>;
  const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
  if (image) {
    return <img key={key} src={image[2]} alt={image[1]} className="my-2 max-h-96 max-w-full rounded-xl" />;
  }
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
  if (link && /^https?:\/\//i.test(link[2])) {
    return (
      <a key={key} href={link[2]} target="_blank" rel="noreferrer" className="text-brand-600 underline">
        {link[1]}
      </a>
    );
  }
  return <Fragment key={key}>{token}</Fragment>;
}
