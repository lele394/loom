import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/web/shared/markdown';

describe('markdown renderer', () => {
  it('escapes HTML instead of executing it', () => {
    const html = renderToStaticMarkup(<Markdown text={'Hello <script>alert(1)</script> and <b>bold</b>'} />);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('rejects unsafe link schemes but keeps the text', () => {
    const html = renderToStaticMarkup(<Markdown text={'[click](javascript:alert(1)) and [ok](https://example.org)'} />);
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://example.org"');
  });

  it('renders headings, lists and wikilinks', () => {
    const html = renderToStaticMarkup(<Markdown text={'# Title\n\n- one\n- two\n\nSee [[My note]]'} />);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('/search?q=My%20note');
  });

  it('renders fenced code and checkboxes', () => {
    const html = renderToStaticMarkup(<Markdown text={'```ts\nconst x = 1\n```\n\n- [x] done\n- [ ] todo'} />);
    expect(html).toContain('const x = 1');
    expect(html).toContain('checked=""');
  });
});
