import crypto from "node:crypto";
import process from "node:process";
import { neon } from "@neondatabase/serverless";

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

interface CliOptions {
  databaseUrl: string;
  ownerId: Uuid;
  rootNamespace: string;
  defaultNamespace: string;
  status: "active" | "revoked";
}

interface InsertRow {
  id: string;
  created_at: string;
}

function usage(): never {
  console.log(`
Usage: bun run --cwd packages/server src/scripts/createApiKey.ts [options]

Required options:
  --rootns <namespace>      Root namespace (e.g. "acme")
  --defaultns <namespace>   Default namespace relative to root (e.g. "DEF" or "projects/inbox")

Optional options:
  --owner <uuid>            Existing owner UUID (default: generate new UUID)
  --status <status>         Key status (active | revoked) (default: active)
  --database-url <url>      Override DATABASE_URL environment variable
`);
  process.exit(1);
}

function isUuid(value: string): value is Uuid {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
}

function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let ownerId = crypto.randomUUID() as Uuid;
  let rootInput: string | undefined;
  let defaultInput: string | undefined;
  let status: CliOptions["status"] = "active";
  let databaseUrl = process.env.DATABASE_URL ?? "";

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) continue;

    const [flag, inlineValue] = current.split("=", 2);
    const next = inlineValue ?? args[index + 1];

    switch (flag) {
      case "--help":
      case "-h":
        usage();
        break;
      case "--rootns":
        if (!next) usage();
        rootInput = next;
        if (inlineValue === undefined) index += 1;
        break;
      case "--defaultns":
        if (!next) usage();
        defaultInput = next;
        if (inlineValue === undefined) index += 1;
        break;
      case "--owner":
        if (!next) usage();
        if (!isUuid(next)) {
          throw new Error("--owner must be a valid UUID");
        }
        ownerId = next;
        if (inlineValue === undefined) index += 1;
        break;
      case "--status":
        if (!next) usage();
        if (next !== "active" && next !== "revoked") {
          throw new Error("--status must be either 'active' or 'revoked'");
        }
        status = next;
        if (inlineValue === undefined) index += 1;
        break;
      case "--database-url":
        if (!next) usage();
        databaseUrl = next;
        if (inlineValue === undefined) index += 1;
        break;
      default:
        console.warn(`Unknown option: ${flag}`);
        if (inlineValue === undefined) index += 1;
        break;
    }
  }

  if (!rootInput || !rootInput.trim()) {
    throw new Error("--rootns is required");
  }
  if (!defaultInput || !defaultInput.trim()) {
    throw new Error("--defaultns is required");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be provided via env or --database-url");
  }

  const rootSegments = normalizeSegments(rootInput);
  if (!rootSegments.length) {
    throw new Error("root namespace must not be empty");
  }

  const defaultSegments = normalizeSegments(defaultInput);
  if (!defaultSegments.length) {
    throw new Error("default namespace must not be empty");
  }

  const absoluteDefaultSegments = resolveDefaultSegments(rootSegments, defaultSegments);
  const normalizedRoot = joinSegments(rootSegments);
  const normalizedDefault = joinSegments(absoluteDefaultSegments);

  return {
    databaseUrl,
    ownerId,
    rootNamespace: normalizedRoot,
    defaultNamespace: normalizedDefault,
    status
  } satisfies CliOptions;
}

function normalizeSegments(value: string): string[] {
  const segments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.some((segment) => segment === "..")) {
    throw new Error("namespace must not contain '..'");
  }

  return segments;
}

function joinSegments(segments: string[]): string {
  return segments.join("/");
}

function startsWithSegments(full: string[], prefix: string[]): boolean {
  if (full.length < prefix.length) return false;
  return prefix.every((segment, index) => full[index] === segment);
}

function resolveDefaultSegments(rootSegments: string[], defaultSegments: string[]): string[] {
  const absolute = startsWithSegments(defaultSegments, rootSegments)
    ? defaultSegments
    : [...rootSegments, ...defaultSegments];

  if (!startsWithSegments(absolute, rootSegments)) {
    const root = joinSegments(rootSegments);
    const target = joinSegments(absolute);
    throw new Error(`default namespace must reside under root namespace (root=${root}, default=${target})`);
  }

  return absolute;
}

function generateToken(): string {
  const bytes = crypto.randomBytes(32);
  return bytes.toString("base64url");
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function main(): Promise<void> {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const sql = neon(options.databaseUrl);

    const token = generateToken();
    const tokenHash = hashToken(token);

    const rows = (await sql(
      `
        INSERT INTO api_keys (owner_id, token_hash, root_namespace, default_namespace, status)
        VALUES ($1::uuid, $2, $3, $4, $5)
        RETURNING id, created_at;
      `,
      [options.ownerId, tokenHash, options.rootNamespace, options.defaultNamespace, options.status]
    )) as InsertRow[];

    if (!rows.length) {
      throw new Error("Failed to insert API key");
    }

    const inserted = rows[0];

    console.log(JSON.stringify(
      {
        id: inserted.id,
        ownerId: options.ownerId,
        rootNamespace: options.rootNamespace,
        defaultNamespace: options.defaultNamespace,
        status: options.status,
        createdAt: inserted.created_at,
        token
      },
      null,
      2
    ));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

await main();
