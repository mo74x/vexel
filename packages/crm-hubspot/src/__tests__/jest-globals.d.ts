declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function test(name: string, fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;
declare function beforeAll(fn: () => void | Promise<void>): void;
declare function afterAll(fn: () => void | Promise<void>): void;

interface JestMatchers<R> {
  not: JestMatchers<R>;
  toBe(expected: unknown): R;
  toEqual(expected: unknown): R;
  toContain(expected: unknown): R;
  toMatch(expected: string | RegExp): R;
  toThrow(error?: string | RegExp | Error | (new (...args: any[]) => any)): R;
  toBeDefined(): R;
  toBeUndefined(): R;
  toBeNull(): R;
  toBeTruthy(): R;
  toBeFalsy(): R;
  toHaveBeenCalled(): R;
  toHaveBeenCalledTimes(count: number): R;
  toHaveBeenCalledWith(...args: unknown[]): R;
  rejects: JestMatchers<Promise<void>>;
  resolves: JestMatchers<Promise<void>>;
}

declare function expect<T = unknown>(actual: T): JestMatchers<void>;

