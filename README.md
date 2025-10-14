# MCP Memory Server

Cloudflare Workers で動作するシンプルなメモリ（ベクトル検索）MCP サーバです。Neon (serverless PostgreSQL + pgvector) をデータストアに採用し、OpenAI Embeddings API で埋め込みベクトルを生成します。

## 機能
- `memory-save`：メモの新規作成 / 更新（埋め込み自動生成、メタデータマージ、バージョン増分）。
- `memory-search`：ベクトル類似度検索＋メタデータフィルタ。メモ ID を pivot にしたコサイン類似度検索や `distanceMetric`（`cosine` / `l2`）の切り替えに対応。
- `memory-delete`：名前空間 + memo ID で削除。
- `memory-list-namespaces`：ルート/デフォルトを基点にサブ名前空間を列挙。
- `memory-relation-save`：2 つのメモ間にタグ付きリレーションを保存し、重み・理由を記録。
- `memory-relation-delete` / `memory-relation-list`：リレーションの削除・列挙（グラフ構造出力）。
- `memory-relation-graph`：起点メモからリレーションを深さ制限付きでトラバース（順方向 / 逆方向 / 双方向を選択可能、路径は JSON 配列で返却）。
- すべてのハンドラが MCP ツール呼び出し形式（`{ tool, params }` JSON）に対応。

## 必要環境
- [Bun](https://bun.sh/) 1.1 以上
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- OpenAI API キー（Embeddings 用）
- Neon アカウント（pgvector 有効化）

## セットアップ
1. 依存関係のインストール
   ```bash
   bun install
   ```
2. Neon 側で以下の SQL を順番に実行し、テーブルと階層化の前提スキーマを作成します。
  ```sql
  \i packages/server/migrations/001_init.sql
  \i packages/server/migrations/002_namespace_hierarchy.sql
    \i packages/server/migrations/003_memory_relations.sql
  ```
3. Cloudflare Workers のシークレットを登録（wrangler）
   ```bash
   wrangler secret put DATABASE_URL
   wrangler secret put OPENAI_API_KEY
   wrangler secret put OPENAI_EMBEDDING_MODEL # 任意（未設定時は text-embedding-3-small）
   ```
4. ローカルサーバを pm2 で起動
  ```bash
  bunx pm2 start ecosystem.config.cjs --only memory-worker
  bunx pm2 logs memory-worker
  ```
  - 停止するときは `bunx pm2 delete memory-worker`
  - 直接起動したい場合は `bun run --cwd packages/server dev`

5. MCP STDIO アダプタの起動（必要に応じて）
  ```bash
  bun run --cwd packages/stdio start
  ```
  または npm 実行環境のみで動かす場合は以下の通りです。
  ```bash
  npm exec @mako10k/mcp-memo -- \
    --memory-http-url https://<your-worker>.workers.dev \
    --memory-http-timeout-ms 15000
  ```
  TLS の独自証明書を利用する場合は `NODE_EXTRA_CA_CERTS` / `BUN_CERT` に `certs/cloudflare-chain.pem` を指定してください。

### API キーの発行

`api_keys` テーブルに新しいキーを登録するときは、サーバーパッケージに用意したスクリプトを利用できます。ルート名前空間と、ルート配下に設定するデフォルト名前空間（ルート相対）を指定してください。

```bash
bun run --cwd packages/server create:api-key \
  --rootns acme \
  --defaultns DEF
```

オプション:

| フラグ | 説明 |
| --- | --- |
| `--owner <uuid>` | 既存ユーザの `owner_id` を指定。省略すると新しい UUID が採番されます。 |
| `--status <active|revoked>` | 付与するキーのステータス。既定は `active`。 |
| `--database-url <url>` | `DATABASE_URL` を上書き。環境変数を使う場合は不要です。 |
| `--defaultns <path>` | ルート配下で相対指定するデフォルト名前空間。`DEF` や `projects/inbox` など。必須。 |

スクリプトは挿入したレコード情報と平文 API キーを JSON で出力します。出力された `token` は一度しか表示されないため安全な場所に保管してください。

### CI（自動テスト）
- GitHub Actions ワークフロー `.github/workflows/ci.yml` が push / pull request 時に自動実行されます。
- 処理内容は Bun のセットアップ、依存解決、`bun test` の実行です。
- ローカルで確認する場合は `bun install && bun test` を実行してください。

### デプロイ
- Cloudflare Workers への本番デプロイは `wrangler deploy` を利用します。
- GitHub Actions 経由でのデプロイは手動トリガーワークフロー `wrangler-deploy.yml` を使用します。
  - 必要な GitHub Secrets：`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_EMBEDDING_MODEL`（必要に応じて）。
  - Actions 画面から「Run workflow」を押すと、`wrangler deploy` が実行されます。
- 詳細な手順は `docs/deployment.md` を参照してください。

## ユニットテスト
Bun の組み込みテストランナーを利用しています。
```bash
bun test
```

## 環境変数
| 変数 | 説明 | 必須 |
| --- | --- | --- |
| `DATABASE_URL` | Neon の接続文字列（pooler 推奨）。 | ✅ |
| `OPENAI_API_KEY` | Embeddings API のキー。 | ✅ |
| `OPENAI_EMBEDDING_MODEL` | 利用モデル。デフォルト `text-embedding-3-small`。 | 任意 |
| `OPENAI_BASE_URL` | 互換 API を使う場合のエンドポイント。 | 任意 |
| `MEMORY_HTTP_URL` | STDIO アダプタが参照するバックエンド URL。デフォルト `http://127.0.0.1:8787`。 | 任意 |
| `MEMORY_HTTP_BEARER_TOKEN` | バックエンドに付与する Bearer Token。 | 任意 |
| `MEMORY_HTTP_HEADERS` | 追加ヘッダー（JSON 文字列）。 | 任意 |
| `MEMORY_HTTP_TIMEOUT_MS` | バックエンドへのタイムアウト（ミリ秒）。 | 任意 |
| `MEMORY_NAMESPACE_DEFAULT` | 相対パス解決に用いるデフォルト名前空間（API キーの推奨値を上書き）。 | 任意 |

### .env / .env.test の扱い

- 本番・開発向けのシークレットは `.env` に記述し、リポジトリにはコミットしないでください。（`.gitignore` で除外済み）
- テスト用の環境変数は `.env.test` に配置します。初回はルートにある `.env.test.example` をコピーして利用してください。
  ```bash
  cp .env.test.example .env.test
  ```
- テスト専用ファイルも `.gitignore` に含まれるため、実際の値はローカル管理に留めてください。

### MCP クライアントへの組み込み

- **Claude Desktop / Cline**: `npm exec @mako10k/mcp-memo` をコマンドとして登録し、必要な環境変数を指定します。
- **VS Code**: `.vscode/mcp.json` の `memory-mcp` エントリを `npm exec @mako10k/mcp-memo` に置き換えるとローカルビルド不要で利用できます。

詳しい設定例は [`docs/clients.md`](docs/clients.md) を参照してください。

### 推論ワークフロー支援

- フェーズ 0 の検証データセット: [`docs/inference-phase0.md`](docs/inference-phase0.md)
- フェーズ 1 のテンプレートと手順: [`docs/inference-phase1.md`](docs/inference-phase1.md)
- サーチ＋グラフ呼び出しをまとめる CLI: `bun run scripts/phase1Workflow.ts -- --pivot <memoId>`
- スコアリングと優先度計算ヘルパー: `bun run scripts/phase2Scoring.ts -- --pivot <memoId>`
- スコアリング手順と応答テンプレート: [`docs/inference-phase2.md`](docs/inference-phase2.md)
- フィードバックループとタグ指向運用: [`docs/inference-phase3.md`](docs/inference-phase3.md)
- 応答からリレーションを反映する CLI: `bun run scripts/phase3Feedback.ts -- --pivot <memoId>`

### Cloudflare Workers での準備

Cloudflare 側の環境構築・証明書チェーンの取得方法を [`docs/cloudflare.md`](docs/cloudflare.md) にまとめました。初回デプロイ前に参照してください。

### npm パッケージの公開

`@mako10k/mcp-memo` のリリース手順（バージョン更新・`npm publish` 実行手順）は [`docs/publishing.md`](docs/publishing.md) に記載しています。

## MCP クライアント設定
- VS Code の `.vscode/mcp.json` は `memory-mcp` を STDIO サーバとして構成しています。
- コマンド: `bun run --cwd packages/stdio start`
- pm2 で `memory-worker` を起動した状態で実行すると、HTTP API を透過的に利用できます。

## API プロトコル
- リクエスト：`POST` + JSON
  ```json
  {
    "tool": "memory.save",
    "params": {
      "namespace": "default",
      "content": "...",
      "metadata": { "topic": "demo" }
    }
  }
  ```
  - `memoId` はレスポンスで返る UUID です。新規作成時は省略し、既存メモを上書きしたい場合のみリクエストに含めてください。
- レスポンス例：
  ```json
  {
    "memo": {
      "memoId": "...",
      "namespace": "default",
      "content": "...",
      "metadata": { "topic": "demo" },
      "createdAt": "2025-10-09T00:00:00.000Z",
      "updatedAt": "2025-10-09T00:00:00.000Z",
      "version": 1
    }
  }
  ```

- 名前空間一覧取得：
  ```json
  {
    "tool": "memory.list_namespaces",
    "params": {
      "namespace": "projects",
      "depth": 2,
      "limit": 100
    }
  }
  ```
  ```json
  {
    "baseNamespace": "legacy/DEF/projects",
    "defaultNamespace": "legacy/DEF",
    "rootNamespace": "legacy",
    "depth": 2,
    "count": 3,
    "namespaces": [
      "legacy/DEF/projects",
      "legacy/DEF/projects/app",
      "legacy/DEF/projects/app/backend"
    ]
  }
  ```

- リレーション保存：
  ```json
  {
    "tool": "memory.relation.save",
    "params": {
      "namespace": "projects/alpha",
      "sourceMemoId": "...",
      "targetMemoId": "...",
      "tag": "supports",
      "weight": 0.8,
      "reason": "Design document backs the implementation detail"
    }
  }
  ```
  ```json
  {
    "relation": {
      "namespace": "legacy/DEF/projects/alpha",
      "sourceMemoId": "...",
      "targetMemoId": "...",
      "tag": "supports",
      "weight": 0.8,
      "reason": "Design document backs the implementation detail",
      "createdAt": "2025-10-12T00:00:00.000Z",
      "updatedAt": "2025-10-12T00:00:00.000Z",
      "version": 1
    },
    "rootNamespace": "legacy"
  }
  ```

- リレーション一覧：
  ```json
  {
    "tool": "memory.relation.list",
    "params": {
      "namespace": "projects/alpha",
      "sourceMemoId": "...",
      "limit": 50
    }
  }
  ```

- Pivot 類似検索：
  ```json
  {
    "tool": "memory.search",
    "params": {
      "namespace": "projects/alpha",
      "pivotMemoId": "...",
      "k": 5,
      "distanceMetric": "cosine"
    }
  }
  ```
  ```json
  {
    "count": 5,
    "items": [
      {
        "memoId": "...",
        "namespace": "projects/alpha",
        "score": 0.93,
        "createdAt": "2025-10-12T00:00:00.000Z",
        "updatedAt": "2025-10-12T00:00:00.000Z",
        "version": 3
      }
    ],
    "rootNamespace": "legacy"
  }
  ```

- リレーショングラフトラバース：
  ```json
  {
    "tool": "memory.relation.graph",
    "params": {
      "namespace": "projects/alpha",
      "startMemoId": "...",
      "direction": "both",
      "maxDepth": 3,
      "limit": 100
    }
  }
  ```
  ```json
  {
    "namespace": "legacy/DEF/projects/alpha",
    "rootNamespace": "legacy",
    "count": 4,
    "edges": [
      {
        "namespace": "legacy/DEF/projects/alpha",
        "sourceMemoId": "...",
        "targetMemoId": "...",
        "tag": "supports",
        "weight": 0.7,
        "direction": "forward",
        "depth": 1,
        "path": ["...", "..."]
      }
    ],
    "nodes": [
      { "memoId": "...", "namespace": "legacy/DEF/projects/alpha", "title": "Root" },
      { "memoId": "...", "namespace": "legacy/DEF/projects/alpha", "title": "Linked" }
    ]
  }
  ```
  ```json
  {
    "namespace": "legacy/DEF/projects/alpha",
    "rootNamespace": "legacy",
    "count": 1,
    "edges": [
      {
        "namespace": "legacy/DEF/projects/alpha",
        "sourceMemoId": "...",
        "targetMemoId": "...",
        "tag": "supports",
        "weight": 0.8,
        "reason": "Design document backs the implementation detail",
        "createdAt": "2025-10-12T00:00:00.000Z",
        "updatedAt": "2025-10-12T00:00:00.000Z",
        "version": 1
      }
    ],
    "nodes": [
      { "memoId": "...", "namespace": "legacy/DEF/projects/alpha", "title": "Design" },
      { "memoId": "...", "namespace": "legacy/DEF/projects/alpha", "title": "Implementation" }
    ]
  }
  ```

## 今後の TODO
- Drizzle ORM / マイグレーション自動化。
- OpenAI Embeddings フェイルオーバー対応。
- E2E テスト（Workers 上）と実 DB を用いた統合テスト。

## 参考ドキュメント
- `docs/deployment.md`：GitHub Actions を使った自動化と Cloudflare Workers へのデプロイ手順。
- `docs/implementation-plan.md`：実装ロードマップと進捗メモ。
- `docs/memory-mcp-spec.md`：全体アーキテクチャと詳細仕様。
- `docs/api-keys.md`：API キーの発行と運用ガイド。
