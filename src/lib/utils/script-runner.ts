import type { TestResultItem } from '../types';

export interface ScriptContext {
  environment: Record<string, string>;
  request: {
    url: string;
    method: string;
    headers: { key: string; value: string }[];
    body?: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: { key: string; value: string }[];
    bodyText: string;
    durationMs: number;
  };
}

export interface ScriptExecutionResult {
  updatedEnvironment: Record<string, string>;
  updatedRequest?: {
    headers: { key: string; value: string }[];
  };
  testResults: TestResultItem[];
  logs: string[];
  error?: string;
}

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function createExpectation(actual: any, isNegated = false): any {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'to' || prop === 'be' || prop === 'have' || prop === 'at') {
          return createExpectation(actual, isNegated);
        }
        if (prop === 'not') {
          return createExpectation(actual, !isNegated);
        }

        if (prop === 'equal' || prop === 'eql' || prop === 'equals') {
          return (expected: any) => {
            const pass = actual === expected;
            if (isNegated ? pass : !pass) {
              throw new AssertionError(
                `expected ${JSON.stringify(actual)} ${isNegated ? 'not to equal' : 'to equal'} ${JSON.stringify(expected)}`
              );
            }
          };
        }

        if (prop === 'exist') {
          const pass = actual !== undefined && actual !== null;
          if (isNegated ? pass : !pass) {
            throw new AssertionError(
              `expected ${JSON.stringify(actual)} ${isNegated ? 'not to exist' : 'to exist'}`
            );
          }
          return;
        }

        if (prop === 'below' || prop === 'lessThan') {
          return (n: number) => {
            const pass = Number(actual) < n;
            if (isNegated ? pass : !pass) {
              throw new AssertionError(
                `expected ${actual} ${isNegated ? 'not to be below' : 'to be below'} ${n}`
              );
            }
          };
        }

        if (prop === 'above' || prop === 'greaterThan') {
          return (n: number) => {
            const pass = Number(actual) > n;
            if (isNegated ? pass : !pass) {
              throw new AssertionError(
                `expected ${actual} ${isNegated ? 'not to be above' : 'to be above'} ${n}`
              );
            }
          };
        }

        if (prop === 'least') {
          return (n: number) => {
            const pass = Number(actual) >= n;
            if (isNegated ? pass : !pass) {
              throw new AssertionError(`expected ${actual} to be at least ${n}`);
            }
          };
        }

        if (prop === 'most') {
          return (n: number) => {
            const pass = Number(actual) <= n;
            if (isNegated ? pass : !pass) {
              throw new AssertionError(`expected ${actual} to be at most ${n}`);
            }
          };
        }

        if (prop === 'include' || prop === 'contain' || prop === 'contains') {
          return (item: any) => {
            let pass = false;
            if (typeof actual === 'string' || Array.isArray(actual)) {
              pass = actual.includes(item);
            } else if (typeof actual === 'object' && actual !== null) {
              pass = item in actual;
            }
            if (isNegated ? pass : !pass) {
              throw new AssertionError(
                `expected ${JSON.stringify(actual)} ${isNegated ? 'not to include' : 'to include'} ${JSON.stringify(item)}`
              );
            }
          };
        }

        if (prop === 'property') {
          return (propName: string, val?: any) => {
            const hasProp = actual && typeof actual === 'object' && propName in actual;
            if (!hasProp) {
              throw new AssertionError(`expected property "${propName}" to exist`);
            }
            if (val !== undefined && actual[propName] !== val) {
              throw new AssertionError(
                `expected property "${propName}" to have value ${JSON.stringify(val)}, but got ${JSON.stringify(actual[propName])}`
              );
            }
          };
        }

        if (prop === 'true') {
          const pass = actual === true;
          if (isNegated ? pass : !pass) {
            throw new AssertionError(`expected ${actual} to be true`);
          }
          return;
        }

        if (prop === 'false') {
          const pass = actual === false;
          if (isNegated ? pass : !pass) {
            throw new AssertionError(`expected ${actual} to be false`);
          }
          return;
        }

        if (prop === 'a' || prop === 'an') {
          return (type: string) => {
            const actualType = Array.isArray(actual) ? 'array' : typeof actual;
            const pass = actualType === type.toLowerCase();
            if (isNegated ? pass : !pass) {
              throw new AssertionError(
                `expected ${JSON.stringify(actual)} to be a ${type}, but got ${actualType}`
              );
            }
          };
        }

        return undefined;
      },
    }
  );
}

export function runScript(script: string, context: ScriptContext): ScriptExecutionResult {
  const envCopy = { ...context.environment };
  const reqHeaders = [...context.request.headers];
  const testResults: TestResultItem[] = [];
  const logs: string[] = [];

  const pm: any = {
    environment: {
      get(k: string) {
        return envCopy[k];
      },
      set(k: string, v: any) {
        envCopy[k] = String(v);
      },
      has(k: string) {
        return k in envCopy;
      },
      unset(k: string) {
        delete envCopy[k];
      },
      toObject() {
        return { ...envCopy };
      },
    },
    variables: {
      get(k: string) {
        return envCopy[k];
      },
      set(k: string, v: any) {
        envCopy[k] = String(v);
      },
      has(k: string) {
        return k in envCopy;
      },
    },
    request: {
      url: context.request.url,
      method: context.request.method,
      headers: {
        add(header: { key: string; value: string }) {
          const idx = reqHeaders.findIndex(
            (h) => h.key.toLowerCase() === header.key.toLowerCase()
          );
          if (idx >= 0) {
            reqHeaders[idx].value = header.value;
          } else {
            reqHeaders.push({ key: header.key, value: header.value });
          }
        },
        get(key: string) {
          const found = reqHeaders.find((h) => h.key.toLowerCase() === key.toLowerCase());
          return found ? found.value : undefined;
        },
        remove(key: string) {
          const idx = reqHeaders.findIndex((h) => h.key.toLowerCase() === key.toLowerCase());
          if (idx >= 0) reqHeaders.splice(idx, 1);
        },
      },
      body: context.request.body,
    },
    test(testName: string, fn: () => void) {
      try {
        fn();
        testResults.push({ name: testName, passed: true });
      } catch (err: any) {
        testResults.push({
          name: testName,
          passed: false,
          error: err.message || String(err),
        });
      }
    },
    expect(actual: any) {
      return createExpectation(actual);
    },
  };

  if (context.response) {
    const res = context.response;
    let parsedJsonCache: any = null;
    let jsonParsed = false;

    pm.response = {
      code: res.status,
      status: res.statusText,
      responseTime: res.durationMs,
      headers: {
        get(headerName: string) {
          const found = res.headers.find(
            (h) => h.key.toLowerCase() === headerName.toLowerCase()
          );
          return found ? found.value : undefined;
        },
      },
      text() {
        return res.bodyText;
      },
      json() {
        if (!jsonParsed) {
          parsedJsonCache = JSON.parse(res.bodyText);
          jsonParsed = true;
        }
        return parsedJsonCache;
      },
      to: {
        have: {
          status(expected: number | string) {
            if (typeof expected === 'number') {
              if (res.status !== expected) {
                throw new AssertionError(`expected status code ${expected} but got ${res.status}`);
              }
            } else {
              if (res.statusText.toLowerCase() !== expected.toLowerCase()) {
                throw new AssertionError(
                  `expected status text "${expected}" but got "${res.statusText}"`
                );
              }
            }
          },
        },
      },
    };
  }

  const customConsole = {
    log(...args: any[]) {
      logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    },
    info(...args: any[]) {
      this.log(...args);
    },
    warn(...args: any[]) {
      this.log('[WARN]', ...args);
    },
    error(...args: any[]) {
      this.log('[ERROR]', ...args);
    },
  };

  try {
    const runner = new Function('pm', 'console', script);
    runner(pm, customConsole);
    return {
      updatedEnvironment: envCopy,
      updatedRequest: { headers: reqHeaders },
      testResults,
      logs,
    };
  } catch (err: any) {
    return {
      updatedEnvironment: envCopy,
      updatedRequest: { headers: reqHeaders },
      testResults,
      logs,
      error: err.message || String(err),
    };
  }
}
