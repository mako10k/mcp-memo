# MCPサーバ プロパティCRUD標準化・ライフサイクル管理 設計案

## 1. API仕様の統一
- create: プロパティ新規作成（namespace, memoId, name, value）
- update: 既存プロパティの値更新（同上）
- delete: プロパティ削除（value=null または専用delete API）
- list: プロパティ一覧取得（namespace, memoId単位）
- レスポンス: `memory.property`/`memory.property.delete` は `action`（created/updated/deleted/noop）、`previousValue`、`changed` フラグを含む詳細な変更メタデータを返す
- `memory.property.list` はアルファベット順にソートしたスナップショット一覧を返し、メモの最新状態も同梱

## 2. ライフサイクルイベント通知/監視
- 各CRUD操作時にイベント発火（created, updated, deleted）
- イベントはWebHook/Queue/ログ等で外部通知可能
- 監視APIで履歴取得（オプション）

## 3. 既存APIとの互換性
- 既存のset/get/delete/list APIは維持
- value=nullによる削除もサポート
- 新API追加時はバージョン管理・互換性テスト

## 4. テスト・ドキュメント更新
- CRUD操作のユニットテスト追加
- ライフサイクルイベントのテスト
- API仕様・利用例をREADME/公式ドキュメントに反映

---

【次の実装タスク】
1. API定義（OpenAPI/TypeScript型/handler設計）
2. イベント設計（通知方式・履歴管理）
3. 互換性検証（既存クライアント/テスト）
4. テスト追加
5. ドキュメント修正
