import type { GrpcRequestConfig } from '../types';
import { parseGrpcurlCommand } from './grpcurl-importer.ts';

export function createDefaultGrpcRequest(name = 'New gRPC Request'): GrpcRequestConfig {
  return {
    name,
    endpoint: 'http://127.0.0.1:50051',
    service: '',
    method: '',
    request_json: '{\n  \n}',
    metadata: [],
    proto_file: null,
    use_reflection: true,
    tls_enabled: false,
    tls_insecure: false,
    tls_ca_file: null,
    timeout_ms: 30_000,
  };
}

export function parseGrpcRequest(rawContent: string): GrpcRequestConfig {
  const trimmed = rawContent.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawContent) as Partial<GrpcRequestConfig>;
      return {
        ...createDefaultGrpcRequest(),
        ...parsed,
        metadata: Array.isArray(parsed.metadata) ? parsed.metadata : [],
      };
    } catch {
      return createDefaultGrpcRequest();
    }
  }

  try {
    const result = parseGrpcurlCommand(rawContent);
    return result.config;
  } catch {
    return createDefaultGrpcRequest();
  }
}

export function serializeGrpcRequest(config: GrpcRequestConfig): string {
  const lines: string[] = [];

  if (config.name?.trim()) {
    lines.push(`# @name ${config.name.trim()}`);
  }
  if (config.timeout_ms) {
    lines.push(`# @timeout ${config.timeout_ms}`);
  }
  lines.push('');

  const commandParts: string[] = [];
  let prefix = '';

  let requestData = config.request_json.trim() || '{}';
  try {
    const value = JSON.parse(requestData);
    if (Array.isArray(value)) {
      prefix = `printf '%s\\n' ${value.map((item) => shellQuote(JSON.stringify(item))).join(' ')} | `;
      requestData = '@';
    }
  } catch {
    // Keep as is for unparseable or variable-laden JSON
  }

  commandParts.push(`${prefix}grpcurl`);

  if (!config.tls_enabled) {
    commandParts.push('  -plaintext');
  } else if (config.tls_insecure) {
    commandParts.push('  -insecure');
  }

  if (config.tls_enabled && config.tls_ca_file?.trim()) {
    commandParts.push(`  -cacert ${shellQuote(config.tls_ca_file.trim())}`);
  }

  if (config.proto_file?.trim()) {
    const protoFile = config.proto_file.trim();
    const slash = Math.max(protoFile.lastIndexOf('/'), protoFile.lastIndexOf('\\'));
    if (slash >= 0) {
      commandParts.push(`  -import-path ${shellQuote(protoFile.slice(0, slash) || '/')}`);
    }
    commandParts.push(`  -proto ${shellQuote(protoFile.slice(slash + 1))}`);
  }

  for (const item of config.metadata) {
    if (item.key.trim()) {
      commandParts.push(`  -H ${shellQuote(`${item.key.trim()}: ${item.value}`)}`);
    }
  }

  commandParts.push(`  -d ${shellQuote(requestData)}`);

  const target = (config.endpoint.trim() || 'localhost:50051').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  commandParts.push(`  ${shellQuote(target)}`);

  const service = config.service?.trim() || '';
  const method = config.method?.trim() || '';
  const serviceMethod = service && method ? `${service}/${method}` : (service || method || 'Service/Method');
  commandParts.push(`  ${shellQuote(serviceMethod)}`);

  return `${lines.join('\n')}${commandParts.join(' \\\n')}\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function toGrpcurl(config: GrpcRequestConfig): string {
  const args = ['grpcurl'];
  if (!config.tls_enabled) args.push('-plaintext');
  else if (config.tls_insecure) args.push('-insecure');
  if (config.tls_enabled && config.tls_ca_file?.trim()) {
    args.push('-cacert', shellQuote(config.tls_ca_file.trim()));
  }
  if (config.proto_file?.trim()) {
    const protoFile = config.proto_file.trim();
    const slash = Math.max(protoFile.lastIndexOf('/'), protoFile.lastIndexOf('\\'));
    if (slash >= 0) args.push('-import-path', shellQuote(protoFile.slice(0, slash) || '/'));
    args.push('-proto', shellQuote(protoFile.slice(slash + 1)));
  }
  for (const item of config.metadata) {
    if (item.key.trim()) args.push('-H', shellQuote(`${item.key.trim()}: ${item.value}`));
  }

  let requestData = config.request_json.trim() || '{}';
  let prefix = '';
  try {
    const value = JSON.parse(requestData);
    if (Array.isArray(value)) {
      prefix = `printf '%s\\n' ${value.map((item) => shellQuote(JSON.stringify(item))).join(' ')} | `;
      requestData = '@';
    }
  } catch {
    // Leave invalid JSON visible in the generated command so the user can correct it.
  }
  args.push('-d', shellQuote(requestData));
  const target = (config.endpoint.trim() || 'localhost:50051').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  args.push(shellQuote(target));
  args.push(shellQuote(`${config.service.trim()}/${config.method.trim()}`));
  return prefix + args.join(' ');
}

export function resolveGrpcVariables(
  config: GrpcRequestConfig,
  variables: Record<string, string>
): GrpcRequestConfig {
  const resolve = (value: string) => value.replace(/\{\{([^}]+)\}\}/g, (match, name: string) => {
    const key = name.trim();
    if (key === '$uuid') return crypto.randomUUID();
    if (key === '$isoTimestamp') return new Date().toISOString();
    if (key === '$timestamp') return Math.floor(Date.now() / 1000).toString();
    return variables[key] ?? match;
  });
  return {
    ...config,
    endpoint: resolve(config.endpoint),
    service: resolve(config.service),
    method: resolve(config.method),
    request_json: resolve(config.request_json),
    metadata: config.metadata.map((pair) => ({ key: resolve(pair.key), value: resolve(pair.value) })),
  };
}
