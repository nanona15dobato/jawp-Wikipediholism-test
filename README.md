# あなたはウィキペディア中毒でしょうかテスト 採点サイト

https://github.nanona.me/jawp-Wikipediholism-test/

日本語版ウィキペディアの「Wikipedia:あなたはウィキペディア中毒でしょうかテスト」に はい／いいえ で答えると自動で採点するサイト。回答の確認・修正もできる。

## フォルダ構成

```
.
├── index.html          採点
├── kaito.html          回答確認
├── shusei.html         回答修正
├── offline.html        オフライン時に表示するページ
├── manifest.json       PWA の設定
├── sw.js               Service Worker（オフライン対応）
├── assets/
│   ├── quiz.css        3 ページ共通のスタイル（色は nanona-ui のトークンのみ）
│   └── img/
│       ├── icon-192.png, icon-512.png   PWA のアイコン
│       ├── ogp.png                      SNS 共有用の画像
│       └── old/                         v1 のアイコン（現在は未使用・保管）
├── data/
│   ├── questions/<版>.json   質問
│   └── answers/<版>.json     診断結果の文言
├── old/v1/             旧版（そのまま保管）
├── scripts/nn-pages.mjs        公開時に nanona-ui のヘッダー・フッターを差し込むツール
├── nanona.config.json          そのツールの設定（ヘッダーは github.nanona.me 共通）
└── .github/workflows/pages.yml GitHub Pages への公開
```

- ページ・`manifest.json`・`sw.js` はルートに置く（公開 URL と Service Worker の有効範囲を変えないため）
- 公開する中身を変えたら `sw.js` の `CACHE_NAME` を上げる
- 質問・回答の新しい版を足したら、`data/` に置き、`sw.js` の `URLS_TO_CACHE` も更新する

## ライセンス

CC BY-SA 4.0
