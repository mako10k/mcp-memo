# メモ間リレーション機能 実装計画

## 背景と目的
- 既存の `memory.save` / `memory.search` では、類似度ベクトルだけでメモ間の意味的な繋がりを表現しにくい。
- LLM エージェントからの推論支援や知識グラフ構築を見据え、メモ間を有向エッジで結ぶ仕組みが必要。
- 「理由付き関連付け」「重み付け」を持ったリンクを保存・検索できるようにすることで、高品質な回答や探索体験を提供することが狙い。

## 要求仕様
- **ツール名**: `memory.relation.save`（ほか `relation.delete` / `relation.list` を追加予定）
- **入力項目**:
  - `sourceMemoId` (UUID): 元メモ ID
  - `targetMemoId` (UUID): 先メモ ID
  - `tag` (string): 関係タグ。名称規約を定め、最大長は 64 文字以内
  - `weight` (float): 0.0〜1.0 の信頼度
  - `reason` (string): Text。理由や根拠を記録
  - `namespace` (string, optional): 明示指定が無い場合は現在のデフォルト namespace を利用
- **制約条件**:
  - `sourceMemoId` と `targetMemoId` はいずれも同一 `ownerId` に紐づく既存メモであること
  - 名前空間越えを許容する場合でも `ownerId` は一致させる
  - `weight` は `0.0 <= weight <= 1.0`
  - 同一 `(ownerId, namespace, sourceMemoId, targetMemoId, tag)` の重複登録は禁止（`UPSERT` 時に更新）
- **削除動作**: `memory.delete` でメモが削除された場合、source/destination いずれ側でも関連レコードをカスケード削除
- **Export/Synchronization**: 将来的にグラフ構造として扱えるように、`relation.list` のレスポンスをノード/エッジ構成に拡張可能な JSON 形状にする
- **監査性**: `createdAt`, `updatedAt`, `version` を保持

## データモデリング
- Neon / PostgreSQL に新テーブル `memory_relations`
  ```sql
  CREATE TABLE memory_relations (
    owner_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    source_memo_id UUID NOT NULL,
    target_memo_id UUID NOT NULL,
    tag TEXT NOT NULL,
    weight NUMERIC(3,2) NOT NULL CHECK (weight >= 0 AND weight <= 1),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (owner_id, namespace, source_memo_id, target_memo_id, tag),
    FOREIGN KEY (owner_id, namespace, source_memo_id) REFERENCES memory_entries(owner_id, namespace, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id, namespace, target_memo_id) REFERENCES memory_entries(owner_id, namespace, id) ON DELETE CASCADE
  );
  ```
  - `NUMERIC(3,2)` で `0.00`〜`1.00` を表現
  - 名前空間越えを許可する場合は FK の namespace を分離する（`source_namespace`, `target_namespace` を別カラムとして保存）
  - クエリ効率のため、必要に応じて `INDEX` を付与
    ```sql
    CREATE INDEX ON memory_relations (owner_id, namespace, source_memo_id, tag);
    CREATE INDEX ON memory_relations (owner_id, namespace, target_memo_id, tag);
    ```
- `memory_entries` 既存テーブルとの整合性確保のため、アプリロジックでも存在チェックを行う

## API / MCP 拡張
1. **Shared スキーマ (`packages/shared`)**
   - Zod スキーマ追加: `relationSaveInputSchema`, `relationListInputSchema`, `relationDeleteInputSchema`
   - `weight` 用のバリデーション (`z.number().min(0).max(1)`)
   - レスポンス型: `RelationEntry` `{ sourceMemoId, targetMemoId, tag, weight, reason, createdAt, updatedAt, version }`
   - `toolInvocationSchema` に新ツールを追加

2. **サーバーハンドラ (`packages/server`)**
   - `handleInvocation` に `memory.relation.save`, `memory.relation.delete`, `memory.relation.list` を追加
   - `resolveNamespace` により namespace を検証し、root を越えないことを保証
   - 新しいストアレイヤ: `createRelationStore(env)` を `db.ts` で追加
     - `save`, `delete`, `listBySource`, `listByTarget`
     - `weight` 更新時は `version` をインクリメント
   - `memory.delete` 時に関連レコード削除を呼び出す（DB の FK カスケードと二重化するか、FK に一任するかを選択）

3. **STDIO アダプタ (`packages/stdio`)**
   - MCP ツールとして公開するメタデータを追加
   - レスポンス JSON は既存方針に合わせ、`rootNamespace` を含めつつノード/エッジ形式も拡張しやすい構造にする

4. **テスト**
   - `packages/server/src/index.test.ts`
     - 正常系: relation save → list
     - 重複登録禁止: 同じタグで保存 → `weight` と `reason` 更新されること
     - カスケード削除: メモ削除が relation を削除するか
     - namespace エスケープ拒否
   - `packages/stdio` のエンドツーエンドテスト（MCP ツール呼び出し）

## マイグレーション戦略
- 現状マイグレーション管理ツールが未導入のため、以下いずれかを採用:
  1. **Drizzle Kit**: Bun でも利用しやすく、SQL ファイル生成＆実行を統合できる。
  2. **Kysely + Umzug**: TypeScript ベースで柔軟だが設定が増える。
- 初回導入手順（Drizzle Kit の例）
  1. `packages/server` に `drizzle.config.ts` を追加し、Neon 接続情報を参照
  2. `npm install -D drizzle-orm drizzle-kit`（ルートで）
  3. `schema/relations.ts` を作成し、`memory_relations` テーブル定義を記述
  4. `npx drizzle-kit generate:pg` でマイグレーション SQL を生成
  5. `npx drizzle-kit push:pg` で Neon へ反映
- CI/CD にマイグレーション実行ステップを追加し、本番デプロイ時に自動反映できるようにする

## Export / Graph 拡張方針
- `relation.list` レスポンスは初期段階から以下のような形にしておく:
  ```json
  {
    "rootNamespace": "team/a",
    "nodes": [
      { "memoId": "...", "title": "..." }
    ],
    "edges": [
      {
        "sourceMemoId": "...",
        "targetMemoId": "...",
        "tag": "supports",
        "weight": 0.8,
        "reason": "...",
        "createdAt": "..."
      }
    ]
  }
  ```
- 将来的に外部グラフ DB へエクスポートする際も同じ構造を流用可能。
- 手動/自動同期用のエンドポイントを用意する場合、`since` フィルタ（更新日時ベース）を持たせる。

## 実装手順サマリ
1. マイグレーション管理ツールを導入し `memory_relations` テーブルを追加。
2. Shared スキーマに relation 用の型とツール定義を追加。
3. Server ドメインロジックに relation ストアとハンドラを実装。
4. STDIO アダプタで MCP ツールを公開。
5. テスト整備（ユニット + エンドツーエンド）。
6. ドキュメント更新（クライアント設定、API リファレンス、README）。
7. デプロイ後、`npm publish` / Cloudflare 反映のフローを実行。

## リスクと対応
- **循環参照**: グラフ化により循環リンクが生まれる可能性がある。探索時の手当てとして BFS/DFS に深さ制限を設ける。
- **重み付けの統一性**: LLM が自動生成する場合ばらつきが大きい。テンプレートやガイドラインを提示する。
- **パフォーマンス**: リレーションが増えると `relation.list` が重くなる可能性。`LIMIT` / `OFFSET` や source/target 指定必須化で対策。
- **マイグレーション導入リスク**: 本番 DB への適用に失敗した場合のロールバック手順を明文化する。

## 次のアクション
- [ ] Drizzle Kit などマイグレーションツールの選定とセットアップ
- [ ] `memory_relations` スキーマとマイグレーション SQL 作成
- [ ] Shared/Server/Pub ツールのスキーマ拡張
- [ ] テストケース作成
- [ ] ドキュメント（クライアント設定含む）更新
