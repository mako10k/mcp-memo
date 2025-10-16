# MCP クライアント別設定ガイド

`@mako10k/mcp-memo` を Claude Desktop / Cline / VS Code などで利用する手順をまとめます。すべての例で、必要に応じて `MEMORY_HTTP_URL` / `MEMORY_HTTP_BEARER_TOKEN` / `NODE_EXTRA_CA_CERTS` を設定してください（公開ワーカー用証明書はパッケージ同梱の `certs/cloudflare-chain.pem` を利用できます）。

## Claude Desktop

1. `claude_desktop_config.json` もしくは UI から新しい MCP サーバを追加。
2. コマンドに以下を指定。

   ```jsonc
   {
     "command": "npm",
     "args": [
      "exec",
      "@mako10k/mcp-memo",
       "--",
       "--memory-http-url",
       "https://<your-worker>.workers.dev"
     ],
     "env": {
       "MEMORY_HTTP_BEARER_TOKEN": "<your-token>",
       "NODE_EXTRA_CA_CERTS": "/absolute/path/to/certs/cloudflare-chain.pem"
     }
   }
   ```

3. Claude Desktop を再起動すると、`memory-save` / `memory-search` / `memory-delete` / `memory-list-namespaces` ツールが利用可能になります。

## Cline

1. Cline の設定画面で MCP サーバを追加。
2. 「コマンド」欄に `npm exec @mako10k/mcp-memo`、引数欄に `--memory-http-url https://<your-worker>.workers.dev` を入力。
3. ルートからのデフォルト名前空間を切り替えたい場合は `MEMORY_NAMESPACE_DEFAULT` を追加で設定してください。
4. 名前空間の構造を把握したいときは `memory-list-namespaces` や `memory-list` を呼び出せます。
5. 追加ヘッダーを使う場合は `MEMORY_HTTP_HEADERS` に JSON 文字列を渡します。

## VS Code (MCP 拡張)

`.vscode/mcp.json` の例:

```jsonc
{
  "servers": {
    "memory-mcp": {
      "type": "stdio",
      "command": "npm",
      "args": [
        "exec",
        "@mako10k/mcp-memo"
      ],
      "env": {
        "MEMORY_HTTP_URL": "https://<your-worker>.workers.dev",
        "MEMORY_HTTP_BEARER_TOKEN": "${input:memory_api_token}",
        "NODE_EXTRA_CA_CERTS": "${workspaceFolder}/certs/cloudflare-chain.pem",
        "MEMORY_NAMESPACE_DEFAULT": "projectA/DEF"
      }
    }
  }
}
```

## 便利な Tips

- `npm exec` で毎回オプションを与えるのが面倒な場合は `.npmrc` に下記を追加すると CLI から `npm exec memory-mcp` だけで起動できます。

  ```ini
  alias memory-mcp="@mako10k/mcp-memo --memory-http-url=https://<your-worker>.workers.dev"
  ```

- `bunx @mako10k/mcp-memo` でも同様に動作します。
- API が推奨するデフォルト名前空間から変更したいときは、クライアント側で `MEMORY_NAMESPACE_DEFAULT` を指定すると相対パス解決が上書きされます。
