# @mako10k/mcp-memo のリリース手順

`npm publish` に必要な準備とコマンドをまとめます。リリース作業はリポジトリルートで実施してください。

## 1. バージョンの更新

```bash
npm version patch --workspace packages/stdio
```

`patch` の代わりに `minor` / `major` も選択できます。バージョンは `packages/stdio/package.json` に反映され、`git` のタグは後で手動で付与します。

## 2. ビルドとテスト

```bash
bun run --cwd packages/stdio build
bun test
```

エラーがあれば修正してから再度実行します。

## 3. 認証情報の設定

```bash
npm login
```

必要に応じて `npm config set access public` を実行してください。

## 4. 公開

```bash
npm publish --workspace packages/stdio --access public
```

※ 実際の公開は権限のある環境でのみ実行してください。CI で自動化する場合は `NPM_TOKEN` を利用します。

## 5. タグとリリースノート

```bash
git tag -a mcp-memo@<version> -m "mcp-memo <version>"
git push origin main --tags
```

リリースノートには以下の項目を含めるとよいでしょう。

- 追加・変更されたツール
- 互換性に関する注意点 (Node / npm バージョン)
- 必要な環境変数
