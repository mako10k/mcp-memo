# API キー発行ガイド

`api_keys` テーブルにレコードを追加して新しい API キーを発行する手順をまとめます。スクリプトは Bun 上で動作するため、事前に依存関係をインストールしておいてください。

## 前提条件

- `DATABASE_URL` が Neon (PostgreSQL) の接続文字列になっていること。
- マイグレーション `002_namespace_hierarchy.sql` まで適用済みであること。
- Bun 1.1 以上がインストールされていること。

## 発行コマンド

```bash
bun run --cwd packages/server create:api-key \
  --rootns acme \
  --defaultns DEF
```

実行すると下記のような JSON が標準出力に表示されます。

```json
{
  "id": "3f8e6c2d-3b68-4e0d-8f27-0c9a6f0a4b91",
  "ownerId": "3f8e6c2d-3b68-4e0d-8f27-0c9a6f0a4b91",
  "rootNamespace": "acme",
  "defaultNamespace": "acme/DEF",
  "status": "active",
  "createdAt": "2025-10-10T12:34:56.789Z",
  "token": "bW9jay1wbGFpbi10ZXh0LWZyb20tc2NyaXB0Ig"
}
```

- `token` がクライアントに配布する平文 API キーです。一度しか表示されないので、安全なストレージにコピーしてください。
- `ownerId` は `--owner` を省略した場合、自動的に新しい UUID が採番されます。同一ユーザに複数のキーを持たせたい場合は、同じ `--owner` を指定してスクリプトを実行してください。

## オプション

| フラグ | 説明 |
| --- | --- |
| `--owner <uuid>` | 既存の `owner_id` を使いまわしたいときに指定します。形式が UUID でない場合はエラーになります。 |
| `--status <active|revoked>` | 付与するキーの状態。既定値は `active`。登録直後から無効化しておきたい場合は `revoked` を指定します。 |
| `--database-url <url>` | 環境変数ではなくコマンド引数で接続文字列を指定したいときに利用します。 |
| `--defaultns <path>` | ルート名前空間からの相対パスでデフォルト名前空間を指定します。例: `DEF`、`projects/inbox`。必須。 |

## ルートとデフォルト名前空間の注意

- `--rootns` は API キーに割り当てるルート名前空間 (`chroot`) を指定します。例: `acme`。
- `--defaultns` はルート配下で `cd` したい初期場所を相対パスで指定します。例: `DEF`、`projects/inbox`。
- スクリプトは `--defaultns` にルート接頭辞が含まれている場合でも自動的に整形し、結果が必ずルート配下になるよう検証します。

## 既存キーの無効化

キーを無効化したい場合は、Neon 上で次のクエリを実行してください。

```sql
UPDATE api_keys
SET status = 'revoked', updated_at = NOW()
WHERE token_hash = '<sha256-hash>';
```

平文トークンを紛失した場合は、`sha256(token)` を計算した値を `token_hash` に指定します。必要であれば `create:api-key` スクリプトで新しいキーを再発行してください。
