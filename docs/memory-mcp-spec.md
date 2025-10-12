# シンプル記憶機能 MCP サーバ設計仕様

## 1. 目的と背景
- モデルやクライアントが「メモ」を保存・検索・更新できる共通メモリレイヤーを提供する。
- メモは複数ユーザから共有でアクセスされるため、スレッドセーフかつネームスペース管理が必要。
- メモ本文に対して埋め込みベクトルを自動生成し、類似検索とメタデータ検索を両立させる。
- MCP (Model Context Protocol) のシンプルなツールセットで操作できる API を提供する。

## 2. スコープ
- MCP サーバのアーキテクチャ設計および主要コンポーネント定義。
- メモのデータモデルおよびストレージ設計。
- 埋め込み生成と検索ワークフロー設計。
- MCP ツール仕様（入出力、バリデーション、エラー）。
- 同時実行制御と運用上の配慮。

### 非スコープ
- クライアント実装。
- 埋め込みモデルそのものの実装（外部サービス／ライブラリを想定）。
- 完全な監視・アラート設計。

## 3. 前提条件・契約状況
- **Cloudflare**：既存アカウントを利用し、Workers / KV / D1 の Free プランを前提とする。運用中に閾値を超える場合のみ従量課金プランへ移行する。
- **OpenAI**：既存契約を利用し、Embeddings API の従量課金を前提とする。API キー管理は Cloudflare Secrets に集約。
- **Neon (Serverless PostgreSQL + pgvector)**：新規に Free プランを登録し、PoC/初期運用を進める。スケール要件が増した段階で Pro プラン以上へ移行する。
- **その他オプション**：分析や監査が必要になった場合にのみ、有料 SIEM や監視サービスを追加検討する。

## 4. ユースケース
1. **メモの登録**：任意のコンテンツとメタデータを含むメモを作成する。
2. **メモの更新**：既存メモの本文またはメタデータを更新する。
3. **メモの検索**：
   - 類似度検索：クエリテキストに近いメモを取得。
   - メタデータ検索：キー・値の条件でフィルタリング。
  - 混合検索：類似度上位からメタデータフィルタを適用。
  - Pivot 検索：既存メモの埋め込みを基点に類似メモを抽出。
4. **メモの削除**：不要になったメモを削除（オプション、権限前提）。

## 5. 全体アーキテクチャ
- **MCP サーバ**：TypeScript + Bun を採用し、Cloudflare Workers／Vercel Edge Functions 等のエッジ/serverless 実行環境にデプロイ。常時稼働インスタンスを不要にしつつ、低レイテンシで MCP ツール呼び出しを処理する。
- **埋め込みプロバイダ**：マネージド埋め込み API（例：OpenAI、Together AI）を利用。API クライアント層を抽象化し、モデル変更やフェイルオーバーに備える。
- **データストア**：Neon 等の serverless PostgreSQL + pgvector を利用し、スケールアウトとマネージド運用を両立。バックアップと自動スケールはサービス提供側に委任。
- **イベントドリブン補助**：更新イベントを Neon の logical replication もしくは Webhook で受け取り、非同期ジョブ（例：再計算）へ連携。初期段階では必須ではない。
- **キャッシュ/Key-Value（オプション）**：Cloudflare KV または Workers D1 を利用し、ホットデータの高速参照やレート制御を実現。

```
[MCP Client]
  ↕ HTTPS (MCP)
[Edge MCP Server (Workers)] ↔ [Embedding API]
                    ↕
                [Neon (Serverless PostgreSQL + pgvector)]
```

### 4.1 インフラ選定理由
- **軽量・自動スケール**：2025 年のサーバレス/エッジ潮流に沿い、利用分課金とゼロスケールを実現することでアイドルコストを抑制。
- **地理的近接性**：エッジ実行により、利用クライアントに近い POP で MCP 応答を返し、レイテンシを短縮。
- **マネージドベクターストレージ**：pgvector を備えた serverless Postgres は、最新の「ベクター検索×RDB」トレンドに合致し、構造化データとベクターを一元管理できる。
- **開発体験**：Bun + TypeScript により高速な開発ループと単一コードベースを確保し、MCP プロトコルとの親和性を高める。

## 6. データモデル
### 5.1 メモテーブル `memory_entries`
| カラム名 | 型 | 説明 |
| --- | --- | --- |
| `id` | UUID (PK) | 内部識別子 |
| `namespace` | TEXT | メモの名前空間（ユーザやアプリ単位） |
| `title` | TEXT 可 | 任意タイトル（オプション） |
| `content` | TEXT | メモ本文 |
| `content_embedding` | VECTOR(D) | 埋め込みベクトル（次元 D は設定値） |
| `metadata` | JSONB | 任意メタデータ（キー/値） |
| `created_at` | TIMESTAMPTZ | 自動付与作成日 |
| `updated_at` | TIMESTAMPTZ | 自動付与更新日 |
| `version` | INTEGER | 更新回数を表す楽観ロック用カウンタ |

### 5.2 インデックス
- `UNIQUE(namespace, id)`：名前空間内での一意性。
- `GIN(metadata)`：メタデータ検索高速化。
- `IVFFLAT(content_embedding)`：類似度検索高速化（pgvector）。

### 5.3 リレーションテーブル `memory_relations`
| カラム名 | 型 | 説明 |
| --- | --- | --- |
| `source_memo_id`, `target_memo_id` | UUID (複合 PK) | 関係元/先のメモ ID |
| `namespace` | TEXT | 関係の適用 namespace（メモと同一ルート内） |
| `tag` | TEXT | 関係種別ラベル（最大 64 文字） |
| `weight` | NUMERIC(3,2) | 信頼度（0.00〜1.00） |
| `reason` | TEXT | 関係理由の自由記述 |
| `created_at` / `updated_at` | TIMESTAMPTZ | タイムスタンプ |
| `version` | INTEGER | 楽観ロック用カウンタ |

外部キー：
- `(owner_id, namespace, source_memo_id)` → `memory_entries`
- `(owner_id, namespace, target_memo_id)` → `memory_entries`

インデックス：
- `(owner_id, namespace, source_memo_id, tag)`
- `(owner_id, namespace, target_memo_id, tag)`

削除時は `ON DELETE CASCADE` により該当リレーションを自動削除する。

### 5.4 追加テーブル（任意）
- `memory_audit_logs`：変更履歴（操作種別、差分、実行主体）。

## 7. MCP ツール設計
ツールセットはメモ操作とリレーション操作の 2 系統に整理する。

### メモ操作ツール

1. **`memory.save`**
   - 役割：メモの新規作成・更新（upsert）。
   - 入力：
     - `namespace` (string, 必須)
     - `content` (string, 必須)
     - `metadata` (object, 任意)
     - `memo_id` (string, 任意。指定時は既存更新)
     - `title` (string, 任意)
   - 出力：保存されたメモのサマリ（`memo_id`, `namespace`, `metadata`, `created_at`, `updated_at`, `version`）。
   - 処理：
     1. トランザクション開始。
     2. 新規または更新するレコードを行ロック。
     3. 必要に応じて埋め込み生成リクエスト。
     4. `content_embedding` と `updated_at` `version` を更新。
     5. コミット。

2. **`memory.search`**
   - 役割：類似・メタデータ検索。
   - 入力：
     - `namespace` (string, 必須)
     - `query` (string, 任意：類似度検索に使用)
     - `metadata_filter` (object, 任意：部分一致/正確一致指定)
     - `k` (integer, デフォルト 10)
     - `minimum_similarity` (float, 任意。`distance_metric = cosine` のときのみ有効)
     - `pivot_memo_id` (uuid, 任意：指定時は該当メモの埋め込みで検索)
     - `distance_metric` (enum: `cosine` | `l2`, 既定は `cosine`)
     - `exclude_pivot` (boolean, 既定 true)
   - 出力：`items[]` 各オブジェクトに `memo_id`, `content`, `score`, `metadata`, `created_at`, `updated_at`。
   - 処理：
     1. 類似検索用ベクトル生成（`query` がある場合）または pivot メモの `content_embedding` を取得。
     2. pgvector による距離計算（`cosine` / `l2`）とソート。
     3. メタデータフィルタ適用（SQL `WHERE`）。

3. **`memory.delete`**（オプションだが初期から用意）
   - 入力：`namespace`, `memo_id`。
   - 処理：楽観ロックで削除。
   - 出力：削除結果（成功/対象なし）。

### リレーション操作ツール

4. **`memory.relation.save`**
  - 役割：2 つのメモ間にタグ付きの意味的関連を作成・更新する。
  - 入力：
    - `namespace` (string, 任意。未指定時はデフォルト namespace)
    - `sourceMemoId`, `targetMemoId` (UUID, 必須)
    - `tag` (string, 必須・最大 64 文字)
    - `weight` (float, 0.0〜1.0)
    - `reason` (string, 任意)
  - 出力：保存されたリレーションのサマリ（`namespace`, `sourceMemoId`, `targetMemoId`, `tag`, `weight`, `reason`, `created_at`, `updated_at`, `version`）。
  - 処理：`INSERT ... ON CONFLICT` により UPSERT。`weight` か `reason` が変化した場合は `version` をインクリメント。

5. **`memory.relation.delete`**
  - 役割：指定したリレーションを削除。
  - 入力：`namespace`, `sourceMemoId`, `targetMemoId`, `tag`。
  - 出力：削除結果と削除レコードのスナップショット。
  - 処理：`DELETE ... RETURNING`。対象が無い場合は `NOT_FOUND` を返却。

6. **`memory.relation.list`**
  - 役割：名前空間内のリレーションを列挙し、グラフ構造として返却。
  - 入力：`namespace` (任意), `sourceMemoId` / `targetMemoId` / `tag` (任意フィルタ), `limit` (1〜500)。
  - 出力：`edges[]`（リレーション一覧）と `nodes[]`（参照されたメモノード）。
  - 処理：条件一致した `memory_relations` を取得し、関連メモを `memory_entries` から引き当てる。

7. **`memory.relation.graph`**
  - 役割：起点メモからリレーションを深さ制限付きでトラバースし、路径情報を返却。
  - 入力：
    - `namespace` (任意)
    - `startMemoId` (uuid, 必須)
    - `direction` (enum: `forward` | `backward` | `both`、既定は `forward`)
    - `maxDepth` (1〜10、既定 3)
    - `tag` (任意フィルタ)
    - `limit` (1〜1000)
  - 出力：`edges[]` に `depth`, `direction`, `path`（JSON 配列）を含め、`nodes[]` は参照されたメモノード。
  - 処理：PostgreSQL の再帰 CTE を用いて順方向・逆方向の探索を行い、ループを検出しながら限定件数を取得。

### エラーハンドリング指針
- バリデーションエラー：`INVALID_ARGUMENT`。
- 見つからない：`NOT_FOUND`。
- 同時更新衝突：`CONFLICT`（クライアントにリトライ促す）。
- 外部サービス失敗：`UNAVAILABLE` を返し、ログへ。

## 8. 処理フロー詳細
### 7.1 保存フロー
1. ユーザが `memory.save` を呼ぶ。
2. サーバで入力検証、`namespace` と `content` は必須。
3. `memo_id` 未指定の場合は新規 UUID を採番。
4. 埋め込みサービスへ `content` を送ってベクトル取得。エッジ環境から利用できるリージョンを優先し、フェイルオーバーとして複数ベンダを設定。
5. DB トランザクション内で `INSERT ... ON CONFLICT`（`namespace`,`id`）でアップサート。
6. `updated_at` を `NOW()`、`created_at` は新規時のみ設定。
7. `metadata` は JSON マージ（既存と統合／クライアント指定に従う）。
8. 成功レスポンス返却。

### 7.2 検索フロー
1. クライアントが `query` と任意フィルタを渡して `memory.search` を呼ぶ。
2. `query` があれば埋め込みを生成。なければメタデータのみ検索。
3. SQL：
   ```sql
   SELECT *, 1 - (embedding <=> :query_vector) AS score
   FROM memory_entries
   WHERE namespace = :ns
     AND metadata @> :metadata_filter
     AND (:min_score IS NULL OR 1 - (embedding <=> :query_vector) >= :min_score)
   ORDER BY embedding <-> :query_vector
   LIMIT :k;
   ```
4. 結果を MCP フォーマットに整形。

### 7.3 削除フロー
1. `memory.delete` で `namespace`, `memo_id` 受領。
2. `DELETE FROM memory_entries WHERE namespace = :ns AND id = :id`。
3. 削除件数 0 の場合は `NOT_FOUND`。

## 9. 同時実行と排他
- Neon serverless PostgreSQL は自動スケールするため、接続数制約を避けるべく PgBouncer 相当のコネクションプール（Neon 側のプール機能）を利用。
- トランザクション分離レベルは `READ COMMITTED`。serverless 実行環境からの短命接続でも一貫性を確保。
- `memory.save` は `INSERT ... ON CONFLICT DO UPDATE` を利用し、更新時は行ロックで整合性確保。
- `version` カウンタをレスポンスに含め、クライアントが次回更新時に送信することで楽観ロックも併用可能（オプション）。
- VACUUM/ANALYZE は Neon の自動メンテナンスに依拠しつつ、統計異常時のみ手動トリガを実施。

## 10. セキュリティ・権限
- 名前空間レベルでの API キー認証を実装し、Zero Trust Access（Workers AI Access Rules 等）と組み合わせてサーバレス環境でも最小権限を徹底。
- シークレットは実行基盤の Secrets Manager（Workers Secrets / Vercel Environment Variables）で管理し、ローテーションを自動化。
- 監査用に操作ログ（ユーザ ID、IP、操作種別）を記録し、Logpush/Chronicle など外部 SIEM へ転送。
- メタデータに含めた個人情報の取り扱いはクライアント責任。サーバ側で DLP ルールやサイズ制限を設定し、異常検知アラートを併用。

## 11. 運用・監視
- メトリクス：
  - 埋め込み生成時間、DB レイテンシ、成功/エラー件数。
  - エッジ実行時間/Cold Start 回数（Workers Insight など）。
- ログ：構造化 JSON 形式。Cloudflare Logpush などで集中管理。
- トレーシング：OpenTelemetry SDK を利用し、MCP リクエストから埋め込み API、DB までの分散トレースを記録。
- アラート：埋め込み失敗率や DB エラー率、エッジ実行のタイムアウトが閾値超過で通知。

## 12. 今後の拡張
- メタデータの部分一致検索の強化（正規化・全文検索）。
- TTL や自動アーカイブ機能。
- キャッシュ導入による検索性能向上。
- バッチ同期やバックアップ機構の整備。

## 13. 最新トレンドとの整合
- **Serverless / Edge First**：2025 年のクラウドトレンドでは serverless とエッジの組み合わせが主流化しており、常時稼働サーバを不要にすることでコスト最適化とスケール弾力性を確保する。
- **マネージドベクトル検索**：pgvector など RDB 統合型ベクトル検索が広がっており、構造化とベクトル検索を同一プラットフォームで扱えるためデータ重複を回避できる。
- **組み込み AI サービス**：外部埋め込み API を抽象化し、モデルアップデートやマルチベンダを扱うことでイノベーションスピードに追随する。
- **セキュアなデータシェアリング**：共有メモリ領域でも最小権限 API キーと監査ログを組み合わせることで、プライバシー要件に対応する。
