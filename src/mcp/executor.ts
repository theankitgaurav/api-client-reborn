import crypto from 'node:crypto';
import { parseCurlToPlayground, type PlaygroundModel } from '../lib/utils/curl-serializer.ts';
import { runScript } from '../lib/utils/script-runner.ts';
import type { DetailedRequest } from './workspace.ts';

export interface ExecutionResult {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body: string;
  isJson: boolean;
  parsedJson?: any;
  tests: Array<{
    name: string;
    passed: boolean;
    error?: string;
  }>;
  logs: string[];
  error?: string;
}

/**
 * Replaces `{{variable}}` tokens and dynamic built-ins in the template string.
 */
export function interpolateVariables(template: string, variables: Record<string, string>): string {
  if (!template) return '';

  return template.replace(/\{\{([^}]+)\}\}/g, (match, rawToken) => {
    const token = rawToken.trim();

    if (token === '$uuid' || token === '$guid') {
      return crypto.randomUUID();
    }
    if (token === '$isoTimestamp') {
      return new Date().toISOString();
    }
    if (token === '$timestamp') {
      return Math.floor(Date.now() / 1000).toString();
    }
    if (token.startsWith('$randomInt(') && token.endsWith(')')) {
      const inner = token.substring(11, token.length - 1);
      const parts = inner.split(',').map((s: string) => s.trim());
      if (parts.length === 2) {
        const min = parseInt(parts[0], 10);
        const max = parseInt(parts[1], 10);
        if (!isNaN(min) && !isNaN(max) && min < max) {
          return String(Math.floor(Math.random() * (max - min + 1)) + min);
        }
      }
    }

    if (token in variables) {
      return variables[token];
    }

    return match;
  });
}

/**
 * Executes a parsed or ad-hoc request against target URL with variable injection and script runner.
 */
export async function executeHttpRequest(
  request: DetailedRequest | { rawContent: string; sidecar?: DetailedRequest['sidecar'] },
  variables: Record<string, string> = {},
  fetchFn: typeof fetch = globalThis.fetch
): Promise<ExecutionResult> {
  const currentVars = { ...variables };

  // 1. Interpolate variables into raw cURL command
  const resolvedCommand = interpolateVariables(request.rawContent, currentVars);

  // 2. Parse into structured playground model
  const model: PlaygroundModel = parseCurlToPlayground(resolvedCommand);

  // 3. Assemble target URL with query params
  let targetUrl = model.url.trim();
  if (!targetUrl) {
    throw new Error('Request has no valid target URL.');
  }

  // Ensure protocol
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'http://' + targetUrl;
  }

  const urlObj = new URL(targetUrl);
  for (const p of model.params) {
    if (p.enabled && p.key.trim()) {
      urlObj.searchParams.append(p.key.trim(), p.value);
    }
  }

  // 4. Headers setup
  const headerMap: Record<string, string> = {};
  for (const h of model.headers) {
    if (h.enabled && h.key.trim()) {
      headerMap[h.key.trim()] = h.value;
    }
  }

  // Auth headers
  if (model.authType === 'bearer' && model.bearerToken) {
    headerMap['Authorization'] = `Bearer ${model.bearerToken}`;
  } else if (model.authType === 'basic' && (model.basicUser || model.basicPass)) {
    const creds = Buffer.from(`${model.basicUser}:${model.basicPass}`).toString('base64');
    headerMap['Authorization'] = `Basic ${creds}`;
  }

  // Body setup
  let reqBody: string | undefined = undefined;
  const method = (model.method || 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    if (model.bodyType === 'json' || model.bodyType === 'text') {
      reqBody = model.bodyRaw;
      if (model.bodyType === 'json' && !headerMap['Content-Type'] && !headerMap['content-type']) {
        headerMap['Content-Type'] = 'application/json';
      }
    } else if (model.bodyType === 'urlencoded') {
      const searchParams = new URLSearchParams();
      for (const p of model.bodyUrlencoded) {
        if (p.enabled && p.key.trim()) searchParams.append(p.key.trim(), p.value);
      }
      reqBody = searchParams.toString();
      if (!headerMap['Content-Type'] && !headerMap['content-type']) {
        headerMap['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
  }

  const allLogs: string[] = [];

  // 5. Pre-request Script Execution (if sidecar has pre_request_script)
  if (request.sidecar?.pre_request_script?.trim()) {
    try {
      const scriptContext = {
        environment: currentVars,
        request: {
          url: urlObj.toString(),
          method,
          headers: Object.entries(headerMap).map(([k, v]) => ({ key: k, value: v })),
          body: reqBody,
        },
      };

      const preResult = runScript(request.sidecar.pre_request_script, scriptContext);
      if (preResult.updatedEnvironment) {
        Object.assign(currentVars, preResult.updatedEnvironment);
      }
      if (preResult.logs) {
        allLogs.push(...preResult.logs);
      }
    } catch (err: any) {
      allLogs.push(`[Pre-request error] ${err.message}`);
    }
  }

  // 6. Execute Request via Fetch
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), model.timeoutMs || 30000);

  let responseStatus = 0;
  let responseStatusText = '';
  let durationMs = 0;
  let responseHeaders: Record<string, string> = {};
  let responseText = '';
  let executionError: string | undefined = undefined;

  try {
    const res = await fetchFn(urlObj.toString(), {
      method,
      headers: headerMap,
      body: reqBody,
      signal: controller.signal,
    });

    durationMs = Math.round(performance.now() - startTime);
    responseStatus = res.status;
    responseStatusText = res.statusText;

    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    responseText = await res.text();
  } catch (err: any) {
    durationMs = Math.round(performance.now() - startTime);
    executionError = err.name === 'AbortError' ? `Request timed out after ${model.timeoutMs || 30000}ms` : err.message;
  } finally {
    clearTimeout(timeoutId);
  }

  // 7. Parse response as JSON if applicable
  let isJson = false;
  let parsedJson: any = undefined;
  if (responseText) {
    const trimmed = responseText.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsedJson = JSON.parse(trimmed);
        isJson = true;
      } catch {}
    }
  }

  // 8. Post-response Script Execution & Assertions
  const testResults: Array<{ name: string; passed: boolean; error?: string }> = [];

  if (request.sidecar?.post_response_script?.trim() && !executionError) {
    try {
      const scriptContext = {
        environment: currentVars,
        request: {
          url: urlObj.toString(),
          method,
          headers: Object.entries(headerMap).map(([k, v]) => ({ key: k, value: v })),
          body: reqBody,
        },
        response: {
          status: responseStatus,
          statusText: responseStatusText,
          headers: Object.entries(responseHeaders).map(([k, v]) => ({ key: k, value: v })),
          bodyText: responseText,
          durationMs,
        },
      };

      const postResult = runScript(request.sidecar.post_response_script, scriptContext);
      if (postResult.testResults) {
        for (const t of postResult.testResults) {
          testResults.push({
            name: t.name,
            passed: t.passed,
            error: t.error,
          });
        }
      }
      if (postResult.logs) {
        allLogs.push(...postResult.logs);
      }
    } catch (err: any) {
      allLogs.push(`[Post-response error] ${err.message}`);
    }
  }

  return {
    status: responseStatus,
    statusText: responseStatusText,
    durationMs,
    headers: responseHeaders,
    body: responseText,
    isJson,
    parsedJson,
    tests: testResults,
    logs: allLogs,
    error: executionError,
  };
}
