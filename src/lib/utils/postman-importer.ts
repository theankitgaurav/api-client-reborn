import type { SidecarMetadata } from '../types';

export interface PostmanImportItem {
  relativePath: string;
  content: string;
  name: string;
  sidecar?: SidecarMetadata;
}

export interface PostmanImportResult {
  collectionName: string;
  items: PostmanImportItem[];
  variables: [string, string][];
  totalRequests: number;
  totalFolders: number;
}

function sanitizeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'request';
}

function escapeHeaderValue(val: string): string {
  return val.replace(/"/g, '\\"');
}

/**
 * Converts a Postman request object into a valid cURL command with leading `# @directive` comments.
 */
function convertPostmanRequestToCurl(
  name: string,
  desc: string | undefined,
  request: any
): string {
  if (typeof request === 'string') {
    return `# @name ${name}\n\ncurl -X GET "${request}"`;
  }

  const method = (request.method || 'GET').toUpperCase();

  // Extract URL
  let rawUrl = '';
  if (typeof request.url === 'string') {
    rawUrl = request.url;
  } else if (request.url && typeof request.url === 'object') {
    rawUrl = request.url.raw || '';
    if (!rawUrl && Array.isArray(request.url.host)) {
      const proto = request.url.protocol ? `${request.url.protocol}://` : 'https://';
      const host = request.url.host.join('.');
      const path = Array.isArray(request.url.path) ? `/${request.url.path.join('/')}` : '';
      rawUrl = `${proto}${host}${path}`;
    }
  }

  if (!rawUrl) {
    rawUrl = 'https://httpbin.org/get';
  }

  const lines: string[] = [];
  lines.push(`# @name ${name}`);
  if (desc && desc.trim()) {
    lines.push(`# @description ${desc.trim().replace(/\r?\n/g, ' ')}`);
  }
  lines.push('');

  let curlParts: string[] = ['curl'];

  // HTTP Method
  curlParts.push(`-X ${method}`);

  // URL
  curlParts.push(`"${rawUrl}"`);

  // Headers
  const headers = Array.isArray(request.header) ? request.header : [];
  let hasContentType = false;
  let hasAuthHeader = false;

  for (const h of headers) {
    if (h && !h.disabled && h.key) {
      if (h.key.toLowerCase() === 'content-type') hasContentType = true;
      if (h.key.toLowerCase() === 'authorization') hasAuthHeader = true;
      curlParts.push(`-H "${h.key}: ${escapeHeaderValue(h.value ?? '')}"`);
    }
  }

  // Authentication handling
  if (request.auth && !hasAuthHeader) {
    const authType = request.auth.type;
    if (authType === 'bearer') {
      const bearerProps = Array.isArray(request.auth.bearer) ? request.auth.bearer : [];
      const tokenEntry = bearerProps.find((p: any) => p.key === 'token');
      const token = tokenEntry?.value || '';
      curlParts.push(`-H "Authorization: Bearer ${token}"`);
    } else if (authType === 'basic') {
      const basicProps = Array.isArray(request.auth.basic) ? request.auth.basic : [];
      const userEntry = basicProps.find((p: any) => p.key === 'username');
      const passEntry = basicProps.find((p: any) => p.key === 'password');
      const user = userEntry?.value || '';
      const pass = passEntry?.value || '';
      curlParts.push(`-u "${user}:${pass}"`);
    } else if (authType === 'apikey') {
      const apiProps = Array.isArray(request.auth.apikey) ? request.auth.apikey : [];
      const keyEntry = apiProps.find((p: any) => p.key === 'key');
      const valEntry = apiProps.find((p: any) => p.key === 'value');
      const inEntry = apiProps.find((p: any) => p.key === 'in');
      const headerKey = keyEntry?.value || 'X-API-Key';
      const headerVal = valEntry?.value || '';
      if (inEntry?.value === 'header' || !inEntry) {
        curlParts.push(`-H "${headerKey}: ${escapeHeaderValue(headerVal)}"`);
      }
    }
  }

  // Request Body
  if (request.body && method !== 'GET' && method !== 'HEAD') {
    const mode = request.body.mode;
    if (mode === 'raw') {
      const rawText = request.body.raw || '';
      const lang = request.body.options?.raw?.language;
      if ((lang === 'json' || rawText.trim().startsWith('{') || rawText.trim().startsWith('[')) && !hasContentType) {
        curlParts.push('-H "Content-Type: application/json"');
      }
      if (rawText) {
        curlParts.push(`-d '${rawText.replace(/'/g, "'\\''")}'`);
      }
    } else if (mode === 'urlencoded') {
      if (!hasContentType) {
        curlParts.push('-H "Content-Type: application/x-www-form-urlencoded"');
      }
      const params = Array.isArray(request.body.urlencoded) ? request.body.urlencoded : [];
      for (const p of params) {
        if (p && !p.disabled && p.key) {
          curlParts.push(`--data-urlencode "${p.key}=${escapeHeaderValue(p.value ?? '')}"`);
        }
      }
    } else if (mode === 'formdata') {
      const params = Array.isArray(request.body.formdata) ? request.body.formdata : [];
      for (const p of params) {
        if (p && !p.disabled && p.key) {
          curlParts.push(`-F "${p.key}=${escapeHeaderValue(p.value ?? '')}"`);
        }
      }
    }
  }

  // Format into multiline command
  if (curlParts.length <= 3) {
    lines.push(curlParts.join(' '));
  } else {
    const base = `${curlParts[0]} ${curlParts[1]} ${curlParts[2]}`;
    const flags = curlParts.slice(3).map((f) => `  ${f}`);
    lines.push([base, ...flags].join(' \\\n'));
  }

  return lines.join('\n');
}

/**
 * Extracts pre-request and test scripts from Postman event array.
 */
function extractSidecar(events: any[] | undefined): SidecarMetadata | undefined {
  if (!Array.isArray(events) || events.length === 0) return undefined;

  let preRequestScript: string | undefined;
  let postResponseScript: string | undefined;

  for (const ev of events) {
    if (!ev || !ev.script) continue;
    let code = '';
    if (Array.isArray(ev.script.exec)) {
      code = ev.script.exec.join('\n').trim();
    } else if (typeof ev.script.exec === 'string') {
      code = ev.script.exec.trim();
    }

    if (!code) continue;

    if (ev.listen === 'prerequest') {
      preRequestScript = code;
    } else if (ev.listen === 'test') {
      postResponseScript = code;
    }
  }

  if (!preRequestScript && !postResponseScript) return undefined;

  return {
    tests: [],
    pre_request_script: preRequestScript,
    post_response_script: postResponseScript,
  };
}

/**
 * Recursively walks Postman items (folders and requests) to build workspace files.
 */
function walkItems(
  items: any[],
  currentDir: string,
  usedFileNames: Set<string>,
  result: PostmanImportItem[],
  folderCount: { count: number }
) {
  for (const item of items) {
    if (!item) continue;

    // Folder check: item contains child `item` array
    if (Array.isArray(item.item)) {
      folderCount.count++;
      const folderName = sanitizeSlug(item.name || 'folder');
      const nextDir = currentDir ? `${currentDir}/${folderName}` : folderName;
      walkItems(item.item, nextDir, usedFileNames, result, folderCount);
    } else if (item.request) {
      // Leaf Request
      const reqName = item.name || 'Untitled Request';
      const baseSlug = sanitizeSlug(reqName);
      let fileName = `${baseSlug}.curl`;
      let fullPath = currentDir ? `${currentDir}/${fileName}` : fileName;

      let counter = 2;
      while (usedFileNames.has(fullPath)) {
        fileName = `${baseSlug}_${counter}.curl`;
        fullPath = currentDir ? `${currentDir}/${fileName}` : fileName;
        counter++;
      }
      usedFileNames.add(fullPath);

      const content = convertPostmanRequestToCurl(reqName, item.description, item.request);
      const sidecar = extractSidecar(item.event);

      result.push({
        relativePath: fullPath,
        content,
        name: reqName,
        sidecar,
      });
    }
  }
}

/**
 * Parses a Postman Collection JSON (v2.0 or v2.1) string into workspace files and environment variables.
 */
export function parsePostmanCollection(jsonString: string): PostmanImportResult {
  const parsed = JSON.parse(jsonString);

  const collectionName = parsed.info?.name || 'Imported Collection';
  const rootSlug = sanitizeSlug(collectionName);

  const variables: [string, string][] = [];
  if (Array.isArray(parsed.variable)) {
    for (const v of parsed.variable) {
      if (v && v.key && !v.disabled) {
        variables.push([String(v.key), String(v.value ?? '')]);
      }
    }
  }

  const items: PostmanImportItem[] = [];
  const usedFileNames = new Set<string>();
  const folderCount = { count: 0 };

  const rawItems = Array.isArray(parsed.item) ? parsed.item : [];
  walkItems(rawItems, rootSlug, usedFileNames, items, folderCount);

  return {
    collectionName,
    items,
    variables,
    totalRequests: items.length,
    totalFolders: folderCount.count,
  };
}
