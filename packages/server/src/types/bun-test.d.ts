declare module "bun:test" {
  type TestFn = () => void | Promise<void>;

  export function describe(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn): void;
  export function test(name: string, fn: TestFn): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toHaveLength(length: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
  };
}
