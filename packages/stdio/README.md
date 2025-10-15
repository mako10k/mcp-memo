# @mako10k/mcp-memo

`@mako10k/mcp-memo` は、Cloudflare Workers 上で稼働する `mcp-memory-server` を STDIO 経由で呼び出せる CLI アダプタです。`npm exec` / `npx` / `bunx` などから直接起動でき、Claude Desktop・Cline・VS Code など主要な MCP クライアントに簡単に組み込めます。

## インストール不要で実行する

```bash
npm exec @mako10k/mcp-memo -- \
  --memory-http-url https://mcp-memory-server.mako10k.workers.dev \
  --memory-http-timeout-ms 15000
```

> 注: 実行時に `NODE_EXTRA_CA_CERTS` が必要な場合は、上記コマンドの前に環境変数を付与してください。

### グローバルにインストールする場合

```bash
npm install -g @mako10k/mcp-memo
memory-mcp
```

## 環境変数

| 変数 | 説明 | 既定値 |
| --- | --- | --- |
| `MEMORY_HTTP_URL` | バックエンド HTTP エンドポイント | `http://127.0.0.1:8787` |
| `MEMORY_HTTP_BEARER_TOKEN` | 認証用 Bearer トークン | なし |
| `MEMORY_HTTP_HEADERS` | 追加ヘッダー (JSON 文字列) | なし |
| `MEMORY_HTTP_TIMEOUT_MS` | HTTP タイムアウト (ms) | なし |
| `MEMORY_NAMESPACE_DEFAULT` | 相対パス解決に使うデフォルト名前空間。API キーが持つ推奨値を上書きできます。 | なし |

## 提供ツール

- `memory-save` / `memory-search` / `memory-delete`
- `memory-list-namespaces`
- `memory-relation-save` / `memory-relation-delete` / `memory-relation-list` / `memory-relation-graph`
- `memory-inference-guidance`（フェーズ 0〜4 のワークフロー概要を返すガイダンスレスポンス。常に英語で返却）
- `think` (accepts arbitrary parameters and returns no response so you can insert a reflection pause)

## MCP クライアントへの追加

- **Claude Desktop / Cline**: `npm exec @mako10k/mcp-memo` をコマンドとして登録します。必要に応じて `env` に上記環境変数を設定してください。
- **VS Code**: `.vscode/mcp.json` に下記のように記述します。

```jsonc
{
  "memory-mcp": {
    "type": "stdio",
    "command": "npm",
    "args": [
      "exec",
      "@mako10k/mcp-memo"
    ],
    "env": {
      "MEMORY_HTTP_URL": "https://<your-worker>.workers.dev",
      "NODE_EXTRA_CA_CERTS": "${workspaceFolder}/certs/cloudflare-chain.pem"
    }
  }
}
```

## ローカル開発

```bash
# 依存関係のインストール
bun install

# ウォッチ付きでビルド
bun run --cwd packages/stdio dev

# 単発でビルド
bun run --cwd packages/stdio build

# CLI 起動 (ビルド後)
bun run --cwd packages/stdio start
```

## ライセンス

このパッケージは現在ライセンス未設定 (`UNLICENSED`) です。
