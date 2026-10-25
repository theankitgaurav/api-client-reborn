import test from 'node:test';
import assert from 'node:assert/strict';
import { runScript } from '../src/lib/utils/script-runner.ts';

test('runScript executes pre-request script and modifies environment', () => {
  const script = `
    const prev = pm.environment.get("counter") || "0";
    pm.environment.set("counter", String(parseInt(prev, 10) + 1));
    pm.environment.set("token", "bearer_secret_123");
    console.log("Updated counter to:", pm.environment.get("counter"));
  `;

  const context = {
    environment: { counter: '5' },
    request: {
      url: 'https://httpbin.org/get',
      method: 'GET',
      headers: [],
    },
  };

  const result = runScript(script, context);
  assert.equal(result.updatedEnvironment.counter, '6');
  assert.equal(result.updatedEnvironment.token, 'bearer_secret_123');
  assert.equal(result.logs.length, 1);
  assert.ok(result.logs[0].includes('Updated counter to: 6'));
  assert.equal(result.error, undefined);
});

test('runScript executes post-response assertions (tests) and passes', () => {
  const script = `
    pm.test("Status code is 200", function () {
      pm.response.to.have.status(200);
    });

    pm.test("JSON property check", function () {
      const data = pm.response.json();
      pm.expect(data.id).to.equal(42);
      pm.expect(data.name).to.equal("Alice");
      pm.expect(data.roles).to.include("admin");
    });

    pm.test("Response time check", function () {
      pm.expect(pm.response.responseTime).to.be.below(500);
    });

    // Extract token from response and set into environment
    const data = pm.response.json();
    pm.environment.set("user_id", String(data.id));
  `;

  const context = {
    environment: {},
    request: {
      url: 'https://httpbin.org/get',
      method: 'GET',
      headers: [],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ key: 'Content-Type', value: 'application/json' }],
      bodyText: JSON.stringify({ id: 42, name: 'Alice', roles: ['user', 'admin'] }),
      durationMs: 120,
    },
  };

  const result = runScript(script, context);
  assert.equal(result.testResults.length, 3);
  assert.equal(result.testResults[0].passed, true);
  assert.equal(result.testResults[1].passed, true);
  assert.equal(result.testResults[2].passed, true);
  assert.equal(result.updatedEnvironment.user_id, '42');
});

test('runScript records failing assertions with clear error messages', () => {
  const script = `
    pm.test("Should fail on status", function () {
      pm.response.to.have.status(201);
    });

    pm.test("Should fail on value", function () {
      const data = pm.response.json();
      pm.expect(data.count).to.equal(100);
    });
  `;

  const context = {
    environment: {},
    request: {
      url: 'https://httpbin.org/get',
      method: 'GET',
      headers: [],
    },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [],
      bodyText: JSON.stringify({ count: 5 }),
      durationMs: 80,
    },
  };

  const result = runScript(script, context);
  assert.equal(result.testResults.length, 2);
  assert.equal(result.testResults[0].passed, false);
  assert.ok(result.testResults[0].error?.includes('expected status code 201 but got 200'));
  assert.equal(result.testResults[1].passed, false);
  assert.ok(result.testResults[1].error?.includes('expected 5 to equal 100'));
});
