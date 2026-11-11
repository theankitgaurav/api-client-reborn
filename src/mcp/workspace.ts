import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface RequestSummary {
  path: string; // Relative to workspace root, using forward slashes
  name: string;
  description?: string;
  type: 'http' | 'grpc';
  method: string;
  endpoint: string;
}

export interface DetailedRequest {
  path: string;
  name: string;
  description?: string;
  type: 'http' | 'grpc';
  method: string;
  endpoint: string;
  headers?: { key: string; value: string }[];
  params?: { key: string; value: string; enabled: boolean }[];
  body?: string;
  bodyType?: string;
  rawContent: string;
  sidecar?: {
    pre_request_script?: string;
    post_response_script?: string;
    tests?: Array<{ id: string; name: string; script: string }>;
  };
}

export interface EnvironmentSummary {
  name: string;
  fileName: string;
  variables: Record<string, string>; // Non-secret variables only
}

export const IGNORED_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'build',
  'src',
  'src-tauri',
  'docs',
  'gen',
  'icons',
  '.git',
  '.gemini',
  '.vscode',
  '.idea',
  '.svelte-kit',
  'tests',
  'cache',
]);

export class WorkspaceManager {
  public workspaceRoot: string;

  constructor(workspacePath?: string) {
    if (workspacePath && workspacePath.trim()) {
      this.workspaceRoot = path.resolve(workspacePath.trim());
    } else if (process.env.API_CLIENT_WORKSPACE_DIR?.trim()) {
      this.workspaceRoot = path.resolve(process.env.API_CLIENT_WORKSPACE_DIR.trim());
    } else {
      const home = os.homedir();
      const defaultDir = path.join(home, '.api-client-reborn');
      // If current working directory has .apiclient or collections or environments, prefer cwd
      const cwd = process.cwd();
      if (
        fs.existsSync(path.join(cwd, '.apiclient')) ||
        fs.existsSync(path.join(cwd, 'environments')) ||
        fs.existsSync(path.join(cwd, 'collections'))
      ) {
        this.workspaceRoot = cwd;
      } else if (fs.existsSync(defaultDir)) {
        this.workspaceRoot = defaultDir;
      } else {
        this.workspaceRoot = cwd;
      }
    }
  }

  /**
   * Resolves a relative path safely against the workspace root.
   * Throws if the path escapes workspace root.
   */
  public resolveSafePath(relPath: string): string {
    const absolute = path.resolve(this.workspaceRoot, relPath);
    const rel = path.relative(this.workspaceRoot, absolute);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Access denied: path '${relPath}' escapes workspace root.`);
    }
    return absolute;
  }

  /**
   * Lists all requests (.curl, .grpc) recursively in the workspace.
   */
  public listRequests(subfolder = ''): RequestSummary[] {
    const targetDir = subfolder ? this.resolveSafePath(subfolder) : this.workspaceRoot;
    if (!fs.existsSync(targetDir)) return [];

    const results: RequestSummary[] = [];
    this.scanDir(targetDir, results);
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }

  private scanDir(currentDir: string, results: RequestSummary[]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (IGNORED_DIRS.has(name) || (name.startsWith('.') && name !== '.apiclient')) {
        continue;
      }

      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        if (name === '.apiclient') continue; // Don't scan .apiclient as a collection folder
        this.scanDir(fullPath, results);
      } else if (entry.isFile()) {
        if (name.endsWith('.curl')) {
          const summary = this.parseCurlSummary(fullPath);
          if (summary) results.push(summary);
        } else if (name.endsWith('.grpc')) {
          const summary = this.parseGrpcSummary(fullPath);
          if (summary) results.push(summary);
        }
      }
    }
  }

  private parseCurlSummary(filePath: string): RequestSummary | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');
      const lines = content.split('\n');

      let name = path.basename(filePath, '.curl');
      let description: string | undefined;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('# @name ')) {
          name = trimmed.replace('# @name ', '').trim();
        } else if (trimmed.startsWith('# @description ')) {
          description = trimmed.replace('# @description ', '').trim();
        } else if (!trimmed.startsWith('#') && trimmed !== '') {
          break; // Stop at first non-comment line
        }
      }

      // Extract method and endpoint from curl line
      let method = 'GET';
      let endpoint = '';
      const methodMatch = content.match(/-X\s+([A-Z]+)/i);
      if (methodMatch) {
        method = methodMatch[1].toUpperCase();
      } else if (content.includes('-d ') || content.includes('--data')) {
        method = 'POST';
      }

      const urlMatch = content.match(/curl(?:\s+-[A-Za-z0-9_-]+(?:\s+[^\s"']+)?)*\s+["']?([^"'\s\\]+)["']?/);
      if (urlMatch) {
        endpoint = urlMatch[1];
      }

      return {
        path: relPath,
        name,
        description,
        type: 'http',
        method,
        endpoint,
      };
    } catch {
      return null;
    }
  }

  private parseGrpcSummary(filePath: string): RequestSummary | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      const relPath = path.relative(this.workspaceRoot, filePath).replace(/\\/g, '/');

      return {
        path: relPath,
        name: parsed.name || path.basename(filePath, '.grpc'),
        description: parsed.description,
        type: 'grpc',
        method: parsed.method ? `${parsed.service || ''}/${parsed.method}` : 'gRPC',
        endpoint: parsed.endpoint || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Retrieves full request details and companion sidecar.
   */
  public getRequest(relPath: string): DetailedRequest {
    const fullPath = this.resolveSafePath(relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Request file not found: ${relPath}`);
    }

    const rawContent = fs.readFileSync(fullPath, 'utf-8');
    const isGrpc = fullPath.endsWith('.grpc');

    let sidecar: DetailedRequest['sidecar'] = undefined;
    const metaPath = fullPath.replace(/\.(curl|grpc)$/, '.meta.json');
    const sidecarPath = fullPath.replace(/\.(curl|grpc)$/, '.sidecar.json');
    const targetSidecar = fs.existsSync(metaPath) ? metaPath : fs.existsSync(sidecarPath) ? sidecarPath : null;

    if (targetSidecar) {
      try {
        const sidecarContent = fs.readFileSync(targetSidecar, 'utf-8');
        sidecar = JSON.parse(sidecarContent);
      } catch {
        // Ignore unparseable sidecar
      }
    }

    if (isGrpc) {
      const parsed = JSON.parse(rawContent);
      return {
        path: relPath.replace(/\\/g, '/'),
        name: parsed.name || path.basename(fullPath, '.grpc'),
        description: parsed.description,
        type: 'grpc',
        method: parsed.method ? `${parsed.service || ''}/${parsed.method}` : 'gRPC',
        endpoint: parsed.endpoint || '',
        body: parsed.request_json,
        rawContent,
        sidecar,
      };
    }

    // HTTP / cURL file
    const lines = rawContent.split('\n');
    let name = path.basename(fullPath, '.curl');
    let description: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# @name ')) {
        name = trimmed.replace('# @name ', '').trim();
      } else if (trimmed.startsWith('# @description ')) {
        description = trimmed.replace('# @description ', '').trim();
      }
    }

    // Extract basic properties
    let method = 'GET';
    const methodMatch = rawContent.match(/-X\s+([A-Z]+)/i);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
    } else if (rawContent.includes('-d ') || rawContent.includes('--data')) {
      method = 'POST';
    }

    let endpoint = '';
    const urlMatch = rawContent.match(/curl(?:\s+-[A-Za-z0-9_-]+(?:\s+[^\s"']+)?)*\s+["']?([^"'\s\\]+)["']?/);
    if (urlMatch) {
      endpoint = urlMatch[1];
    }

    return {
      path: relPath.replace(/\\/g, '/'),
      name,
      description,
      type: 'http',
      method,
      endpoint,
      rawContent,
      sidecar,
    };
  }

  /**
   * Saves or updates a request file and companion sidecar.
   */
  public saveRequest(
    relPath: string,
    content: string,
    name?: string,
    description?: string,
    sidecar?: DetailedRequest['sidecar']
  ): { path: string; fullPath: string } {
    let sanitizedRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!sanitizedRel.endsWith('.curl') && !sanitizedRel.endsWith('.grpc')) {
      sanitizedRel += '.curl';
    }

    const fullPath = this.resolveSafePath(sanitizedRel);
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    let finalContent = content;
    if (sanitizedRel.endsWith('.curl')) {
      // Ensure or update # @name and # @description directives
      if (name || description) {
        const lines = content.split('\n');
        const directives: string[] = [];
        const bodyLines: string[] = [];
        let inDirectives = true;

        for (const line of lines) {
          if (inDirectives && (line.startsWith('# @') || line.trim() === '')) {
            if (line.startsWith('# @name ') && name) continue;
            if (line.startsWith('# @description ') && description) continue;
            directives.push(line);
          } else {
            inDirectives = false;
            bodyLines.push(line);
          }
        }

        const newDirectives: string[] = [];
        if (name) newDirectives.push(`# @name ${name}`);
        if (description) newDirectives.push(`# @description ${description}`);
        for (const d of directives) {
          if (d.trim()) newDirectives.push(d);
        }

        finalContent = `${newDirectives.join('\n')}\n\n${bodyLines.join('\n').trimStart()}`;
      }
    }

    fs.writeFileSync(fullPath, finalContent, 'utf-8');

    // Write companion sidecar if specified
    if (sidecar && (sidecar.pre_request_script || sidecar.post_response_script || (sidecar.tests && sidecar.tests.length > 0))) {
      const metaPath = fullPath.replace(/\.(curl|grpc)$/, '.meta.json');
      fs.writeFileSync(metaPath, JSON.stringify(sidecar, null, 2), 'utf-8');
    }

    return {
      path: sanitizedRel,
      fullPath,
    };
  }

  /**
   * Lists available environment configurations under `environments/*.env.json`.
   */
  public listEnvironments(): EnvironmentSummary[] {
    const envDir = path.join(this.workspaceRoot, 'environments');
    if (!fs.existsSync(envDir)) return [];

    const summaries: EnvironmentSummary[] = [];
    try {
      const files = fs.readdirSync(envDir);
      for (const file of files) {
        if (!file.endsWith('.env.json')) continue;
        const fullPath = path.join(envDir, file);
        try {
          const raw = fs.readFileSync(fullPath, 'utf-8');
          const parsed = JSON.parse(raw);
          const name = file.replace('.env.json', '');
          const variables: Record<string, string> = {};

          for (const [k, v] of Object.entries(parsed)) {
            // Mask secrets if marked or contains secret-like keys
            const isSecret = /token|secret|password|key|auth|bearer/i.test(k);
            variables[k] = isSecret ? '***' : String(v);
          }

          summaries.push({
            name,
            fileName: file,
            variables,
          });
        } catch {
          // Ignore unparseable env file
        }
      }
    } catch {
      // Ignore
    }

    return summaries;
  }

  /**
   * Resolves all variables for a given request execution.
   * Priority: Workspace variables < Selected Environment < Collection variables < Overrides < Secrets.
   */
  public resolveVariables(
    requestPath?: string,
    environmentName?: string,
    overrides: Record<string, string> = {}
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    // 1. Workspace default variables (if workspace.env.json exists)
    const wsEnv = path.join(this.workspaceRoot, 'workspace.env.json');
    if (fs.existsSync(wsEnv)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(wsEnv, 'utf-8'));
        Object.assign(resolved, parsed);
      } catch {}
    }

    // 2. Selected environment file (environments/<environmentName>.env.json)
    if (environmentName) {
      const candidatePaths = [
        path.join(this.workspaceRoot, 'environments', `${environmentName}.env.json`),
        path.join(this.workspaceRoot, 'environments', `${environmentName.toLowerCase()}.env.json`),
      ];
      for (const cand of candidatePaths) {
        if (fs.existsSync(cand)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(cand, 'utf-8'));
            Object.assign(resolved, parsed);
            break;
          } catch {}
        }
      }
    }

    // 3. Collection variables (check parent folders for .apiclient/collection_variables.json)
    if (requestPath) {
      try {
        const fullRequest = this.resolveSafePath(requestPath);
        let currDir = path.dirname(fullRequest);
        while (currDir.startsWith(this.workspaceRoot) && currDir !== this.workspaceRoot) {
          const collVarsPath = path.join(currDir, '.apiclient', 'collection_variables.json');
          if (fs.existsSync(collVarsPath)) {
            const parsed = JSON.parse(fs.readFileSync(collVarsPath, 'utf-8'));
            if (parsed.public_vars) Object.assign(resolved, parsed.public_vars);
            if (parsed.secret_vars) Object.assign(resolved, parsed.secret_vars);
            break;
          }
          currDir = path.dirname(currDir);
        }
      } catch {}
    }

    // 4. Secret variables from .apiclient/.secrets.json (used internally for execution)
    const secretsPath = path.join(this.workspaceRoot, '.apiclient', '.secrets.json');
    if (fs.existsSync(secretsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
        Object.assign(resolved, parsed);
      } catch {}
    }

    // 5. Explicit overrides passed in tool call
    Object.assign(resolved, overrides);

    return resolved;
  }
}
