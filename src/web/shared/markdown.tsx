import { Fragment, type ReactNode } from 'react';

interface InlineOptions {
  onWikilink?: (title: string) => void;
}

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  if (trimmed.startsWith('mailto:')) return trimmed;
  return null;
}

function renderInline(text: string, options: InlineOptions, depth = 0): ReactNode[] {
  if (depth > 4) return [text];
  const nodes: ReactNode[] = [];
  let index = 0;
  let buffer = '';
  let key = 0;
  const flush = () => {
    if (buffer) {
      nodes.push(<Fragment key={`t${key++}`}>{buffer}</Fragment>);
      buffer = '';
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);

    if (rest.startsWith('**')) {
      const end = text.indexOf('**', index + 2);
      if (end > index + 2) {
        flush();
        nodes.push(
          <strong key={`b${key++}`}>{renderInline(text.slice(index + 2, end), options, depth + 1)}</strong>,
        );
        index = end + 2;
        continue;
      }
    }
    if (rest.startsWith('`')) {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        flush();
        nodes.push(<code key={`c${key++}`}>{text.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }
    if (rest.startsWith('[[')) {
      const end = text.indexOf(']]', index + 2);
      if (end > index + 2) {
        flush();
        const title = text.slice(index + 2, end).trim();
        nodes.push(
          <a
            key={`w${key++}`}
            className="wikilink"
            href={`/search?q=${encodeURIComponent(title)}`}
            onClick={(event) => {
              if (options.onWikilink) {
                event.preventDefault();
                options.onWikilink(title);
              }
            }}
          >
            {title}
          </a>,
        );
        index = end + 2;
        continue;
      }
    }
    if (rest.startsWith('[')) {
      const close = text.indexOf('](', index + 1);
      if (close > index) {
        const end = text.indexOf(')', close + 2);
        if (end > close) {
          const label = text.slice(index + 1, close);
          const href = safeHref(text.slice(close + 2, end));
          if (href) {
            flush();
            nodes.push(
              <a
                key={`a${key++}`}
                href={href}
                {...(/^https?:/i.test(href) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              >
                {renderInline(label, options, depth + 1)}
              </a>,
            );
            index = end + 1;
            continue;
          }
        }
      }
    }
    if (rest.startsWith('*') && !rest.startsWith('**')) {
      const end = text.indexOf('*', index + 1);
      if (end > index + 1) {
        flush();
        nodes.push(<em key={`i${key++}`}>{renderInline(text.slice(index + 1, end), options, depth + 1)}</em>);
        index = end + 1;
        continue;
      }
    }
    buffer += text[index];
    index++;
  }
  flush();
  return nodes;
}

function withBreaks(text: string, options: InlineOptions): ReactNode[] {
  const lines = text.split('\n');
  const nodes: ReactNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push(<br key={`br${index}`} />);
    nodes.push(...renderInline(line, options));
  });
  return nodes;
}

export function Markdown({
  text,
  className = '',
  onWikilink,
}: {
  text: string;
  className?: string;
  onWikilink?: (title: string) => void;
}) {
  const options: InlineOptions = { onWikilink };
  const lines = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index]!;

    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) {
        code.push(lines[index]!);
        index++;
      }
      index++;
      blocks.push(
        <pre key={`pre${key++}`}>
          <code data-language={language}>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    if (line.trim() === '$$') {
      const code: string[] = [];
      index++;
      while (index < lines.length && lines[index]!.trim() !== '$$') {
        code.push(lines[index]!);
        index++;
      }
      index++;
      blocks.push(
        <div key={`math${key++}`} className="math">
          {code.join('\n')}
        </div>,
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#{1,3}\s+/, '');
      const Tag = (`h${level}` as unknown) as 'h1';
      blocks.push(<Tag key={`h${key++}`}>{renderInline(content, options)}</Tag>);
      index++;
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={`hr${key++}`} />);
      index++;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index]!)) {
        quoteLines.push(lines[index]!.replace(/^>\s?/, ''));
        index++;
      }
      const callout = /^\[!(info|success|warn|tip)\]\s*(.*)$/i.exec(quoteLines[0] ?? '');
      if (callout) {
        blocks.push(
          <div key={`callout${key++}`} className="callout">
            {withBreaks([callout[2] ?? '', ...quoteLines.slice(1)].join('\n'), options)}
          </div>,
        );
      } else {
        blocks.push(<blockquote key={`q${key++}`}>{withBreaks(quoteLines.join('\n'), options)}</blockquote>);
      }
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      let itemIndex = 0;
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index]!)) {
        const raw = lines[index]!.replace(/^\s*[-*]\s+/, '');
        const todo = /^\[( |x|X)\]\s*(.*)$/.exec(raw);
        if (todo) {
          items.push(
            <li key={`li${itemIndex++}`} style={{ listStyle: 'none', marginLeft: -18 }}>
              <label className="checkbox" style={{ display: 'inline-flex' }}>
                <input type="checkbox" checked={todo[1] !== ' '} readOnly /> {renderInline(todo[2] ?? '', options)}
              </label>
            </li>,
          );
        } else {
          items.push(<li key={`li${itemIndex++}`}>{renderInline(raw, options)}</li>);
        }
        index++;
      }
      blocks.push(<ul key={`ul${key++}`}>{items}</ul>);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      let itemIndex = 0;
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index]!)) {
        items.push(
          <li key={`oli${itemIndex++}`}>
            {renderInline(lines[index]!.replace(/^\s*\d+\.\s+/, ''), options)}
          </li>,
        );
        index++;
      }
      blocks.push(<ol key={`ol${key++}`}>{items}</ol>);
      continue;
    }

    if (!line.trim()) {
      index++;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index]!.trim() &&
      !/^(#{1,3}\s|>\s?|```|[-*]\s|\d+\.\s|---)/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index++;
    }
    blocks.push(<p key={`p${key++}`}>{withBreaks(paragraph.join('\n'), options)}</p>);
  }

  return <div className={`md ${className}`}>{blocks.length ? blocks : <p className="faint">Nothing here yet.</p>}</div>;
}
