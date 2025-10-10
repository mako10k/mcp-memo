# MCP Memory Server

Cloudflare Workers で動作するシンプルなメモリ（ベクトル検索）MCP サーバです。Neon (serverless PostgreSQL + pgvector) をデータストアに採用し、OpenAI Embeddings API で埋め込みベクトルを生成します。

## 機能
- `memory-save`：メモの新規作成 / 更新（埋め込み自動生成、メタデータマージ、バージョン増分）。
- `memory-search`：ベクトル類似度検索＋メタデータフィルタ。
- `memory-delete`：名前空間 + memo ID で削除。
- `memory-list-namespaces`：ルート/デフォルトを基点にサブ名前空間を列挙。
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

### MCP クライアントへの組み込み

- **Claude Desktop / Cline**: `npm exec @mako10k/mcp-memo` をコマンドとして登録し、必要な環境変数を指定します。
- **VS Code**: `.vscode/mcp.json` の `memory-mcp` エントリを `npm exec @mako10k/mcp-memo` に置き換えるとローカルビルド不要で利用できます。

詳しい設定例は [`docs/clients.md`](docs/clients.md) を参照してください。

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
      "memoId": "...",
      "content": "...",
      "metadata": { "topic": "demo" }
    }
  }
  ```
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

## 今後の TODO
- Drizzle ORM / マイグレーション自動化。
- OpenAI Embeddings フェイルオーバー対応。
- E2E テスト（Workers 上）と実 DB を用いた統合テスト。

## 参考ドキュメント
- `docs/deployment.md`：GitHub Actions を使った自動化と Cloudflare Workers へのデプロイ手順。
- `docs/implementation-plan.md`：実装ロードマップと進捗メモ。
- `docs/memory-mcp-spec.md`：全体アーキテクチャと詳細仕様。
