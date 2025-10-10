# Cloudflare Workers デプロイガイド

Cloudflare Workers 上で `mcp-memory-server` をホストするための手順をまとめます。

## 前提条件

- Cloudflare アカウント
- `wrangler` CLI (`npm install -g wrangler`)
- Neon (または互換 PostgreSQL) と OpenAI API キー

## 1. Neon / OpenAI シークレットの登録

```bash
cd packages/server
wrangler secret put DATABASE_URL # Neon 接続文字列
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_EMBEDDING_MODEL # 任意
```

## 2. ビルドとデプロイ

```bash
bun install
wrangler deploy
```

デプロイ後、`wrangler routes` で `https://<name>.<account>.workers.dev` が発行されます。`packages/server/wrangler.toml` の `name` を変更することでサブドメインを調整可能です。

## 3. TLS 証明書チェーンの取得

`mcp-memory-server` は Cloudflare 由来の証明書を返します。STDIO クライアントで信頼されない場合は以下でチェーンを取得してください。

```bash
openssl s_client -showcerts \
  -connect <your-worker>.workers.dev:443 \
  -servername <your-worker>.workers.dev </dev/null | \
  awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/ { print }' > certs/cloudflare-chain.pem
```

追加で `AAA Certificate Services` ルートが必要な場合はシステム証明書ストアから追記します。

## 4. pm2 を利用したローカルテスト

```bash
bunx pm2 start ecosystem.config.cjs --only memory-worker
bunx pm2 logs memory-worker
```

Cloudflare 上の本番環境と同等の挙動をローカルで確認できます。停止は `bunx pm2 delete memory-worker`。

## 5. STDIO アダプタとの接続確認

```bash
npm exec @mako10k/mcp-memo -- \
  --memory-http-url https://<your-worker>.workers.dev \
  --memory-http-timeout-ms 15000
```

環境変数 `NODE_EXTRA_CA_CERTS` に上記チェーンを指定すると TLS エラーを回避できます。
