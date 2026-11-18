import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const { workspaceState } = await server.ssrLoadModule('/src/lib/state/workspace.svelte.ts');
const { ResponseState } = await server.ssrLoadModule('/src/lib/state/response.svelte.ts');
const { envState } = await server.ssrLoadModule('/src/lib/state/env.svelte.ts');
const { historyState, HistoryState } = await server.ssrLoadModule('/src/lib/state/history.svelte.ts');
const { createDefaultGrpcRequest, serializeGrpcRequest } = await server.ssrLoadModule('/src/lib/utils/grpc.ts');
const { readRequestFile, saveRequestFile } = await server.ssrLoadModule('/src/lib/ipc.ts');
await workspaceState.refreshTree();

const originalVariables = envState.variablesForRequest;
const originalRecord = historyState.record;
after(async () => {
  envState.variablesForRequest = originalVariables;
  historyState.record = originalRecord;
  await server.close();
});

function tab(id, requestType = 'http', sidecar) {
  return {
    id,
    filePath: null,
    name: id,
    method: requestType === 'grpc' ? 'gRPC' : 'GET',
    requestType,
    rawContent: requestType === 'grpc'
      ? serializeGrpcRequest({ ...createDefaultGrpcRequest(), name: id })
      : `curl https://example.com/${id}`,
    isDirty: false,
    isPinned: true,
    sidecar,
  };
}

async function setup(tabs, options = {}) {
  workspaceState.onTabsRetired?.(workspaceState.tabs.map((item) => item.id));
  await new Promise((resolve) => setImmediate(resolve));
  workspaceState.workspacePath = '/test-workspace';
  workspaceState.tabs = tabs;
  workspaceState.activeTabId = tabs[0]?.id ?? null;
  envState.variablesForRequest = async () => ({});
  const history = [];
  historyState.record = async (path, entry) => { history.push({ path, entry }); };
  const calls = new Map();
  const cancelled = [];
  const register = (id, onChunk) => {
    calls.set(id, onChunk);
    return options.register ? options.register(id) : Promise.resolve();
  };
  const state = new ResponseState({
    executeRequest: (id, _content, _variables, onChunk) => register(id, onChunk),
    executeGrpcRequest: (id, _config, _workspace, onChunk) => register(id, onChunk),
    cancelRequest: async (id) => {
      cancelled.push(id);
      return options.cancel ? options.cancel(id) : true;
    },
  });
  return { state, calls, cancelled, history };
}

function header(status, streaming = false) {
  return { type: 'HeaderReceived', payload: { status, status_text: 'OK', headers: [], protocol: 'HTTP/2', ttfb_ms: 1, is_streaming: streaming } };
}

function body(text) {
  return { type: 'BodyChunk', payload: { text, bytes_received: text.length } };
}

function finished(text) {
  return { type: 'Finished', payload: { total_duration_ms: 5, total_bytes: text.length } };
}

test('saving only the HTTP name preserves pending request and sidecar changes', async () => {
  const path = `name-${crypto.randomUUID()}.curl`;
  const saved = '# @name Old name\ncurl https://example.com/saved';
  await saveRequestFile(path, saved, { name: 'Old name', tests: [], pre_request_script: 'saved' });
  const request = { ...tab('http-name'), filePath: path, name: 'Old name', rawContent: saved,
    sidecar: { name: 'Old name', tests: [], pre_request_script: 'saved' } };
  await setup([request]);
  workspaceState.updateContent('# @name Old name\ncurl https://example.com/unsaved', 'GET', 'Old name');
  workspaceState.activeTab.sidecar.pre_request_script = 'unsaved';
  workspaceState.updateContent('# @name New name\ncurl https://example.com/unsaved', 'GET', 'New name', true);
  assert.equal(await workspaceState.saveActiveRequestName(), true);
  const stored = await readRequestFile(path);
  assert.equal(stored.raw_content, '# @name New name\ncurl https://example.com/saved');
  assert.equal(stored.sidecar.name, 'New name');
  assert.equal(stored.sidecar.pre_request_script, 'saved');
  assert.equal(workspaceState.activeTab.sidecar.pre_request_script, 'unsaved');
  assert.equal(workspaceState.activeTab.isDirty, true);
});

test('saving a name-only edit clears dirty state without affecting a tab switched during save', async () => {
  const path = `name-only-${crypto.randomUUID()}.curl`;
  const saved = '# @name Old\ncurl https://example.com';
  await saveRequestFile(path, saved, { name: 'Old', tests: [] });
  await setup([{ ...tab('first'), filePath: path, name: 'Old', rawContent: saved,
    sidecar: { name: 'Old', tests: [] } }, tab('second')]);
  workspaceState.updateContent('# @name New name\ncurl https://example.com', 'GET', 'New name', true);
  const saving = workspaceState.saveActiveRequestName();
  workspaceState.activeTabId = 'second';
  await saving;
  assert.equal((await readRequestFile(path)).raw_content, '# @name New name\ncurl https://example.com');
  assert.equal(workspaceState.tabs[0].isDirty, false);
  assert.equal(workspaceState.tabs[0].sidecar.name, 'New name');
  assert.equal(workspaceState.activeTab.name, 'second');
});

test('gRPC name-only save preserves JSON fields and draft names remain unsaved', async () => {
  const path = `name-${crypto.randomUUID()}.grpc`;
  const saved = JSON.stringify({ name: 'Old', endpoint: 'saved', custom: { keep: true } });
  await saveRequestFile(path, saved);
  await setup([{ ...tab('grpc-name', 'grpc'), filePath: path, name: 'Old', rawContent: saved, isDirty: true }]);
  workspaceState.updateContent('# @name Renamed service\ngrpcurl unsaved', 'gRPC', 'Renamed service', true);
  assert.equal(await workspaceState.saveActiveRequestName(), true);
  assert.deepEqual(JSON.parse((await readRequestFile(path)).raw_content),
    { name: 'Renamed service', endpoint: 'saved', custom: { keep: true } });
  assert.equal(workspaceState.activeTab.isDirty, true);
  await setup([tab('draft', 'grpc')]);
  workspaceState.updateContent('# @name Draft service\ngrpcurl localhost', 'gRPC', 'Draft service', true);
  assert.equal(await workspaceState.saveActiveRequestName(), true);
  assert.equal(workspaceState.activeTab.name, 'Draft service');
  assert.equal(workspaceState.activeTab.filePath, null);
  assert.equal(workspaceState.isSaveModalOpen, false);
});

test('name save reports failure without clearing the pending edit', async () => {
  const path = `invalid-${crypto.randomUUID()}.grpc`;
  await saveRequestFile(path, '{invalid JSON');
  await setup([{ ...tab('invalid-name', 'grpc'), filePath: path, name: 'Old', rawContent: '{invalid JSON' }]);
  workspaceState.updateContent('# @name New\ngrpcurl localhost example.Service/Method', 'gRPC', 'New', true);
  const originalAlert = globalThis.alert;
  const originalError = console.error;
  const messages = [];
  globalThis.alert = (message) => messages.push(message);
  console.error = () => {};
  try {
    assert.equal(await workspaceState.saveActiveRequestName(), false);
    assert.equal(workspaceState.activeTab.isDirty, true);
    assert.match(messages[0], /Failed to save request name/);
  } finally {
    globalThis.alert = originalAlert;
    console.error = originalError;
  }
});

test('rapid name saves persist the latest name without losing the clean state', async () => {
  const path = `rapid-name-${crypto.randomUUID()}.grpcurl`;
  const saved = '# @name Old\ngrpcurl localhost example.Service/Method';
  await saveRequestFile(path, saved);
  await setup([{ ...tab('rapid', 'grpc'), filePath: path, name: 'Old', rawContent: saved }]);
  workspaceState.updateContent('# @name First\ngrpcurl localhost example.Service/Method', 'gRPC', 'First', true);
  const first = workspaceState.saveActiveRequestName();
  workspaceState.updateContent('# @name Second name\ngrpcurl localhost example.Service/Method', 'gRPC', 'Second name', true);
  const second = workspaceState.saveActiveRequestName();
  await Promise.all([first, second]);
  assert.equal((await readRequestFile(path)).raw_content, '# @name Second name\ngrpcurl localhost example.Service/Method');
  assert.equal(workspaceState.activeTab.isDirty, false);
});

test('a full save ordered after a name save retains the latest request edits', async () => {
  const path = `ordered-save-${crypto.randomUUID()}.curl`;
  const saved = '# @name Old\ncurl https://example.com/saved';
  await saveRequestFile(path, saved, { name: 'Old', tests: [] });
  await setup([{ ...tab('ordered'), filePath: path, name: 'Old', rawContent: saved,
    sidecar: { name: 'Old', tests: [] } }]);
  workspaceState.updateContent('# @name New\ncurl https://example.com/saved', 'GET', 'New', true);
  const rename = workspaceState.saveActiveRequestName();
  await Promise.resolve();
  workspaceState.updateContent('# @name New\ncurl https://example.com/edited', 'GET', 'New');
  const fullSave = workspaceState.saveActiveFile();
  await Promise.all([rename, fullSave]);
  assert.equal((await readRequestFile(path)).raw_content, '# @name New\ncurl https://example.com/edited');
  assert.equal((await readRequestFile(path)).sidecar.name, 'New');
  assert.equal(workspaceState.activeTab.isDirty, false);
});

test('concurrent gRPC and HTTP requests keep controls, responses, scripts, and history in their tabs', async () => {
  const script = 'pm.test("HTTP status", function () { pm.response.to.have.status(201); });';
  const { state, calls, cancelled, history } = await setup([tab('grpc', 'grpc'), tab('http', 'http', { post_response_script: script })]);
  await state.runCurrentRequest();
  const grpcId = state.current.activeRequestId;
  assert.equal(state.current.isExecuting, true);

  workspaceState.activeTabId = 'http';
  state.loadTab('http');
  assert.equal(state.current.isExecuting, false);
  assert.equal(state.current.bodyText, '');
  await state.runCurrentRequest();
  const httpId = state.current.activeRequestId;
  assert.notEqual(httpId, grpcId);
  calls.get(grpcId)(header(200, true));
  calls.get(grpcId)({ type: 'SseChunk', payload: { id: '1', event: 'message', data: 'grpc event' } });
  calls.get(grpcId)(body('grpc chunk'));
  assert.equal(state.current.bodyText, '');

  workspaceState.activeTabId = 'grpc';
  assert.equal(state.current.bodyText, 'grpc chunk');
  assert.equal(state.current.streamMessages[0].data, 'grpc event');
  assert.equal(state.current.isExecuting, true);
  calls.get(httpId)(header(201));
  calls.get(httpId)(body('HTTP result'));
  calls.get(httpId)(finished('HTTP result'));
  assert.equal(state.current.bodyText, 'grpc chunk');
  assert.equal(state.current.isExecuting, true);

  workspaceState.activeTabId = 'http';
  assert.equal(state.current.isExecuting, false);
  assert.equal(state.current.bodyText, 'HTTP result');
  assert.equal(state.current.testResults[0].passed, true);
  assert.equal(history[0].entry.request_name, 'http');
  assert.equal(history[0].entry.response_body, 'HTTP result');

  workspaceState.activeTabId = 'grpc';
  await state.cancel();
  assert.deepEqual(cancelled, [grpcId]);
  calls.get(grpcId)(body('late data'));
  calls.get(grpcId)(finished('late data'));
  assert.equal(state.current.bodyText, 'grpc chunk');
  assert.equal(state.current.error, 'Request cancelled');
  assert.equal(history.length, 2);
  assert.equal(history[1].entry.request_name, 'grpc');
  assert.equal(history[1].path, '/test-workspace');
});

test('cancellation during preparation never starts the request', async () => {
  const { state, calls, cancelled } = await setup([tab('preparing')]);
  let resolveVariables;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  envState.variablesForRequest = () => {
    entered();
    return new Promise((resolve) => { resolveVariables = resolve; });
  };
  const running = state.runCurrentRequest();
  await enteredPromise;
  await state.cancel();
  resolveVariables({});
  await running;
  assert.equal(state.current.error, 'Request cancelled');
  assert.equal(state.current.isExecuting, false);
  assert.equal(calls.size, 0);
  assert.deepEqual(cancelled, []);
});

test('closing a tab during registration cancels it after registration without leaking late chunks', async () => {
  let resolveRegistration;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const { state, calls, cancelled } = await setup([tab('first'), tab('other')], {
    register: () => {
      entered();
      return new Promise((resolve) => { resolveRegistration = resolve; });
    },
  });
  const running = state.runCurrentRequest();
  await enteredPromise;
  const requestId = state.current.activeRequestId;
  workspaceState.closeTab('first');
  assert.equal(state.current.isExecuting, false);
  assert.deepEqual(cancelled, []);
  resolveRegistration();
  await running;
  assert.deepEqual(cancelled, [requestId]);
  calls.get(requestId)(body('late'));
  assert.equal(state.current.bodyText, '');
});

test('closing other tabs cancels only their executions', async () => {
  const { state, cancelled } = await setup([tab('a'), tab('b'), tab('c')]);
  await state.runCurrentRequest();
  const first = state.current.activeRequestId;
  workspaceState.activeTabId = 'b';
  await state.runCurrentRequest();
  const second = state.current.activeRequestId;
  workspaceState.closeOtherTabs('b');
  assert.deepEqual(cancelled, [first]);
  assert.equal(state.current.activeRequestId, second);
  assert.equal(state.current.isExecuting, true);
});

test('replacing a preview tab cancels its request and ignores its late chunks', async () => {
  const preview = { ...tab('preview'), isPinned: false };
  const { state, calls, cancelled } = await setup([preview]);
  await state.runCurrentRequest();
  const requestId = state.current.activeRequestId;
  await workspaceState.openRequest('/examples/get_users.curl');
  state.loadTab('preview');
  assert.deepEqual(cancelled, [requestId]);
  assert.equal(state.current.isExecuting, false);
  calls.get(requestId)(body('old response'));
  assert.equal(state.current.bodyText, '');
  assert.equal(workspaceState.activeTab.filePath, '/examples/get_users.curl');
  assert.equal(workspaceState.activeTab.response, undefined);
});

test('switching workspaces cancels all executions and records history in the original workspace', async () => {
  const { state, cancelled, history } = await setup([tab('a'), tab('b', 'grpc')]);
  await state.runCurrentRequest();
  const first = state.current.activeRequestId;
  workspaceState.activeTabId = 'b';
  await state.runCurrentRequest();
  const second = state.current.activeRequestId;
  assert.equal(await workspaceState.switchWorkspace('/next-workspace'), true);
  assert.deepEqual(cancelled, [first, second]);
  assert.deepEqual(history.map((item) => item.path), ['/test-workspace', '/test-workspace']);
  assert.equal(state.current.isExecuting, false);
  assert.equal(workspaceState.tabs.length, 0);
});

test('a late failed or finished event cannot overwrite a restarted request', async () => {
  const { state, calls, history } = await setup([tab('retry')]);
  await state.runCurrentRequest();
  const oldId = state.current.activeRequestId;
  await state.cancel();
  await state.runCurrentRequest();
  const newId = state.current.activeRequestId;
  calls.get(oldId)({ type: 'Failed', payload: { error: 'late error' } });
  calls.get(oldId)(finished('old'));
  assert.equal(state.current.isExecuting, true);
  assert.equal(state.current.error, null);
  calls.get(newId)({ type: 'Failed', payload: { error: 'new error' } });
  assert.equal(state.current.error, 'new error');
  assert.equal(state.current.isExecuting, false);
  assert.equal(history.length, 2);
  assert.equal(history[1].entry.error, 'new error');
});

test('closing tabs to the right cancels those requests without stopping the retained tab', async () => {
  const { state, cancelled } = await setup([tab('left'), tab('right', 'grpc')]);
  await state.runCurrentRequest();
  const left = state.current.activeRequestId;
  workspaceState.activeTabId = 'right';
  await state.runCurrentRequest();
  const right = state.current.activeRequestId;
  workspaceState.closeTabsToTheRight('left');
  assert.deepEqual(cancelled, [right]);
  assert.equal(state.current.activeRequestId, left);
  assert.equal(state.current.isExecuting, true);
});

test('deleting a folder cancels requests in that folder but leaves other tabs running', async () => {
  const inside = { ...tab('inside'), filePath: '/examples/methods/file_upload.curl' };
  const { state, cancelled } = await setup([inside, tab('outside')]);
  await state.runCurrentRequest();
  const first = state.current.activeRequestId;
  workspaceState.activeTabId = 'outside';
  await state.runCurrentRequest();
  const second = state.current.activeRequestId;
  await workspaceState.deleteItem('/examples/methods');
  assert.deepEqual(cancelled, [first]);
  assert.equal(state.current.activeRequestId, second);
  assert.equal(state.current.isExecuting, true);
});

test('a pending cancellation cannot overwrite a restarted execution in the same tab', async () => {
  let releaseFirst;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  let registrations = 0;
  const { state, calls, cancelled, history } = await setup([tab('retry')], {
    register: () => {
      if (++registrations > 1) return Promise.resolve();
      entered();
      return new Promise((resolve) => { releaseFirst = resolve; });
    },
  });
  const firstRun = state.runCurrentRequest();
  await enteredPromise;
  const first = state.current.activeRequestId;
  await state.cancel();
  await state.runCurrentRequest();
  const second = state.current.activeRequestId;
  releaseFirst();
  await firstRun;
  assert.deepEqual(cancelled, [first]);
  assert.equal(history[0].entry.id, first);
  calls.get(first)(body('old'));
  calls.get(second)(body('new'));
  assert.equal(state.current.bodyText, 'new');
  assert.equal(state.current.isExecuting, true);
});

test('cancellation failures are surfaced and recorded for the originating request', async () => {
  const { state, history } = await setup([tab('failure')], {
    cancel: () => Promise.reject(new Error('backend unavailable')),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    await state.runCurrentRequest();
    await state.cancel();
    assert.match(state.current.error, /Failed to cancel request: backend unavailable/);
    assert.equal(history.length, 1);
    assert.equal(history[0].entry.error, state.current.error);
  } finally {
    console.error = originalError;
  }
});

test('history from an old workspace does not appear in the current workspace', async () => {
  await setup([tab('source')]);
  const history = new HistoryState();
  workspaceState.workspacePath = '/current';
  history.entries = [];
  await history.record('/previous', {
    id: 'old', timestamp: new Date().toISOString(), request_name: 'old',
    request_path: null, method: 'GET', url: '', raw_command: '',
    status: null, status_text: '', headers: [], response_body: '',
    duration_ms: null, total_bytes: 0, is_streaming: false, error: null,
  });
  assert.deepEqual(history.entries, []);
});
