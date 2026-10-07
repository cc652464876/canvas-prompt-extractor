// Dreamina's inline media labels keep the start and end of a long name.
export function promptReferenceLabel(name){
  const chars=Array.from(String(name||'未命名参考'));
  return chars.length>12?chars.slice(0,5).join('')+'…'+chars.slice(-5).join(''):chars.join('');
}
