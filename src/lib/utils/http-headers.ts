export const HTTP_HEADER_NAMES = [
  'Accept', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control',
  'Connection', 'Content-Encoding', 'Content-Length', 'Content-Type', 'Cookie',
  'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match', 'Origin', 'Referer',
  'User-Agent',
];

const HEADER_VALUES: Record<string, string[]> = {
  accept: ['application/json', 'application/xml', 'text/plain', 'text/html', 'text/event-stream', '*/*'],
  'accept-encoding': ['gzip, deflate, br', 'gzip', 'deflate', 'br', 'identity'],
  authorization: ['Bearer ', 'Basic '],
  'cache-control': ['no-cache', 'no-store', 'max-age=0'],
  connection: ['keep-alive', 'close'],
  'content-encoding': ['gzip', 'deflate', 'br', 'identity'],
  'content-type': [
    'application/json', 'application/xml', 'application/x-www-form-urlencoded',
    'multipart/form-data', 'text/plain', 'text/html', 'application/octet-stream',
  ],
};

export function httpHeaderValues(name: string): string[] {
  return HEADER_VALUES[name.trim().toLowerCase()] ?? [];
}
