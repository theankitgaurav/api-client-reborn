const MAX_FORMATTED_LENGTH = 4 * 1024 * 1024;
const MAX_FORMAT_DEPTH = 1000;

export function formatResponseBody(body: string, isExecuting: boolean, isStreaming: boolean, isTruncated: boolean): string {
  if (!body.trim() || isExecuting || isStreaming || isTruncated) return body;

  try {
    JSON.parse(body);
  } catch {
    return body;
  }

  const parts: string[] = [];
  let length = 0;
  let depth = 0;
  let previous = '';

  function append(text: string) {
    length += text.length;
    parts.push(text);
  }

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (/\s/.test(char)) continue;
    if (char === '"') {
      const start = i++;
      while (i < body.length) {
        if (body[i] === '\\') i += 2;
        else if (body[i++] === '"') break;
      }
      append(body.slice(start, i));
      i--;
    } else if (char === '{' || char === '[') {
      append(char);
      depth++;
      if (depth > MAX_FORMAT_DEPTH) return body;
      let nextIndex = i + 1;
      while (/\s/.test(body[nextIndex] || '')) nextIndex++;
      const next = body[nextIndex];
      if (next !== '}' && next !== ']') append('\n' + '  '.repeat(depth));
    } else if (char === '}' || char === ']') {
      depth--;
      if (previous !== '{' && previous !== '[') append('\n' + '  '.repeat(depth));
      append(char);
    } else if (char === ',') {
      append(',\n' + '  '.repeat(depth));
    } else if (char === ':') {
      append(': ');
    } else {
      const start = i;
      while (i + 1 < body.length && !/[\s{}\[\],:]/.test(body[i + 1])) i++;
      append(body.slice(start, i + 1));
    }
    previous = char;
    if (length > MAX_FORMATTED_LENGTH) return body;
  }

  return parts.join('');
}
