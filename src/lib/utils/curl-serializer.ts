export interface KeyValueParam {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface PlaygroundModel {
  name: string;
  timeoutMs: number;
  noBuffer?: boolean;
  method: string;
  url: string;
  params: KeyValueParam[];
  headers: KeyValueParam[];
  authType: 'none' | 'bearer' | 'basic';
  bearerToken: string;
  basicUser: string;
  basicPass: string;
  bodyType: 'none' | 'json' | 'text' | 'urlencoded';
  bodyRaw: string;
  bodyUrlencoded: KeyValueParam[];
}

export function createDefaultPlayground(): PlaygroundModel {
  return {
    name: 'Untitled Request',
    timeoutMs: 30000,
    noBuffer: false,
    method: 'GET',
    url: '',
    params: [{ id: '1', key: '', value: '', enabled: true }],
    headers: [{ id: '1', key: '', value: '', enabled: true }],
    authType: 'none',
    bearerToken: '',
    basicUser: '',
    basicPass: '',
    bodyType: 'none',
    bodyRaw: '',
    bodyUrlencoded: [{ id: '1', key: '', value: '', enabled: true }],
  };
}

/**
 * Parses raw .curl file content into a rich Postman-like playground model
 */
export function parseCurlToPlayground(rawContent: string): PlaygroundModel {
  const model = createDefaultPlayground();
  if (!rawContent) return model;

  const lines = rawContent.split('\n');
  const commandLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# @name ')) {
      model.name = trimmed.replace('# @name ', '').trim();
      continue;
    }
    if (trimmed.startsWith('# @timeout ')) {
      const parsedTimeout = parseInt(trimmed.replace('# @timeout ', '').trim(), 10);
      if (!isNaN(parsedTimeout)) model.timeoutMs = parsedTimeout;
      continue;
    }
    if (trimmed.startsWith('# @')) {
      continue;
    }
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      continue;
    }
    commandLines.push(line);
  }

  const command = commandLines.join('\n').trim();
  if (!command) return model;

  // Simple token regex extracting quoted strings or single words
  const tokens: string[] = [];
  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = regex.exec(command)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[0]);
  }

  const isGrpc =
    tokens[0] === 'grpcurl' ||
    command.trimStart().startsWith('grpcurl') ||
    rawContent.includes('grpcurl');

  const headersList: KeyValueParam[] = [];
  const positionalArgs: string[] = [];
  let method: string | null = null;
  let bodyData: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === 'curl' || token === 'grpcurl' || token === '\\') continue;

    if (token === '-plaintext' || token === '-insecure') {
      continue;
    }

    if (token === '-X' || token === '--request') {
      if (i + 1 < tokens.length) {
        method = tokens[++i].toUpperCase();
      }
    } else if (token === '-N' || token === '--no-buffer') {
      model.noBuffer = true;
    } else if (token === '-H' || token === '--header') {
      if (i + 1 < tokens.length) {
        const headerStr = tokens[++i];
        const colonIdx = headerStr.indexOf(':');
        if (colonIdx > 0) {
          const key = headerStr.substring(0, colonIdx).trim();
          const value = headerStr.substring(colonIdx + 1).trim();

          // Check if this is an Authorization header
          if (key.toLowerCase() === 'authorization') {
            if (value.startsWith('Bearer ')) {
              model.authType = 'bearer';
              model.bearerToken = value.replace('Bearer ', '').trim();
              continue;
            } else if (value.startsWith('Basic ')) {
              model.authType = 'basic';
              try {
                const decoded = atob(value.replace('Basic ', '').trim());
                const [u, p] = decoded.split(':');
                model.basicUser = u || '';
                model.basicPass = p || '';
              } catch {
                // Keep as header if not valid base64
              }
            }
          }

          headersList.push({
            id: String(Date.now() + Math.random()),
            key,
            value,
            enabled: true,
          });
        }
      }
    } else if (token === '-u' || token === '--user') {
      if (i + 1 < tokens.length) {
        const userPass = tokens[++i];
        const [u, p] = userPass.split(':');
        model.authType = 'basic';
        model.basicUser = u || '';
        model.basicPass = p || '';
      }
    } else if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary'
    ) {
      if (i + 1 < tokens.length) {
        bodyData = tokens[++i];
      }
    } else if (token === '-m' || token === '--max-time') {
      if (i + 1 < tokens.length) {
        const sec = parseFloat(tokens[++i]);
        if (!isNaN(sec)) model.timeoutMs = Math.round(sec * 1000);
      }
    } else if (!token.startsWith('-')) {
      positionalArgs.push(token);
    }
  }

  if (isGrpc) {
    model.method = 'GRPC';
    model.url = positionalArgs.join(' ').trim();
  } else {
    // Parse query params from URL
    const url = positionalArgs[0] || '';
    if (url) {
      const questionIdx = url.indexOf('?');
      if (questionIdx >= 0) {
        const baseUrl = url.substring(0, questionIdx);
        const queryStr = url.substring(questionIdx + 1);
        const paramsList: KeyValueParam[] = [];

        for (const pair of queryStr.split('&')) {
          if (!pair) continue;
          const [k, v] = pair.split('=');
          paramsList.push({
            id: String(Date.now() + Math.random()),
            key: decodeURIComponent(k || ''),
            value: decodeURIComponent(v || ''),
            enabled: true,
          });
        }

        model.url = baseUrl;
        if (paramsList.length > 0) {
          model.params = paramsList;
        }
      } else {
        model.url = url;
      }
    }
  }

  if (headersList.length > 0) {
    model.headers = headersList;
  }

  // Parse Body
  if (bodyData) {
    try {
      const parsedJson = JSON.parse(bodyData);
      model.bodyType = 'json';
      model.bodyRaw = JSON.stringify(parsedJson, null, 2);
    } catch {
      if (bodyData.includes('=') && !bodyData.includes('{')) {
        model.bodyType = 'urlencoded';
        model.bodyUrlencoded = bodyData.split('&').map((pair) => {
          const [k, v] = pair.split('=');
          return {
            id: String(Date.now() + Math.random()),
            key: decodeURIComponent(k || ''),
            value: decodeURIComponent(v || ''),
            enabled: true,
          };
        });
      } else {
        model.bodyType = 'text';
        model.bodyRaw = bodyData;
      }
    }
  } else {
    model.bodyType = 'none';
  }

  // Infer method for non-gRPC
  if (!isGrpc) {
    if (method) {
      model.method = method;
    } else {
      model.method = model.bodyType !== 'none' ? 'POST' : 'GET';
    }
  }

  return model;
}

/**
 * Serializes the Postman-like playground state back into a clean, canonical .curl or .grpcurl file
 */
export function serializePlaygroundToCurl(model: PlaygroundModel): string {
  const lines: string[] = [];

  // Metadata comments
  if (model.name) {
    lines.push(`# @name ${model.name}`);
  }
  if (model.timeoutMs) {
    lines.push(`# @timeout ${model.timeoutMs}`);
  }
  lines.push('');

  const isGrpc = model.method?.toUpperCase() === 'GRPC';

  if (isGrpc) {
    const grpcCmdParts: string[] = ['grpcurl -plaintext'];

    // Headers
    const activeHeaders = model.headers.filter((h) => h.enabled && h.key.trim());
    for (const h of activeHeaders) {
      grpcCmdParts.push(`  -H "${h.key.trim()}: ${h.value.trim()}"`);
    }

    // Auth Header
    if (model.authType === 'bearer' && model.bearerToken.trim()) {
      grpcCmdParts.push(`  -H "Authorization: Bearer ${model.bearerToken.trim()}"`);
    } else if (model.authType === 'basic' && (model.basicUser || model.basicPass)) {
      grpcCmdParts.push(`  -u "${model.basicUser.trim()}:${model.basicPass.trim()}"`);
    }

    // Body
    if (model.bodyType === 'json' && model.bodyRaw.trim()) {
      const escaped = model.bodyRaw.replace(/'/g, "'\\''");
      grpcCmdParts.push(`  -d '${escaped}'`);
    } else if (model.bodyType === 'text' && model.bodyRaw.trim()) {
      const escaped = model.bodyRaw.replace(/'/g, "'\\''");
      grpcCmdParts.push(`  -d '${escaped}'`);
    }

    // Host & Endpoint
    const hostAndEndpoint = model.url.trim() || 'localhost:50051 api.v1.Service/Method';
    grpcCmdParts.push(`  ${hostAndEndpoint}`);

    return `${lines.join('\n')}${grpcCmdParts.join(' \\\n')}\n`;
  }

  // Rebuild full URL with enabled query params
  let fullUrl = model.url.trim();
  const enabledParams = model.params.filter((p) => p.enabled && p.key.trim());

  if (enabledParams.length > 0) {
    const queryParts = enabledParams.map(
      (p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`
    );
    const connector = fullUrl.includes('?') ? '&' : '?';
    fullUrl = `${fullUrl}${connector}${queryParts.join('&')}`;
  }

  // Base cURL command
  const curlCmdParts: string[] = [];
  const noBufferFlag = model.noBuffer ? '-N ' : '';
  curlCmdParts.push(`curl ${noBufferFlag}-X ${model.method} "${fullUrl || 'https://api.example.com'}"`);

  // Headers
  const activeHeaders = model.headers.filter((h) => h.enabled && h.key.trim());
  for (const h of activeHeaders) {
    curlCmdParts.push(`  -H "${h.key.trim()}: ${h.value.trim()}"`);
  }

  // Auth Header
  if (model.authType === 'bearer' && model.bearerToken.trim()) {
    curlCmdParts.push(`  -H "Authorization: Bearer ${model.bearerToken.trim()}"`);
  } else if (model.authType === 'basic' && (model.basicUser || model.basicPass)) {
    curlCmdParts.push(`  -u "${model.basicUser.trim()}:${model.basicPass.trim()}"`);
  }

  // Body
  if (model.bodyType === 'json' && model.bodyRaw.trim()) {
    if (!activeHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
      curlCmdParts.push(`  -H "Content-Type: application/json"`);
    }
    // Single line compact or escaped data
    const escaped = model.bodyRaw.replace(/'/g, "'\\''");
    curlCmdParts.push(`  -d '${escaped}'`);
  } else if (model.bodyType === 'urlencoded') {
    const activePairs = model.bodyUrlencoded.filter((p) => p.enabled && p.key.trim());
    if (activePairs.length > 0) {
      if (!activeHeaders.some((h) => h.key.toLowerCase() === 'content-type')) {
        curlCmdParts.push(`  -H "Content-Type: application/x-www-form-urlencoded"`);
      }
      const dataStr = activePairs
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
        .join('&');
      curlCmdParts.push(`  -d '${dataStr}'`);
    }
  } else if (model.bodyType === 'text' && model.bodyRaw.trim()) {
    const escaped = model.bodyRaw.replace(/'/g, "'\\''");
    curlCmdParts.push(`  -d '${escaped}'`);
  }

  return `${lines.join('\n')}${curlCmdParts.join(' \\\n')}\n`;
}
