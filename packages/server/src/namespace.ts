import type { ApiKeyContext } from "./auth.js";

export type NamespaceContext = Pick<ApiKeyContext, "rootNamespace" | "defaultNamespace">;

export interface NamespaceOptions {
  namespace?: string;
  defaultOverride?: string;
}

export interface NamespaceResolution {
  namespace: string;
  segments: string[];
  defaultNamespace: string;
}

function split(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function isRootPrefixed(segments: string[], root: string[]): boolean {
  if (segments.length < root.length) return false;
  return root.every((segment, index) => segments[index] === segment);
}

function ensureRoot(base: string[], root: string[]): string[] {
  if (!isRootPrefixed(base, root)) {
    throw new Error("Default namespace must reside under root namespace");
  }
  return base;
}

function resolveWithBase(
  path: string | undefined,
  base: string[],
  root: string[]
): string[] {
  if (!path) {
    return base.slice();
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return base.slice();
  }

  const rawSegments = split(trimmed);
  let stack: string[];
  let startIndex = 0;

  if (trimmed.startsWith("/")) {
    stack = root.slice();
  } else if (isRootPrefixed(rawSegments, root)) {
    stack = root.slice();
    startIndex = root.length;
  } else {
    stack = base.slice();
  }

  for (let index = startIndex; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index];
    if (segment === ".") continue;
    if (segment === "..") {
      if (stack.length > root.length) {
        stack.pop();
        continue;
      }
      throw new Error("Namespace resolution escaped root scope");
    }
    stack.push(segment);
  }

  return stack;
}

export function resolveNamespace(
  context: NamespaceContext,
  options: NamespaceOptions = {}
): NamespaceResolution {
  const rootSegments = split(context.rootNamespace);
  if (!rootSegments.length) {
    throw new Error("Root namespace is not configured");
  }

  const defaultSegments = ensureRoot(
    resolveWithBase(context.defaultNamespace, rootSegments, rootSegments),
    rootSegments
  );

  const overrideSegments = options.defaultOverride
    ? ensureRoot(resolveWithBase(options.defaultOverride, rootSegments, rootSegments), rootSegments)
    : defaultSegments;

  const namespaceSegments = resolveWithBase(options.namespace, overrideSegments, rootSegments);

  return {
    namespace: namespaceSegments.join("/"),
    segments: namespaceSegments,
    defaultNamespace: overrideSegments.join("/")
  } satisfies NamespaceResolution;
}
