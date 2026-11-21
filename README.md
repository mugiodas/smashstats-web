# SmashStats iPhone Web版 — Phase 1（アプリ本体）

設計書: `~/workspace/smashstats-iphone-web/DESIGN.md`（§4・§8・§15 Phase 1の範囲だけ実装）

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | アプリ本体（単一ファイル、CSS/JSインライン、外部CDN依存なし） |
| `manifest.webmanifest` | PWAマニフェスト（standalone、テーマカラー `#0C3E63`） |
| `sw.js` | Service Worker。アプリの殻（index.html / manifest / アイコン）だけキャッシュ。試合データはキャッシュしない |
| `icon-180.png` / `icon-192.png` / `icon-512.png` | アプリアイコン（180pxはiPhone用）。タスク外の追加ファイルだが、PWAのインストールに必要なため同梱 |
| `README.md` | このファイル |

## 動作環境

- iPhone Safariで開き、共有ボタン →「ホーム画面に追加」して使う（PWA）。
- オフラインで動く。初回はオンラインで開いてService Workerを登録させること。
- ローカル確認: `python3 -m http.server 8000` でこのフォルダを配信し、`http://localhost:8000/index.html` を開く。

## Phase 1で入っているもの

- 5タブ（ホーム / 試合 / 登録 / 分析 / 用具）＋設定。下部タブバー、390px基準、Safe Area対応。
- IndexedDB（DB名 `smashstats-web`）: 9ストア（players / matches / gears / gear_maintenances / venues / opponent_profiles / opponent_custom_items / focuses / notes）＋ `_outbox` ＋ `_meta`。`scoresJson` は `SetScore[]` のJSON文字列のまま保持。
- 選手管理（追加・切替）。無料版は1名まで。
- 試合の登録・一覧・編集・削除。セットの動的行追加（スコア＋タイブレーク＋RET/WO/DEF）、モメンタム、団体戦、勝敗の自動判定。無料版は当月5試合まで。一覧は日付降順＋検索（相手名・大会名）＋勝敗フィルタ。
- ホーム: 現在のフォーカス、直近3試合、件数サマリ、未同期件数。
- 分析（最小限）: 総試合数・勝率・月別勝率・サーフェス別勝率。
- 用具（最小限）: ギア一覧・追加・編集・削除、張り替え日と経過日数・張り替え後試合数、張り替え記録。
- 設定: 言語切替（JA/EN、辞書オブジェクト方式）、テーマ切替（スタンダード / ミントペール）、JSON全量書き出し・取り込み（Android版と同じキー名）、デモデータ投入・削除、Pro表示（準備中）、データの置き場所（Phase 2予定の表示のみ）。
- 競技別スコア計算は純粋関数 `calcGameProgress` / `decideWinner` に集約（バドミントン21点・30点キャップ、テニス4ポイント/タイブレーク、卓球11点、ピックルボール11点）。ポイント入力シートからも呼ぶ。
- すべての書き込みは `_outbox` にも1件積む（Phase 2の同期が消費する）。
- `navigator.storage.persist()` を起動時に呼ぶ。ホーム画面追加の案内バナーを表示する。

## Phase 1で入っていないもの（Phase 2以降）

- スプレッドシート同期（共通Apps Script）、Stripe買い切り・ライセンス認証、分析レイヤーA〜Eの詳細、対戦相手・会場の画面、Instagram画像生成、AIプロンプト生成、CSV取り込み。

## 公開手順（GitHub Pages）

公開作業自体はこのフェーズでは行わない。承認後に行う手順のメモ:

1. リポジトリ（例: `mugiodas.github.io` 配下の新規リポジトリ、または既存リポジトリのサブディレクトリ）に `app/` の中身を置く。
2. GitHub Pagesの公開元をそのディレクトリに設定する。
3. 公開URL（例: `https://mugiodas.github.io/smashstats-web/`）をiPhone Safariで開き、ホーム画面に追加する。
4. 公開後の確認: 5タブの表示、試合登録→リロード後の残存、ホーム画面追加後の起動、オフライン（機内モード）での起動・登録。

## 既知の制限・注意

- Service Workerは `http(s)` でしか登録できない。`file://` で開いた場合はSWなしで動く（IndexedDBは動く）。
- 写真・動画は本体を保存しない。`photoPath` / `videoPathOrUrl` は参照文字列のみ。
- 会場（venues）・対戦相手（opponent_profiles）・ノート（notes）のストアはDBに用意済みだが、Phase 1の画面はまだない（JSON取り込み・書き出しでは扱える）。
- 無料枠の判定は端末内のみ（ライセンス認証はPhase 4）。
