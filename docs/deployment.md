# デプロイ & 自動化ガイド

このドキュメントでは、MCP メモリサーバを継続的に検証・デプロイするためのワークフローと GitHub Actions 設定手順を解説します。

## 1. 全体像
- **CI (Continuous Integration)**: プルリクエストおよび `main` ブランチへの push 時に自動でテストを実行し、基本的な品質を担保します。
- **CD (Continuous Delivery)**: 手動トリガー可能な GitHub Actions ワークフローを用意し、必要なシークレットが揃った状態で Cloudflare Workers へ `wrangler deploy` を実行します。
- **ローカルでの検証**: Bun と Wrangler を使って開発用サーバを起動し、curl などで動作確認します。

## 2. 前提条件
- Bun 1.2 以上がローカルにインストール済み。
- Cloudflare アカウントと Workers プロジェクトが作成済み。
- Neon (PostgreSQL + pgvector) と OpenAI Embeddings API の契約、API キー取得済み。
- `wrangler` の最新バージョン (>= 4.42.1)。
- GitHub CLI (`gh`) が設定済み（GitHub Actions の作成には不要ですが、リリース操作などで便利）。

## 3. GitHub Actions 構成

### 3.1 CI ワークフロー (`.github/workflows/ci.yml`)
- トリガー: `pull_request`, `push` (対象ブランチ: `main`)
- 処理内容:
  1. `actions/checkout` でソースを取得
  2. `oven-sh/setup-bun` で Bun をセットアップ
  3. 依存インストール (`bun install`)
  4. 単体テスト (`bun test`)
- 成功すると GitHub の PR チェックが Green になるため、マージ前の自動検証として活用してください。

### 3.2 手動デプロイ (`.github/workflows/wrangler-deploy.yml`)
- トリガー: `workflow_dispatch`（GitHub Actions 画面から手動実行）
- 処理内容:
  1. Bun セットアップ & 依存インストール
  2. `wrangler deploy --config packages/server/wrangler.toml`
- Secret 設定（リポジトリの Settings > Secrets and variables > Actions）:
  - `CLOUDFLARE_API_TOKEN`: Workers Scripts:Edit, Account Settings:Read 権限を付与。
  - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare ダッシュボードの Account ID。
  - `DATABASE_URL`: Neon の接続文字列。
  - `OPENAI_API_KEY`: OpenAI Embeddings API key。
  - `OPENAI_EMBEDDING_MODEL`: 任意（デフォルトなら不要）。
- `wrangler.toml` の `name` がユニークであることを確認してください。環境別デプロイをしたい場合は `--env` や複数 toml の利用を検討します。

## 4. ローカル開発フロー
1. 依存インストール
   ```bash
   bun install
   ```
2. 環境変数を `.dev.vars` に設定
   ```bash
   cat <<'EOF' > packages/server/.dev.vars
   DATABASE_URL="postgres://..."
   OPENAI_API_KEY="sk-..."
   OPENAI_EMBEDDING_MODEL="text-embedding-3-small"
   EOF
   ```
3. 開発サーバ起動
   ```bash
   cd packages/server
   bun run dev
   ```
4. 動作確認
   ```bash
   curl -X POST http://127.0.0.1:8787 \
     -H "content-type: application/json" \
     -d '{
       "tool": "memory.search",
       "params": {
         "namespace": "default",
         "query": "hello"
       }
     }'
   ```

## 5. 手動デプロイ
ローカルから直接デプロイする場合は、必要な環境変数を Shell や `.env` で設定した上で以下を実行します。
```bash
cd packages/server
wrangler deploy --config wrangler.toml
```

## 6. トラブルシューティング
- **`EPERM: operation not permitted, read` が `wrangler dev` で発生**
  - CI 環境や非対話モードでは `CI=1 bun run dev` として実行するとプロンプトを回避できます。
- **`Unexpected server response: 101`**
  - Bun 経由で `wrangler dev` を動かす際に WebSocket が切断したケース。`CI=1` を付けるか、`wrangler dev --remote` を使用してください。
- **GitHub Actions で `wrangler deploy` が 1 exit**
  - Cloudflare API Token の権限不足が想定されます。`Workers Scripts:Edit` と `Account Settings:Read` を付与して再実行してください。
- **OpenAI / Neon の接続エラー**
  - Secrets が設定されているか、環境変数のスペルミスがないかを確認。Neon プール URL は `?sslmode=require` 付きのものを利用します。

## 7. 今後の拡張案
- テスト用の Neon サンドボックスを GitHub Actions から自動構築し、統合テストを実施。
- `wrangler deploy` を main マージ時に自動で走らせるように変更（要運用判断）。
- Slack / Teams 連携でデプロイ完了通知を送るワークフローの追加。
