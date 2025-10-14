#!/usr/bin/env bun
import process from "node:process";
import { readFile } from "node:fs/promises";

import { MemoryHttpBridge } from "../packages/stdio/src/httpBridge";
import { loadConfig } from "../packages/stdio/src/config";

interface CliOptions {
  namespace?: string;
  pivot?: string;
  inputPath?: string;
  apply: boolean;
  defaultWeight: number;
}

interface EvidenceEntry {
  memoId: string;
  support?: string;
  statement?: string;
  quote?: string;
  confidence?: number;
}

interface ConflictEntry {
  memoId: string;
  risk?: string;
  mitigation?: string;
  confidence?: number;
}

interface AnswerPayload {
  conclusion?: string;
  evidence?: EvidenceEntry[];
  conflicts?: ConflictEntry[];
  confidence?: number;
}

interface RelationSuggestion {
  sourceMemoId: string;
  targetMemoId: string;
  tag: "supports" | "conflicts" | "explains";
  weight: number;
  reason: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    defaultWeight: 0.6
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [flag, rawValue] = current.split("=", 2);
    const withNext = rawValue ?? argv[index + 1];
    const value = withNext ?? "";

    switch (flag) {
      case "--namespace":
        options.namespace = value;
        break;
      case "--pivot":
        options.pivot = value;
        break;
      case "--input":
        options.inputPath = value;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--default-weight":
        options.defaultWeight = Number.parseFloat(value);
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${flag}`);
    }

    if (rawValue === undefined && flag !== "--apply") {
      index += 1;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Phase 3 feedback helper\n\n` +
    `Reads a structured LLM answer (Phase 2 template) and proposes relation updates.\n\n` +
    `Environment:\n` +
    `  MEMORY_HTTP_URL             Backend endpoint (required when --apply)\n` +
    `  MEMORY_HTTP_BEARER_TOKEN    Bearer token (required when --apply)\n\n` +
    `Usage:\n` +
    `  bun run scripts/phase3Feedback.ts -- --pivot <memoId> [--input answer.json] [--namespace <ns>] [--apply]\n\n` +
    `Options:\n` +
    `  --pivot <memoId>        Pivot memo ID (required)\n` +
    `  --namespace <path>      Namespace for relation.save (default phase0/workspace/inference)\n` +
    `  --input <file>         JSON file with the LLM answer (default: stdin)\n` +
    `  --apply                Execute memory.relation.save for each suggestion\n` +
    `  --default-weight <f>   Fallback relation weight when confidence is missing (default 0.6)\n` +
    `  -h, --help             Show this message\n`);
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return clamp01(fallback);
  return clamp01(value);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function buildReason(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length))
    .join(" ");
}

function createSuggestions(
  payload: AnswerPayload,
  pivotMemoId: string,
  defaultWeight: number
): RelationSuggestion[] {
  const suggestions: RelationSuggestion[] = [];

  if (Array.isArray(payload.evidence)) {
    for (const entry of payload.evidence) {
      if (!entry?.memoId) continue;
      const tag = normalizeSupport(entry.support);
      if (!tag) continue;

      const reason = buildReason([entry.statement, entry.quote]);
      const weight = clampWeight(entry.confidence, defaultWeight);
      suggestions.push({
        sourceMemoId: entry.memoId,
        targetMemoId: pivotMemoId,
        tag,
        weight,
        reason: reason || `Supports pivot ${pivotMemoId}`
      });
    }
  }

  if (Array.isArray(payload.conflicts)) {
    for (const conflict of payload.conflicts) {
      if (!conflict?.memoId) continue;
      const reason = buildReason([conflict.risk, conflict.mitigation]);
      const weight = clampWeight(conflict.confidence, defaultWeight);
      suggestions.push({
        sourceMemoId: conflict.memoId,
        targetMemoId: pivotMemoId,
        tag: "conflicts",
        weight,
        reason: reason || `Conflicts with pivot ${pivotMemoId}`
      });
    }
  }

  return suggestions;
}

function normalizeSupport(value: string | undefined): RelationSuggestion["tag"] | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "supports") return "supports";
  if (normalized === "explains") return "explains";
  if (normalized === "conflicts") return "conflicts";
  return null;
}

async function loadAnswer(path?: string): Promise<AnswerPayload> {
  if (path && path !== "-") {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as AnswerPayload;
  }

  const chunks: string[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }
  const text = chunks.join("");
  if (!text.trim()) {
    throw new Error("No JSON input provided. Use --input <file> or pipe data via stdin.");
  }
  return JSON.parse(text) as AnswerPayload;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pivot) {
    printHelp();
    throw new Error("--pivot is required");
  }

  const namespace = args.namespace ?? "phase0/workspace/inference";
  const payload = await loadAnswer(args.inputPath);
  const suggestions = createSuggestions(payload, args.pivot, args.defaultWeight);

  if (!suggestions.length) {
    console.log(JSON.stringify({ pivot: args.pivot, namespace, suggestions: [] }, null, 2));
    return;
  }

  if (!args.apply) {
    console.log(JSON.stringify({ pivot: args.pivot, namespace, suggestions }, null, 2));
    return;
  }

  const config = loadConfig();
  const bridge = new MemoryHttpBridge(config);
  const results = [] as Array<{ suggestion: RelationSuggestion; response: unknown }>;

  for (const suggestion of suggestions) {
    const response = await bridge.invoke("memory.relation.save", {
      namespace,
      sourceMemoId: suggestion.sourceMemoId,
      targetMemoId: suggestion.targetMemoId,
      tag: suggestion.tag,
      weight: suggestion.weight,
      reason: suggestion.reason
    });
    results.push({ suggestion, response });
  }

  console.log(JSON.stringify({ pivot: args.pivot, namespace, applied: results }, null, 2));
}

main().catch((error) => {
  console.error("Phase 3 feedback helper failed", error);
  process.exitCode = 1;
});
