import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findVariablesInText,
  getVariableAtCursor,
  getVariableInfo,
} from '../src/lib/utils/variable-tooltip.ts';
import type { VariableItem } from '../src/lib/types.ts';

test('findVariablesInText extracts variable matches with accurate start and end indices', () => {
  const text = 'https://api.example.com/{{version}}/users/{{user_id}}?token={{auth_token}}';
  const matches = findVariablesInText(text);

  assert.equal(matches.length, 3);

  assert.equal(matches[0].name, 'version');
  assert.equal(matches[0].raw, '{{version}}');
  assert.equal(text.slice(matches[0].start, matches[0].end), '{{version}}');

  assert.equal(matches[1].name, 'user_id');
  assert.equal(matches[1].raw, '{{user_id}}');
  assert.equal(text.slice(matches[1].start, matches[1].end), '{{user_id}}');

  assert.equal(matches[2].name, 'auth_token');
  assert.equal(matches[2].raw, '{{auth_token}}');
  assert.equal(text.slice(matches[2].start, matches[2].end), '{{auth_token}}');
});

test('findVariablesInText returns empty array when no variables present', () => {
  assert.deepEqual(findVariablesInText(''), []);
  assert.deepEqual(findVariablesInText('https://example.com/no/vars'), []);
});

test('getVariableAtCursor matches strictly inside variable boundaries and returns null outside', () => {
  //             012345678901234567890123456789
  // text:      "curl -H {{api_key}} url"
  // {{api_key}} starts at index 8 and ends at index 19 (length 11)
  const text = 'curl -H {{api_key}} url';
  const varStart = text.indexOf('{{api_key}}');
  const varEnd = varStart + '{{api_key}}'.length;

  assert.equal(varStart, 8);
  assert.equal(varEnd, 19);

  // Before variable
  assert.equal(getVariableAtCursor(text, 0), null);
  assert.equal(getVariableAtCursor(text, 7), null);

  // Exact start '{'
  const startMatch = getVariableAtCursor(text, 8);
  assert.ok(startMatch);
  assert.equal(startMatch?.name, 'api_key');

  // Inside variable token
  const insideMatch = getVariableAtCursor(text, 13);
  assert.ok(insideMatch);
  assert.equal(insideMatch?.name, 'api_key');

  // Exact last character '}' (index 18)
  const endCharMatch = getVariableAtCursor(text, 18);
  assert.ok(endCharMatch);
  assert.equal(endCharMatch?.name, 'api_key');

  // Immediately after variable (index 19: space)
  assert.equal(getVariableAtCursor(text, 19), null);
  assert.equal(getVariableAtCursor(text, 20), null);
  assert.equal(getVariableAtCursor(text, 100), null);
});

test('getVariableAtCursor discriminates between multiple variables in the same string', () => {
  const text = '{{first}} and {{second}}';
  const matchFirst = getVariableAtCursor(text, 2);
  assert.equal(matchFirst?.name, 'first');

  // Space between variables
  const matchBetween = getVariableAtCursor(text, 11);
  assert.equal(matchBetween, null);

  const matchSecond = getVariableAtCursor(text, 16);
  assert.equal(matchSecond?.name, 'second');
});

test('getVariableInfo resolves dynamic variables, secrets, workspace vars, and unresolved vars', () => {
  const testVars: VariableItem[] = [
    { id: '1', key: 'api_url', value: 'https://api.test.com', isSecret: false },
    { id: '2', key: 'secret_key', value: 'super-secret-123', isSecret: true },
  ];

  // Dynamic $uuid
  const uuidInfo = getVariableInfo('$uuid', testVars);
  assert.equal(uuidInfo.isDynamic, true);
  assert.equal(uuidInfo.source, 'Dynamic Generator');
  assert.match(uuidInfo.variableValue || '', /^[0-9a-f-]{36}$/);

  // Dynamic $timestamp
  const tsInfo = getVariableInfo('$timestamp', testVars);
  assert.equal(tsInfo.isDynamic, true);
  assert.ok(Number(tsInfo.variableValue) > 1700000000);

  // Workspace variable
  const urlInfo = getVariableInfo('api_url', testVars);
  assert.equal(urlInfo.isDefined, true);
  assert.equal(urlInfo.isSecret, false);
  assert.equal(urlInfo.variableValue, 'https://api.test.com');
  assert.equal(urlInfo.source, 'Workspace Variable');

  // Secret variable
  const secretInfo = getVariableInfo('secret_key', testVars);
  assert.equal(secretInfo.isDefined, true);
  assert.equal(secretInfo.isSecret, true);
  assert.equal(secretInfo.variableValue, 'super-secret-123');
  assert.equal(secretInfo.source, 'Secret Variable');

  // Unresolved variable
  const unresolvedInfo = getVariableInfo('unknown_var', testVars);
  assert.equal(unresolvedInfo.isDefined, false);
  assert.equal(unresolvedInfo.variableValue, null);
  assert.equal(unresolvedInfo.source, 'Unresolved Variable');
});
