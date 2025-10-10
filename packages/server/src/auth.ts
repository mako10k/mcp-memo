import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

import type { EnvVars } from "./env";

interface ApiKeyRow {
  owner_id: string;
  root_namespace: string;
  default_namespace: string;
  status: string;
}

export interface ApiKeyContext {
  ownerId: string;
  rootNamespace: string;
  defaultNamespace: string;
}

export interface ApiKeyStore {
  findByToken(token: string): Promise<ApiKeyContext | null>;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createApiKeyStore(env: EnvVars): ApiKeyStore {
  const sql = neon(env.DATABASE_URL);

  return {
    async findByToken(token: string): Promise<ApiKeyContext | null> {
      const normalized = token.trim();
      if (!normalized) return null;

      const tokenHash = hashToken(normalized);
      const query = `
        SELECT owner_id, root_namespace, default_namespace, status
        FROM api_keys
        WHERE token_hash = $1
        LIMIT 1
      `;
  const rows = (await sql(query, [tokenHash])) as ApiKeyRow[];

      if (!rows.length) {
        return null;
      }

      const row = rows[0];
      if (row.status !== "active") {
        return null;
      }

      return {
        ownerId: row.owner_id,
        rootNamespace: row.root_namespace,
        defaultNamespace: row.default_namespace
      } satisfies ApiKeyContext;
    }
  } satisfies ApiKeyStore;
}
