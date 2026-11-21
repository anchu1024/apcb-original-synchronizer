# APCB Original Synchronizer

AtCoderの講義用特設コンテストで提出がACになったとき、その提出コードと言語を本家コンテストの対応問題へ引き継ぐTampermonkey用スクリプトです。

このスクリプトは提出を自動送信しません。本家問題ページへコードと言語を転記するだけで、最後の「提出」ボタンは利用者が手動で押します。

## 対応環境

- Google Chrome
- [Tampermonkey](https://www.tampermonkey.net/)（推奨）
- AtCoderへログイン済みのブラウザ

Tampermonkey以外の拡張機能としての導入は、このリポジトリには含まれていません。Chromeで利用する場合は、現時点ではTampermonkey経由の導入を推奨します。

## 導入手順

### 1. TampermonkeyをChromeに追加する

1. Chromeウェブストアから **Tampermonkey** をインストールします。
2. Chromeの拡張機能メニューからTampermonkeyを開きます。
3. Tampermonkeyのダッシュボードを開きます。

### 2. このスクリプトを登録する

次のいずれかの方法で登録します。

#### 方法A: ダッシュボードから直接作成する

1. Tampermonkeyダッシュボードの「Utilities」またはスクリプト一覧を開きます。
2. 「Create a new script」を選択します。
3. [`apcb-original-synchronizer.user.js`](./apcb-original-synchronizer.user.js) の内容をすべて貼り付けます。
4. `Ctrl+S`（macOSでは`Cmd+S`）で保存します。

#### 方法B: スクリプトの生ファイルを開く

1. GitHub上の [`apcb-original-synchronizer.user.js`](./apcb-original-synchronizer.user.js) をブラウザで開きます。
2. Tampermonkeyに自動インストールできる画面が表示されたら「Install」を押します。
3. すでに同名のスクリプトがある場合は、上書きするか別バージョンとして確認します。

スクリプト一覧で `APCB Original Synchronizer` が有効になっていることを確認してください。

## 使用方法

1. 講義用特設コンテスト（`apcb_exercise_*`）で通常通り提出します。
2. 提出詳細画面でステータスが `AC` になると、対応する本家問題のタブが自動で開きます。
3. 本家問題ページでコードと言語名が入力された状態になっていることを確認します。
4. 問題文に従って内容を確認し、最後の「提出」ボタンを利用者自身で押します。

提出を押した場合のみ、本家AC記録として保存されます。

## 動作ルール

- 対象講義コンテストは、デフォルトでコンテストIDが `apcb_exercise_` で始まるものです。
- 本家問題URLはタスクIDの先頭アンダースコア前の部分から文字列変換で生成します。
- サーバーへの連続自動アクセスや連続自動提出は行いません。
- 1回の講義側ACにつき、本家タブは原則1回のみ開きます。
- 未提出のまま本家タブを閉じると記録は保存されません。講義側の提出詳細画面から再度開いてください。
- 引き継ぎデータには10分の有効期限があります。

## 設定

スクリプト冒頭の `CONFIG` を変更できます。

```javascript
const CONFIG = Object.freeze({
  LECTURE_CONTEST_REGEX: /^apcb_exercise_/,
  PENDING_TRANSFER_TTL_MS: 10 * 60 * 1000,
  SUBMITTED_TASKS_KEY: "submitted_tasks",
  PENDING_TRANSFER_KEY: "pending_transfer"
});
```

講義コンテスト名の規則を変更する場合は、通常 `LECTURE_CONTEST_REGEX` だけを変更します。

## 記録の解除

特設コンテストの問題一覧または提出一覧では、本家AC記録済み問題に `[本家AC記録済]` バッジと `[解除]` ボタンが表示されます。

提出詳細画面でも、すでに記録済みの場合は `[本家AC記録済]` バッジと `[記録解除]` ボタンが表示されます。解除する際は確認ダイアログが表示されます。

すべての記録をまとめて削除する場合は、Tampermonkeyダッシュボードの「Storage」またはブラウザのストレージ消去機能から、拡張機能スクリプトの `submitted_tasks` を削除できます。

## よくあるトラブル

### 本家タブが開かない

- Tampermonkeyで `APCB Original Synchronizer` が有効になっているか確認します。
- タブポップアップのブロック設定を確認します。
- 提出詳細URLが特設コンテストの範囲か確認します。
- スクリプトの「Check for updates」を行ってからブラウザを再読み込みします。

### コードが入力されない

- 本家タブが完全に読み込まれるまで数秒待ちます。
- ページ上のエディタがCodeMirrorまたは通常のtextareaとして表示されていることを確認します。
- ブラウザのコンソールにエラーがないか確認し、ページを再読み込みします。

### 言語が一致しない

- 本家問題ページの言語選択肢と提出画面の表示名が完全一致またはプレフィックス一致するか確認します。
- 一致しない場合は、本家問題ページで言語を手動選択してください。

### 本家AC記録が残ってしまう

- `[本家AC記録済]` または `[記録解除]` ボタンから解除します。
- 必要に応じて保存中の `submitted_tasks` を削除します。
