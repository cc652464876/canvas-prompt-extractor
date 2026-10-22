import presentation from '../platforms/presentation.cjs';
// Inline media labels keep the start and end of a long name.
export function promptReferenceLabel(name) {
  const chars = Array.from(String(name || '未命名参考'));
  return chars.length > 12
    ? chars.slice(0, 5).join('') + '…' + chars.slice(-5).join('')
    : chars.join('');
}

// Presentation-only token resolution. Copy/export keeps the original prompt;
// a mention is never evidence that a file was used for historical generation.
export function promptReferenceTokens(entry, platform) {
  const rule = presentation[platform],
    refs = entry.references || [],
    prompt = entry.prompt || '',
    base = '\\{\\{\\s*([A-Za-z]+)\\s+(\\d+)\\s*\\}\\}|【参考：[^】]*；节点 ([^】]+)】',
    regex = new RegExp(base + (rule ? '|' + rule.pattern : ''), 'g'),
    tokens = [];
  for (const match of prompt.matchAll(regex)) {
    let candidates;
    if (match[3]) candidates = refs.filter((r) => r.nodeId === match[3]);
    else if (match[4]) {
      const type = rule.type(match[4]),
        index = Number(match[5]);
      candidates = refs.filter(
        (r) => r.type === type && r.marker?.toLowerCase() === `${type} ${index}`
      );
      if (!candidates.length && rule.fallback) candidates = rule.fallback(refs, type, index);
    } else
      candidates = refs.filter(
        (r) => r.marker?.toLowerCase() === `${match[1]} ${match[2]}`.toLowerCase()
      );
    const identities = new Set(candidates.map((r) => `${r.nodeId || ''}|${r.url || ''}`));
    tokens.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      reference: identities.size === 1 ? candidates[0] : undefined
    });
  }
  return tokens;
}
