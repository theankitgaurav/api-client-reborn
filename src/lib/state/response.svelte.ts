import { tick } from 'svelte';
import { cancelRequest, executeGrpcRequest, executeRequest, exportSpooledStream } from '../ipc';
import type { RequestHistoryEntry, ResponseChunk, TestResultItem } from '../types';
import { parseCurlToPlayground } from '../utils/curl-serializer';
import { parseGrpcRequest, resolveGrpcVariables } from '../utils/grpc';
import { runScript } from '../utils/script-runner';
import {
  MAX_BODY_TEXT_BYTES,
  MAX_STREAM_MESSAGES,
  type StreamItem,
} from '../utils/stream-buffer';
import { envState } from './env.svelte';
import { historyState } from './history.svelte';
import { workspaceState, type TabResponseData } from './workspace.svelte';

export { MAX_BODY_TEXT_BYTES, MAX_STREAM_MESSAGES, type StreamItem };

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

  isBodyTruncated = $state(false);
  totalEventsCount = $state(0);
  spoolFilePath = $state<string | null>(null);

  activeTab = $state<'body' | 'headers' | 'stream' | 'tests' | 'raw'>('body');
  testResults = $state<TestResultItem[]>([]);
  scriptLogs = $state<string[]>([]);

  private currentExecutingTabId: string | null = null;
  private currentHistoryEntry: RequestHistoryEntry | null = null;
  private historyRecordedForRequest = false;

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
      this.isStreaming = r.isStreaming ?? r.activeTab === 'stream';
      this.error = r.error;
      this.isBodyTruncated = r.isBodyTruncated ?? false;
      this.totalEventsCount = r.totalEventsCount ?? (r.streamMessages?.length || 0);
      this.spoolFilePath = r.spoolFilePath ?? null;
      this.activeTab = !this.isStreaming && r.activeTab === 'stream' ? 'body' : r.activeTab;
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

  private recordHistory(errorOverride?: string | null) {
    if (!this.currentHistoryEntry || this.historyRecordedForRequest) return;

    this.historyRecordedForRequest = true;
    const responseBody = this.bodyText || (
      this.streamMessages.length > 0
        ? JSON.stringify(this.streamMessages, null, 2)
        : ''
    );
    const entry: RequestHistoryEntry = {
      ...this.currentHistoryEntry,
      status: this.status,
      status_text: this.statusText,
      headers: this.headers,
      response_body: responseBody,
      duration_ms: this.durationMs,
      total_bytes: this.totalBytes,
      is_streaming: this.isStreaming,
      error: errorOverride ?? this.error,
    };

    void historyState.record(workspaceState.workspacePath, entry);
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
    const tab = workspaceState.activeTab;
    if (!tab) return;

    this.isExecuting = true;
    this.isStreaming = false;
    this.clear();
    this.currentExecutingTabId = tab.id;

    // Flush reactive state to the DOM so the Send button immediately
    // switches to Cancel (color change) before any synchronous work.
    await tick();

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
    if (tab.requestType === 'grpc') {
      const grpcConfig = resolveGrpcVariables(parseGrpcRequest(rawContent), envState.mergedVariables);
      this.currentHistoryEntry = {
        id: requestId,
        timestamp: new Date().toISOString(),
        request_name: grpcConfig.name || tab.name,
        request_path: tab.filePath,
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
      this.historyRecordedForRequest = false;
      try {
        await executeGrpcRequest(
          requestId,
          grpcConfig,
          workspaceState.workspacePath,
          (chunk: ResponseChunk) => this.handleChunk(chunk)
        );
      } catch (e: any) {
        this.error = e.toString();
        this.isExecuting = false;
        this.saveToActiveTab();
        this.recordHistory();
      }
      return;
    }

    const requestModel = parseCurlToPlayground(rawContent);
    this.currentHistoryEntry = {
      id: requestId,
      timestamp: new Date().toISOString(),
      request_name: tab.name,
      request_path: tab.filePath,
      method: tab.method,
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
    this.historyRecordedForRequest = false;

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
      this.recordHistory();
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
        this.durationMs = chunk.payload.total_duration_ms;
        this.totalBytes = chunk.payload.total_bytes;
        this.spoolFilePath = chunk.payload.spool_file_path || null;
        this.isExecuting = false;

        // 2. Run Post-response script (Tests) if present
        this.runPostResponseScript();
        this.saveToActiveTab();
        this.recordHistory(null);
        break;

      case 'Failed':
        this.error = chunk.payload.error;
        this.isExecuting = false;
        this.saveToActiveTab();
        this.recordHistory();
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
    if (this.activeRequestId && this.isExecuting) {
      await cancelRequest(this.activeRequestId);
      this.isExecuting = false;
      this.error = 'Request cancelled';
      this.saveToActiveTab();
      this.recordHistory(this.error);
    }
  }
}

export const responseState = new ResponseState();
