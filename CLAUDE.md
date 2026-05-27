# graph-tool

## PR作成時のルール

### 実装プランの記載
PRのdescriptionに、実装プランの内容を `<details>` タグで折りたたんで記載してください。

```markdown
<details>
<summary>実装プラン</summary>

（プランの内容）

</details>
```

### Test Plan
PRのdescriptionにTest Planを記載してください。Test Planには、手動での動作確認手順をチェックリスト形式で記載してください。

PRを作成したら、実際にブラウザで動作確認を行ってください。

### スクリーンショットとGyazoアップロード
ブラウザでの動作確認中は、スクリーンショットを適宜撮影し、Gyazo CLI経由でアップロードしてください。

```bash
gyazo <screenshot-path>
```

### 動作確認結果の追記
動作確認の完了後、結果をPRのdescriptionに追記してください。結果には撮影したスクリーンショットのGyazo画像URLを記載してください。
