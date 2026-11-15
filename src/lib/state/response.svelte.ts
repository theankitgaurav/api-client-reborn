import { tick } from 'svelte';
import { cancelRequest, executeGrpcRequest, executeRequest, exportSpooledStream } from '../ipc';
import type { RequestHistoryEntry, ResponseChunk, TestResultItem } from '../types';
import { parseCurlToPlayground } from '../utils/curl-serializer';
import { parseGrpcRequest, resolveGrpcVariables } from '../utils/grpc.ts';
import { runScript } from '../utils/script-runner';
import {
  MAX_BODY_TEXT_BYTES,
  MAX_STREAM_MESSAGES,
  type StreamItem,
} from '../utils/stream-buffer';
import { envState } from './env.svelte';
import { historyState } from './history.svelte';
import { workspaceState, type TabResponseData, type TabItem } from './workspace.svelte';

export { MAX_BODY_TEXT_BYTES, MAX_STREAM_MESSAGES, type StreamItem };

type RequestTransport = {
  executeRequest: typeof executeRequest;
  executeGrpcRequest: typeof executeGrpcRequest;
  cancelRequest: typeof cancelRequest;
};

interface Execution {
  id: string;
  cancelled: boolean;
  registered: boolean;
  settled: boolean;
  cancelHistory: RequestHistoryEntry | null;
}

const defaultTransport: RequestTransport = { executeRequest, executeGrpcRequest, cancelRequest };

class TabResponseState {
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

  isBodyTruncated = $state(false);
  totalEventsCount = $state(0);
  spoolFilePath = $state<string | null>(null);

  activeTab = $state<'body' | 'headers' | 'stream' | 'tests' | 'raw'>('body');
  testResults = $state<TestResultItem[]>([]);
  scriptLogs = $state<string[]>([]);

  private currentHistoryEntry: RequestHistoryEntry | null = null;
  private historyRecordedForRequest = false;
  private currentRequestVariables: Record<string, string> = {};
  private execution: Execution | null = null;
  private retired = false;

  constructor(
    private tabId: string | null,
    private workspacePath: string,
    private transport: RequestTransport,
    response?: TabResponseData,
  ) {
    if (response) {
      const r = response;
      this.status = r.status;
      this.statusText = r.statusText;
      this.protocol = r.protocol;
      this.ttfbMs = r.ttfbMs;
      this.durationMs = r.durationMs;
      this.totalBytes = r.totalBytes;
      this.headers = r.headers;
      this.bodyText = r.bodyText;
      this.streamMessages = r.streamMessages;
      this.isStreaming = r.isStreaming ?? r.activeTab === 'stream';
      this.error = r.error;
      this.isBodyTruncated = r.isBodyTruncated ?? false;
      this.totalEventsCount = r.totalEventsCount ?? (r.streamMessages?.length || 0);
      this.spoolFilePath = r.spoolFilePath ?? null;
      this.activeTab = !this.isStreaming && r.activeTab === 'stream' ? 'body' : r.activeTab;
      this.testResults = r.testResults;
      this.scriptLogs = r.scriptLogs;
    }
  }

  private saveToTab() {
    if (this.retired) return;
    const tab = workspaceState.tabs.find((item) => item.id === this.tabId);
    if (!tab) return;
    tab.response = {
      status: this.status,
      statusText: this.statusText,
      protocol: this.protocol,
      ttfbMs: this.ttfbMs,
      durationMs: this.durationMs,
      totalBytes: this.totalBytes,
      headers: this.headers,
      bodyText: this.bodyText,
      streamMessages: this.streamMessages,
      isStreaming: this.isStreaming,
      error: this.error,
      isBodyTruncated: this.isBodyTruncated,
      totalEventsCount: this.totalEventsCount,
      spoolFilePath: this.spoolFilePath,
      activeTab: this.activeTab,
      testResults: this.testResults,
      scriptLogs: this.scriptLogs,
    };
  }

  private takeHistory(errorOverride?: string | null): RequestHistoryEntry | null {
    if (!this.currentHistoryEntry || this.historyRecordedForRequest) return null;

    this.historyRecordedForRequest = true;
    const responseBody = this.bodyText || (
      this.streamMessages.length > 0
        ? JSON.stringify(this.streamMessages, null, 2)
        : ''
    );
    return {
      ...this.currentHistoryEntry,
      status: this.status,
      status_text: this.statusText,
      headers: this.headers,
      response_body: responseBody,
      duration_ms: this.durationMs,
      total_bytes: this.totalBytes,
      is_streaming: this.isStreaming,
      response_file_path: this.isStreaming || this.isBodyTruncated ? this.spoolFilePath : null,
      is_body_truncated: this.isBodyTruncated,
      total_events_count: this.totalEventsCount,
      error: errorOverride ?? this.error,
    };
  }

  private recordHistory(errorOverride?: string | null) {
    const entry = this.takeHistory(errorOverride);
    if (entry) void historyState.record(this.workspacePath, entry);
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
    this.isStreaming = false;
    this.error = null;
    this.isBodyTruncated = false;
    this.totalEventsCount = 0;
    this.spoolFilePath = null;
    this.activeTab = 'body';
    this.testResults = [];
    this.scriptLogs = [];
  }

  async runCurrentRequest() {
    const tab = workspaceState.tabs.find((item) => item.id === this.tabId);
    if (!tab || this.isExecuting || this.retired) return;

    this.isExecuting = true;
    this.clear();
    this.currentHistoryEntry = null;
    this.historyRecordedForRequest = false;
    const execution: Execution = { id: crypto.randomUUID(), cancelled: false, registered: false, settled: false, cancelHistory: null };
    this.execution = execution;
    this.activeRequestId = execution.id;
    const rawContent = tab.rawContent;
    const requestTab = { ...tab };

    try {
      await tick();
      if (execution.cancelled) return;
      let requestVariables = await envState.variablesForRequest(requestTab.filePath);
      if (execution.cancelled) return;
      this.currentRequestVariables = requestVariables;

      if (requestTab.sidecar?.pre_request_script?.trim()) {
        const scriptResult = runScript(requestTab.sidecar.pre_request_script, {
          environment: requestVariables,
          request: {
            url: requestTab.filePath || '',
            method: requestTab.method,
            headers: [],
          },
        });

        if (scriptResult.logs.length > 0) {
          this.scriptLogs.push(...scriptResult.logs);
        }

        if (scriptResult.error) {
          this.scriptLogs.push(`[Pre-request Error] ${scriptResult.error}`);
        }

        for (const [k, v] of Object.entries(scriptResult.updatedEnvironment)) {
          if (requestVariables[k] !== v) {
            await envState.setVariable(k, v);
            if (execution.cancelled) return;
          }
        }
        requestVariables = await envState.variablesForRequest(requestTab.filePath);
        if (execution.cancelled) return;
        this.currentRequestVariables = requestVariables;
      }

      const requestId = execution.id;
      if (requestTab.requestType === 'grpc') {
        const grpcConfig = resolveGrpcVariables(parseGrpcRequest(rawContent), requestVariables);
        this.currentHistoryEntry = {
          id: requestId,
          timestamp: new Date().toISOString(),
          request_name: grpcConfig.name || requestTab.name,
          request_path: requestTab.filePath,
          method: [grpcConfig.service, grpcConfig.method].filter(Boolean).join('/'),
          url: grpcConfig.endpoint,
          raw_command: rawContent,
          status: null,
          status_text: '',
          headers: [],
          response_body: '',
          duration_ms: null,
          total_bytes: 0,
          is_streaming: false,
          error: null,
        };
        await this.transport.executeGrpcRequest(requestId, grpcConfig, this.workspacePath, (chunk) => this.handleChunk(execution, requestTab, chunk));
      } else {
        const requestModel = parseCurlToPlayground(rawContent);
        this.currentHistoryEntry = {
          id: requestId,
          timestamp: new Date().toISOString(),
          request_name: requestTab.name,
          request_path: requestTab.filePath,
          method: requestTab.method,
          url: requestModel.url,
          raw_command: rawContent,
          status: null,
          status_text: '',
          headers: [],
          response_body: '',
          duration_ms: null,
          total_bytes: 0,
          is_streaming: false,
          error: null,
        };
        await this.transport.executeRequest(requestId, rawContent, requestVariables, (chunk) => this.handleChunk(execution, requestTab, chunk));
      }
      execution.registered = true;
      if (execution.cancelled) await this.cancelBackend(execution);
    } catch (error) {
      if (execution.cancelled) {
        this.finishCancellation(execution, `Failed to start request: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (execution.settled || this.execution !== execution) return;
      execution.settled = true;
      this.error = error instanceof Error ? error.message : String(error);
      this.isExecuting = false;
      this.saveToTab();
      this.recordHistory();
    }
  }

  private handleChunk(execution: Execution, tab: TabItem, chunk: ResponseChunk) {
    if (execution.cancelled || execution.settled || this.execution !== execution || this.retired) return;
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
        this.totalBytes = chunk.payload.bytes_received;

        // Truncate in-memory body preview at MAX_BODY_TEXT_BYTES (2 MB)
        if (chunk.payload.text) {
          if (this.bodyText.length < MAX_BODY_TEXT_BYTES) {
            const remaining = MAX_BODY_TEXT_BYTES - this.bodyText.length;
            if (chunk.payload.text.length <= remaining) {
              this.bodyText += chunk.payload.text;
            } else {
              this.bodyText += chunk.payload.text.substring(0, remaining);
              this.isBodyTruncated = true;
            }
          } else {
            this.isBodyTruncated = true;
          }

          const raw = chunk.payload.text.trim();
          if (raw) {
            const lines = raw.split('\n').filter((l) => l.trim().length > 0);
            for (const line of lines) {
              this.totalEventsCount++;
              if (this.streamMessages.length >= MAX_STREAM_MESSAGES) {
                this.streamMessages.shift();
              }
              this.streamMessages.push({
                event: 'chunk',
                data: line,
                timestamp: new Date().toLocaleTimeString(),
                bytes: line.length,
              });
            }
          }
        }

        if (this.isStreaming && this.activeTab !== 'stream') {
          this.activeTab = 'stream';
        }
        break;
      }

      case 'SseChunk':
        this.totalEventsCount++;
        if (this.streamMessages.length >= MAX_STREAM_MESSAGES) {
          this.streamMessages.shift();
        }
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
        execution.settled = true;
        this.durationMs = chunk.payload.total_duration_ms;
        this.totalBytes = chunk.payload.total_bytes;
        this.spoolFilePath = chunk.payload.spool_file_path || null;
        this.isExecuting = false;

        // 2. Run Post-response script (Tests) if present
        this.runPostResponseScript(tab);
        this.saveToTab();
        this.recordHistory(null);
        break;

      case 'Failed':
        execution.settled = true;
        this.error = chunk.payload.error;
        this.isExecuting = false;
        this.saveToTab();
        this.recordHistory();
        break;
    }
  }

  private runPostResponseScript(tab: TabItem) {
    if (!tab || !tab.sidecar?.post_response_script?.trim()) return;

    const scriptResult = runScript(tab.sidecar.post_response_script, {
      environment: this.currentRequestVariables,
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
      if (this.currentRequestVariables[k] !== v) {
        this.currentRequestVariables[k] = v;
        envState.setVariable(k, v);
      }
    }

    // Auto-focus the Tests tab if tests were executed
    if (this.testResults.length > 0) {
      this.activeTab = 'tests';
    }
  }

  async exportStream(destinationPath: string): Promise<boolean> {
    if (!destinationPath.trim()) return false;

    if (!this.spoolFilePath) {
      // In browser fallback or if no spool file, trigger a blob download
      const blob = new Blob([this.bodyText], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = destinationPath.split(/[\/\\]/).pop() || 'stream_export.bin';
      a.click();
      URL.revokeObjectURL(url);
      return true;
    }

    try {
      await exportSpooledStream(this.spoolFilePath, destinationPath);
      return true;
    } catch (e) {
      console.error('Failed to export stream:', e);
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  async cancel() {
    const execution = this.execution;
    if (execution && this.isExecuting && !execution.cancelled) {
      execution.cancelled = true;
      this.isExecuting = false;
      this.error = 'Request cancelled';
      this.saveToTab();
      execution.cancelHistory = this.takeHistory(this.error);
      if (execution.registered) await this.cancelBackend(execution);
    }
  }

  private finishCancellation(execution: Execution, error?: string) {
    if (error) {
      console.error(error);
      if (!this.retired && this.execution === execution) {
        this.error = error;
        this.saveToTab();
      }
    }
    if (execution.cancelHistory) {
      void historyState.record(this.workspacePath, {
        ...execution.cancelHistory,
        error: error ?? execution.cancelHistory.error,
      });
      execution.cancelHistory = null;
    }
  }

  private async cancelBackend(execution: Execution) {
    try {
      const cancelled = await this.transport.cancelRequest(execution.id);
      if (!cancelled) throw new Error('Request is no longer registered');
    } catch (error) {
      this.finishCancellation(execution, `Failed to cancel request: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.finishCancellation(execution);
  }

  retire() {
    void this.cancel();
    this.retired = true;
  }
}

export class ResponseState {
  private contexts = $state<Record<string, TabResponseState>>({});
  private empty: TabResponseState;

  constructor(private transport: RequestTransport = defaultTransport) {
    this.empty = new TabResponseState(null, '', transport);
    workspaceState.onTabsRetired = (ids) => {
      for (const id of ids) {
        this.contexts[id]?.retire();
        delete this.contexts[id];
      }
    };
  }

  get current(): TabResponseState {
    const id = workspaceState.activeTabId;
    return (id && this.contexts[id]) || this.empty;
  }

  loadTab(tabId: string | null) {
    const tab = workspaceState.tabs.find((item) => item.id === tabId);
    if (tab && !this.contexts[tab.id]) {
      this.contexts[tab.id] = new TabResponseState(tab.id, workspaceState.workspacePath, this.transport, tab.response);
    }
  }

  async runCurrentRequest() {
    const tabId = workspaceState.activeTabId;
    this.loadTab(tabId);
    if (tabId) await this.contexts[tabId]?.runCurrentRequest();
  }

  async cancel() {
    await this.current.cancel();
  }
}

export const responseState = new ResponseState();
