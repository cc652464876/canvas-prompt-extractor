// Dreamina's inline media labels keep the start and end of a long name.
export function promptReferenceLabel(name) {
  const chars = Array.from(String(name || '未命名参考'));
  return chars.length > 12
    ? chars.slice(0, 5).join('') + '…' + chars.slice(-5).join('')
    : chars.join('');
}

// Presentation-only token resolution. Copy/export keeps the original prompt;
// a mention is never evidence that a file was used for historical generation.
export function promptReferenceTokens(entry, platform) {
  const refs = entry.references || [],
    prompt = entry.prompt || '',
    base = '\\{\\{\\s*([A-Za-z]+)\\s+(\\d+)\\s*\\}\\}|【参考：[^】]*；节点 ([^】]+)】',
    regex = new RegExp(
      base +
        (platform === 'rhtv'
          ? '|@(图片|图像|视频|音频|文本)\\s*(\\d+)'
          : platform === 'tapnow'
            ? '|\\b(Image|Video|Audio|Text)\\s*(\\d+)\\b'
            : ''),
      'g'
    ),
    types = { 图片: 'image', 图像: 'image', 视频: 'video', 音频: 'audio', 文本: 'text' },
    tokens = [];
  for (const match of prompt.matchAll(regex)) {
    let candidates;
    if (match[3]) candidates = refs.filter((r) => r.nodeId === match[3]);
    else if (match[4]) {
      const type = platform === 'tapnow' ? match[4].toLowerCase() : types[match[4]],
        index = Number(match[5]);
      candidates = refs.filter(
        (r) => r.type === type && r.marker?.toLowerCase() === `${type} ${index}`
      );
      if (!candidates.length && platform === 'rhtv') {
        // RHTV's blank URL parameters fall back to connected media. Its @音频1
        // counts audio references, even when the strip numbers it fourth.
        const typed = refs
          .filter((r) => r.type === type)
          .filter(
            (r, i, all) =>
              !all
                .slice(0, i)
                .some(
                  (previous) =>
                    r.nodeId &&
                    previous.nodeId === r.nodeId &&
                    (!r.url || !previous.url || r.url === previous.url)
                )
          );
        const ref = typed[index - 1];
        candidates = ref && !ref.marker ? [ref] : [];
      }
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
