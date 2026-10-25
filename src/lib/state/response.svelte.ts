import { cancelRequest, executeRequest } from '../ipc';
import type { ResponseChunk, TestResultItem } from '../types';
import { runScript } from '../utils/script-runner';
import { envState } from './env.svelte';
import { workspaceState, type TabResponseData } from './workspace.svelte';

export interface StreamItem {
  id?: string;
  event?: string;
  data: string;
  timestamp: string;
  bytes?: number;
}

export class ResponseState {
  isExecuting = $state(false);
  isStreaming = $state(false);
  activeRequestId = $state<string | null>(null);

  status = $state<number | null>(null);
  statusText = $state<string>('');
  protocol = $state<string>('');
  ttfbMs = $state<number | null>(null);
  durationMs = $state<number | null>(null);
  totalBytes = $state<number>(0);

  headers = $state<{ key: string; value: string }[]>([]);
  bodyText = $state<string>('');
  streamMessages = $state<StreamItem[]>([]);
  error = $state<string | null>(null);

  activeTab = $state<'body' | 'headers' | 'stream' | 'tests' | 'raw'>('body');
  testResults = $state<TestResultItem[]>([]);
  scriptLogs = $state<string[]>([]);

  private currentExecutingTabId: string | null = null;

  // Sync state whenever the active tab in workspace changes
  loadTab(tabId: string | null) {
    if (!tabId) {
      this.clear();
      return;
    }
    const tab = workspaceState.tabs.find((t) => t.id === tabId);
    if (tab && tab.response) {
      const r = tab.response;
      this.status = r.status;
      this.statusText = r.statusText;
      this.protocol = r.protocol;
      this.ttfbMs = r.ttfbMs;
      this.durationMs = r.durationMs;
      this.totalBytes = r.totalBytes;
      this.headers = r.headers;
      this.bodyText = r.bodyText;
      this.streamMessages = r.streamMessages;
      this.error = r.error;
      this.activeTab = r.activeTab;
      this.testResults = r.testResults;
      this.scriptLogs = r.scriptLogs;
    } else if (tab && !this.isExecuting) {
      this.clear();
    }
  }

  private saveToActiveTab() {
    if (!workspaceState.activeTab) return;
    workspaceState.activeTab.response = {
      status: this.status,
      statusText: this.statusText,
      protocol: this.protocol,
      ttfbMs: this.ttfbMs,
      durationMs: this.durationMs,
      totalBytes: this.totalBytes,
      headers: this.headers,
      bodyText: this.bodyText,
      streamMessages: this.streamMessages,
      error: this.error,
      activeTab: this.activeTab,
      testResults: this.testResults,
      scriptLogs: this.scriptLogs,
    };
  }

  private clear() {
    this.status = null;
    this.statusText = '';
    this.protocol = '';
    this.ttfbMs = null;
    this.durationMs = null;
    this.totalBytes = 0;
    this.headers = [];
    this.bodyText = '';
    this.streamMessages = [];
    this.error = null;
    this.activeTab = 'body';
    this.testResults = [];
    this.scriptLogs = [];
  }

  async runCurrentRequest() {
    const tab = workspaceState.activeTab;
    if (!tab) return;

    this.isExecuting = true;
    this.isStreaming = false;
    this.clear();
    this.currentExecutingTabId = tab.id;

    // 1. Run Pre-request script if present
    let rawContent = tab.rawContent;
    if (tab.sidecar?.pre_request_script?.trim()) {
      const scriptResult = runScript(tab.sidecar.pre_request_script, {
        environment: envState.mergedVariables,
        request: {
          url: tab.filePath || '',
          method: tab.method,
          headers: [],
        },
      });

      if (scriptResult.logs.length > 0) {
        this.scriptLogs.push(...scriptResult.logs);
      }

      if (scriptResult.error) {
        this.scriptLogs.push(`[Pre-request Error] ${scriptResult.error}`);
      }

      // Sync modified environment variables
      for (const [k, v] of Object.entries(scriptResult.updatedEnvironment)) {
        if (envState.mergedVariables[k] !== v) {
          envState.setVariable(k, v);
        }
      }
    }

    const requestId = crypto.randomUUID();
    this.activeRequestId = requestId;

    try {
      await executeRequest(
        requestId,
        rawContent,
        envState.mergedVariables,
        (chunk: ResponseChunk) => {
          this.handleChunk(chunk);
        }
      );
    } catch (e: any) {
      this.error = e.toString();
      this.isExecuting = false;
      this.saveToActiveTab();
    }
  }

  handleChunk(chunk: ResponseChunk) {
    switch (chunk.type) {
      case 'HeaderReceived':
        this.status = chunk.payload.status;
        this.statusText = chunk.payload.status_text;
        this.headers = chunk.payload.headers;
        this.protocol = chunk.payload.protocol;
        this.ttfbMs = chunk.payload.ttfb_ms;
        this.isStreaming = chunk.payload.is_streaming;

        if (this.isStreaming) {
          this.activeTab = 'stream';
        }
        break;

      case 'BodyChunk': {
        this.bodyText += chunk.payload.text;
        this.totalBytes = chunk.payload.bytes_received;

        const raw = chunk.payload.text.trim();
        if (raw) {
          const lines = raw.split('\n').filter((l) => l.trim().length > 0);
          for (const line of lines) {
            this.streamMessages.push({
              event: 'chunk',
              data: line,
              timestamp: new Date().toLocaleTimeString(),
              bytes: line.length,
            });
          }
        }

        if (this.isStreaming && this.activeTab !== 'stream') {
          this.activeTab = 'stream';
        }
        break;
      }

      case 'SseChunk':
        this.streamMessages.push({
          id: chunk.payload.id,
          event: chunk.payload.event || 'message',
          data: chunk.payload.data,
          timestamp: new Date().toLocaleTimeString(),
          bytes: chunk.payload.data.length,
        });
        if (this.activeTab !== 'stream') {
          this.activeTab = 'stream';
        }
        break;

      case 'Finished':
        this.durationMs = chunk.payload.total_duration_ms;
        this.totalBytes = chunk.payload.total_bytes;
        this.isExecuting = false;

        // 2. Run Post-response script (Tests) if present
        this.runPostResponseScript();
        this.saveToActiveTab();
        break;

      case 'Failed':
        this.error = chunk.payload.error;
        this.isExecuting = false;
        this.saveToActiveTab();
        break;
    }
  }

  private runPostResponseScript() {
    const tab = workspaceState.activeTab;
    if (!tab || !tab.sidecar?.post_response_script?.trim()) return;

    const scriptResult = runScript(tab.sidecar.post_response_script, {
      environment: envState.mergedVariables,
      request: {
        url: tab.filePath || '',
        method: tab.method,
        headers: [],
      },
      response: {
        status: this.status || 0,
        statusText: this.statusText || '',
        headers: this.headers,
        bodyText: this.bodyText,
        durationMs: this.durationMs || 0,
      },
    });

    this.testResults = scriptResult.testResults;
    if (scriptResult.logs.length > 0) {
      this.scriptLogs.push(...scriptResult.logs);
    }
    if (scriptResult.error) {
      this.scriptLogs.push(`[Post-response Error] ${scriptResult.error}`);
    }

    // Sync modified variables
    for (const [k, v] of Object.entries(scriptResult.updatedEnvironment)) {
      if (envState.mergedVariables[k] !== v) {
        envState.setVariable(k, v);
      }
    }

    // Auto-focus the Tests tab if tests were executed
    if (this.testResults.length > 0) {
      this.activeTab = 'tests';
    }
  }

  async cancel() {
    if (this.activeRequestId && this.isExecuting) {
      await cancelRequest(this.activeRequestId);
      this.isExecuting = false;
      this.saveToActiveTab();
    }
  }
}

export const responseState = new ResponseState();
