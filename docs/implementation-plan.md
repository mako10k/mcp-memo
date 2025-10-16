# MCP メモリサーバ 実装計画

## 1. ゴール
- `memory.save` / `memory.search` / `memory.delete` の MCP ツールを提供するエッジ/serverless 実装を公開。
- Cloudflare Workers 上で稼働し、Neon (serverless PostgreSQL + pgvector) にデータを保存。
- OpenAI Embeddings API と連携し、メモ本文のベクトル類似検索を実現。
- 運用初期は Free ティアを活用しつつ、スケールに応じてプラン移行できる状態を作る。

## 2. 前提条件
- Cloudflare アカウント済み（Workers / KV / D1 Free プラン利用）。
- OpenAI Embeddings API 契約済み。
- Neon Free プランを新規登録予定（pgvector 有効化）。
- リポジトリは `/home/mako10k/mcp-memo` を利用。

## 3. マイルストーン
1. **環境準備**
   - Neon プロジェクト作成、接続情報・pgvector 拡張確認。
   - Cloudflare Workers プロジェクト初期化（Bun+TypeScript テンプレート）。
   - Secrets 設定項目洗い出し（Neon 接続、OpenAI API Key）。
2. **データレイヤー構築**
   - Drizzle ORM もしくは kysely を用いたスキーマ定義とマイグレーションスクリプト作成。
   - `memory_entries` テーブルとインデックス（pgvector, metadata GIN）作成。
   - Neon 上で初回マイグレーション実行。
3. **埋め込みクライアント実装**
   - OpenAI Embeddings API ラッパー（フェイルオーバー拡張余地を確保）。
   - レート制御とエラーハンドリングの方針確立。
4. **MCP サーバ実装**
   - MCP プロトコルハンドラを Node/Bun で実装。
   - `memory.save` / `memory.search` / `memory.delete` のビジネスロジック実装。
   - 入力バリデーション・レスポンスフォーマット整備。
5. **テスト & QA**
   - ユニットテスト：データアクセス層、埋め込みクライアント、handler 別テスト。
   - 統合テスト：Cloudflare Workers ローカル (wrangler dev) でのエンドツーエンド検証。
   - 負荷テスト（初期は軽量 k6/Vegeta）。
6. **デプロイ & 運用準備**
   - Wrangler を使った Cloudflare Workers デプロイ。
   - Secrets 登録、自動デプロイ（GitHub Actions）構築。
   - 監視メトリクスとログ出力を有効化。

## 4. タスク分解
- **インフラ設定**
  - Neon: プロジェクト作成、ロール・接続文字列設定、pgvector enable。
  - Cloudflare: Workers プロジェクト作成、環境変数（`DATABASE_URL`, `OPENAI_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`）登録。
- **コードベース**
  - `packages/server/` に Workers コード。
  - `packages/shared/` にデータモデル・型定義。
  - `infra/` にマイグレーション、IaC（Terraform or Pulumi を後追い）。
- **CI/CD**
  - GitHub Actions: Lint/Test（Bun）、wrangler publish ワークフロー。
  - シークレットは GitHub Actions にも登録。

## 5. リスクと対応
- **エッジ環境のコールドスタート**：Bun + Workers で短縮。必要に応じて Durable Objects を併用。
- **埋め込み API レイテンシ**：結果を Cloudflare KV にキャッシュ。マルチベンダ化余地に備えて抽象化。
- **Neon Free プラン制限**：コネクションプールを利用し、アクセス集中時は Pro プランへ移行する。
- **MCP 互換性**：公式 CLI で相互運用テストを実施し、仕様変更時に即応する。

## 6. 成果物
- Cloudflare Workers プロジェクト（MCP server）。
- マイグレーションスクリプトと初期スキーマ。
- テストスイート（ユニット・統合）。
- 運用ガイド（環境変数、デプロイ手順、監視方法）。

## 7. スケジュール目安
- 環境準備：1 日
- データレイヤー & 埋め込みクライアント：2 日
- MCP ハンドラ実装：3 日
- テスト & QA：2 日
- デプロイ整備：1 日

合計 9 日（バッファ含め 2 週間目安）。

## 8. 進捗メモ（2025-10-09 時点）
- [x] Git リポジトリ初期化・基本ドキュメント整備
- [x] データモデル／Neon マイグレーション SQL 追加
- [x] OpenAI 埋め込みクライアント・MCP ハンドラ実装（`memory.save/search/delete`）
- [x] ハンドラのユニットテスト作成（Bun Test / 依存注入）
- [x] Bun 依存関係インストール（ローカル環境）
- [x] GitHub Actions CI（テスト自動化）導入
- [ ] memory-think-support ツール実装（設計: docs/memory-think-support.md）
- [ ] 実 DB / E2E テスト
- [ ] 自動デプロイ（本番環境への恒常運用）
