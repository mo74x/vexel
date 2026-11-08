declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void | Promise<void>): void;
declare function afterEach(fn: () => void | Promise<void>): void;

interface JestMatchers<R> {
  rejects: any;
  not: JestMatchers<R>;
  toBe(expected: unknown): R;
  toEqual(expected: unknown): R;
  toContain(expected: string): R;
  toThrow(expected?: string | RegExp | Error): R;
}

declare function expect<T>(actual: T): JestMatchers<T>;

