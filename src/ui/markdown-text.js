import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const parser = new MarkdownIt({ html: false, breaks: true, linkify: false, typographer: false });
// Accept the line-break tag used in storyboards without enabling arbitrary HTML.
parser.inline.ruler.before('html_inline', 'safe-line-break', (state, silent) => {
  const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += match[0].length;
  return true;
});
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index].content);

export function createMarkdownText(source, decorateText = null) {
  const element = document.createElement('div');
  let preview = null,
    raw = null,
    mode = null;
  function makeSource() {
    const content = document.createElement('pre');
    content.className = 'markdown-source';
    if (decorateText) content.append(...decorateText(source).childNodes);
    else content.textContent = source;
    return content;
  }
  function makePreview() {
    const content = document.createElement('div');
    content.className = 'markdown-content';
    content.append(
      DOMPurify.sanitize(parser.render(source), {
        RETURN_DOM_FRAGMENT: true,
        ALLOWED_TAGS: [
          'p',
          'br',
          'hr',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'strong',
          'em',
          's',
          'del',
          'blockquote',
          'ul',
          'ol',
          'li',
          'pre',
          'code',
          'table',
          'thead',
          'tbody',
          'tr',
          'th',
          'td',
          'a'
        ],
        ALLOWED_ATTR: ['href', 'title', 'start', 'align']
      })
    );
    if (decorateText) {
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT),
        nodes = [];
      while (walker.nextNode())
        if (!walker.currentNode.parentElement.closest('pre,code,a')) nodes.push(walker.currentNode);
      for (const node of nodes) node.replaceWith(...decorateText(node.data).childNodes);
    }
    for (const table of content.querySelectorAll('table')) {
      const wrap = document.createElement('div');
      wrap.className = 'markdown-table-wrap';
      table.before(wrap);
      wrap.append(table);
    }
    for (const link of content.querySelectorAll('a')) {
      try {
        const url = new URL(link.getAttribute('href'));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported link');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          void window.lab.openBrowser(url.href).catch(() => {});
        });
      } catch {
        link.removeAttribute('href');
      }
    }
    return content;
  }
  return {
    element,
    setMode(next) {
      if (mode === next) return;
      mode = next;
      if (mode === 'preview') {
        preview ||= makePreview();
        element.replaceChildren(preview);
      } else {
        raw ||= makeSource();
        element.replaceChildren(raw);
      }
    }
  };
}
