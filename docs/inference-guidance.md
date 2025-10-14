# Inference Guidance Tool

`memory-inference-guidance` は、MCP クライアントから推論ワークフロー全体（Phase 0〜4）を確認したいときに利用できるサマリーツールです。外部ドキュメントに依存せず、各フェーズで呼び出すべき `memory.*` ツールと推奨ペイロード例を返します。

## 使い方

MCP クライアントまたは HTTP 経由で次のように呼び出します。

```jsonc
{
  "tool": "memory.inference.guidance",
  "params": {}
}
```

レスポンス例（抜粋）:

```jsonc
{
  "language": "en",
  "summary": "Use the memory.* tool set ...",
  "phases": [
    {
      "id": "phase0",
      "documentation": "1. Invoke memory-list-namespaces ..."
    }
  ]
}
```

`documentation` フィールド内に、各フェーズで使用する MCP ツールの JSON ペイロード例が含まれます。レスポンスは常に英語です。

## 主なフィールド

- `summary`: 全体概要。
- `prerequisites`: 事前準備（環境変数など）。
- `phases`: フェーズごとの詳細。
  - `documentation`: 呼び出す MCP ツールと例示ペイロードを箇条書きで記載。
  - `recommendedTools`: 併用すべき `memory.*` ツール一覧。
  - `outputs`: そのフェーズで期待される成果。
  - `nextSteps`: 次のアクション候補。
- `followUp`: 定期運用のヒント。
- `references`: 現状は空配列。追加資料ができた際に利用予定。

## よくある利用シナリオ

- 新しい LLM エージェントがメモリサーバに接続する際、まず `memory-inference-guidance` を参照して必要ツール・入力形式を把握する。
- 手動推論のステップ確認用に、LLM プロンプトへレスポンスの内容を貼り付ける。
- `phase4` など自動化ロジックを実装する前に、どの準備が必要かを確認する。

## テスト

`bun test` を実行すると、`memory.inference.guidance` が正しい構造で返ることを確認する単体テストが含まれます。
