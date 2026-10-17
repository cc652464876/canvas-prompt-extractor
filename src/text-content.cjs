'use strict';

// Read known editor containers without stringifying arbitrary metadata.
function decodeText(value, depth = 0, seen = new Set()) {
  if (value == null) return { text: '', unsupported: false };
  if (typeof value === 'string' || value instanceof String)
    return { text: String(value), unsupported: false };
  if (typeof value === 'number' || typeof value === 'boolean')
    return { text: String(value), unsupported: false };
  if (typeof value !== 'object' || depth > 32 || seen.has(value))
    return { text: '', unsupported: true };
  const next = new Set(seen);
  next.add(value);
  const combine = (items, separator) => {
    const decoded = items.map((item) => decodeText(item, depth + 1, next));
    return {
      text: decoded.map((item) => item.text).join(separator),
      unsupported: decoded.some((item) => item.unsupported)
    };
  };
  if (Array.isArray(value)) return combine(value, '\n');
  if (typeof value.text === 'string') return { text: value.text, unsupported: false };
  if (['hardBreak', 'linebreak', 'hard_break'].includes(value.type))
    return { text: '\n', unsupported: false };
  if (value.root && typeof value.root === 'object') return decodeText(value.root, depth + 1, next);
  const children = Array.isArray(value.children)
    ? value.children
    : Array.isArray(value.content)
      ? value.content
      : null;
  if (
    children &&
    [
      'doc',
      'root',
      'paragraph',
      'heading',
      'blockquote',
      'codeBlock',
      'code',
      'bulletList',
      'orderedList',
      'list',
      'listItem',
      'listitem'
    ].includes(value.type)
  )
    return combine(
      children,
      ['paragraph', 'heading', 'codeBlock', 'code', 'listItem', 'listitem'].includes(value.type)
        ? ''
        : '\n'
    );
  return { text: '', unsupported: true };
}
function cleanRichText(value, platform, adapter) {
  const text = decodeText(value).text;
  return platform
    ? (adapter || require('./platforms/registry.cjs').getAdapter(platform)).cleanText(text)
    : text.replace(/^\u0000rt-md:v\d+\r?\n/, '');
}
function readText(value, platform, source = '', adapter) {
  const decoded = decodeText(value),
    text = cleanRichText(decoded.text, platform, adapter);
  return {
    text,
    rawText: decoded.text,
    textSource: source,
    textState: decoded.unsupported
      ? text.trim()
        ? 'partial'
        : 'unreadable'
      : text.trim()
        ? 'ready'
        : 'empty'
  };
}
function readNodeText(node, platform, adapter) {
  const data = node?.data || {},
    keys = (adapter || require('./platforms/registry.cjs').getAdapter(platform)).textFields;
  let fallback = { text: '', rawText: '', textSource: '', textState: 'empty' };
  for (const key of keys) {
    if (data[key] == null) continue;
    const candidate = readText(data[key], platform, 'node-' + key, adapter);
    if (candidate.text.trim()) return candidate;
    if (candidate.textState === 'unreadable') fallback = candidate;
  }
  return fallback;
}
module.exports = { decodeText, readText, readNodeText, cleanRichText };
