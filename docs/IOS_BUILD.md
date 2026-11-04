# iOS 版をビルドして App Store に出す手順（Mac での作業）

瀬戸内の海賊王の iOS 版は、Android 版と同じ Capacitor で作っています（`ios/` フォルダ）。構成は JET STRIKE（techgymjp/jet-fighter）と同じです。
コードの準備はできているので、Mac では「ビルドして App Store Connect にアップロードする」作業だけを行います。

- Bundle ID：`jp.techgym.kaizoku`（Android と同じ）
- チーム：Team ID `GNM3VTX9YG`（Xcode の設定に入れてあります）。Apple Developer には**個人で登録**しています（App Store の販売元は個人名になります）
- 対応端末：iPhone（**縦画面固定**）。iPad では iPhone 用の画面で動きます
- ホーム画面の名前：日本語「海賊王」／英語「Pirate King」
- 広告：AdMob（iOS 用のアプリと広告ユニット。バナー・インタースティシャル・リワード）。起動時に「トラッキングの許可」の確認画面が出ます
- 島の地形と空中写真は、遊んでいる間に国土地理院のサーバーから読み込みます（通信が必要）

> AdMob の iOS 用のアプリ ID は `ios/App/App/Info.plist` の `GADApplicationIdentifier`、本番の広告ユニット（バナー・インタースティシャル・リワード）は `js/ads.js` の `UNITS.ios.production` に入っています。広告ユニットを作り直したときは、新しい ID を Claude Code に渡して入れ直してもらいます。

---

## 0. 先にブラウザでやること（最初の1回だけ）

1. **Apple Developer**（developer.apple.com）→「Certificates, Identifiers & Profiles」→「Identifiers」→「＋」→「App IDs」→「App」
   - Description：`Pirate King of the Seto Sea`（英数字だけ。「〜」などの記号は使えないことがある）
   - Bundle ID：「Explicit」で `jp.techgym.kaizoku`
   - Capabilities：何もチェックしない
2. **App Store Connect**（appstoreconnect.apple.com）→「マイ App」→「＋」→「新規 App」
   - プラットフォーム：iOS ／ 名前：`瀬戸内の海賊王 〜姫路港から巌流島へ〜`（取れなければ `瀬戸内の海賊王`）／ プライマリ言語：日本語
   - バンドル ID：1 で登録したもの ／ SKU：`kaizoku`（あとから変更不可）／ ユーザアクセス：アクセス制限なし
3. **AdMob**
   - 「アプリを追加」→ **iOS** →「ストアに掲載されていない」で登録し、**バナー・インタースティシャル・リワード**の広告ユニットを作る
   - アプリ ID と広告ユニット ID 3 つを Claude Code に渡す
   - 「プライバシーとメッセージ」→「欧州の規制」のメッセージに iOS アプリも追加する

---

## 1. Mac の準備（最初の1回だけ）

1. **Xcode** を App Store からインストールする（数十 GB あるので時間がかかります）。インストール後に一度起動し、追加コンポーネントのインストールを済ませる
2. Xcode の「Settings…」→「Accounts」→「＋」で、Apple Developer に登録している Apple ID でサインインする（チームが個人名で表示されれば OK）
3. **Node.js**（LTS 版）を https://nodejs.org/ からインストールする
4. ターミナルでリポジトリを取得する
   ```bash
   cd ~/Desktop   # 置きたい場所（どこでもよい）
   git clone https://github.com/techgymjp/kaizoku.git
   cd kaizoku
   npm ci
   ```
   `git` がないと言われたら、表示に従って「コマンドライン・デベロッパツール」をインストールしてから、もう一度実行します。

2回目以降は、`cd kaizoku` のあと `git pull` と `npm ci` で最新にします。

---

## 2. 自分の iPhone で動作確認する（テスト広告）

```bash
npm run ios:sync    # ゲームのファイルを iOS のプロジェクトにコピー（テスト広告）
npm run ios:open    # Xcode で開く
```

1. iPhone を USB ケーブルで Mac につなぎ、iPhone で「このコンピュータを信頼」を許可する
2. iPhone の「設定」→「プライバシーとセキュリティ」→「デベロッパモード」をオンにする（再起動を求められます。項目がない場合は、Xcode で一度 iPhone を選ぶと表示されます）
3. Xcode の上部で、実行先に自分の iPhone を選ぶ
4. 左の「App」→「Signing & Capabilities」で、「Automatically manage signing」がオン、Team に自分（個人名）のチームが選ばれていることを確認する
5. ▶（Run）を押すと、iPhone にアプリが入って起動する

確認すること：
- 縦画面で全画面表示になる。体力の表示や案内がカメラの切り欠き（Dynamic Island）に隠れない
- トラッキングの確認画面が出る
- 操作できる、音が鳴る（「出航」を押したあとから鳴ります）
- 島に上陸できる（地形と写真の読み込みに少し時間がかかります）
- タイトル・一時停止・結果の画面で**テスト広告**のバナーが出る、出航・再開などで全画面広告が出る、討死のあと「広告を見て復活する」でリワード広告が出る
- シェアができる

---

## 3. App Store 用にビルドしてアップロードする（本番広告）

```bash
git pull && npm ci
npm run ios:release   # 本番の広告 ID でコピーする（ここが ios:sync と違う）
npm run ios:open
```

1. Xcode の左で「App」→「General」→「Identity」を開き、**Build の番号を前回より大きくする**（初回は 1。アップロードのたびに 2、3…と上げる。同じ番号は二度アップロードできない）。Version はストアに表示されるバージョン（1.0.0）
2. 上部の実行先を「**Any iOS Device (arm64)**」にする
3. メニューの「Product」→「**Archive**」（メニューバーは画面の最上部。全画面表示のときはマウスを上端に動かす）
4. 終わると Organizer が開くので、「**Distribute App**」→「**App Store Connect**」→「Upload」で進める（途中の確認は既定のまま「Next」でよい。「Xcode Cloud can automate…」は「Remind Me Later」で閉じてよい）
5. 10〜30 分ほどで、App Store Connect の「TestFlight」タブにビルドが表示される

輸出コンプライアンス（暗号化）の質問は、Info.plist で「独自の暗号化は使っていない」と設定済みなので、聞かれません。

**注意**：`ios:release` でビルドしたアプリは本番の広告が出ます。TestFlight で確認するときも、**本番の広告はタップしない**でください（AdMob のアカウント停止の対象）。Xcode から iPhone に直接入れて試すときは、`npm run ios:sync` でテスト広告に戻してから実行します。

---

## 4. TestFlight で確認する

1. App Store Connect の「TestFlight」→「内部テスト」でグループを作り、自分を追加する
2. iPhone に「TestFlight」アプリを App Store から入れ、届いた招待から瀬戸内の海賊王をインストールする
3. 初回の審査で求められることが多いので、**アプリの起動から遊ぶところまでを画面収録**しておく（iPhone のコントロールセンターの「画面収録」）

---

## 5. App Store Connect で審査に出す

文章は `docs/store/ios/listing.md`（名前・サブタイトル・プロモーション用テキスト・キーワード・概要）にまとめてあります。「配信」タブ（iOS App のバージョン 1.0.0）で入力します。

| 項目 | 入力内容 |
| --- | --- |
| バージョン | 「1.0」ではなく **1.0.0** にして保存する（アプリの Version と同じでないとビルドを選べない） |
| スクリーンショット | 「Dynamic Island 搭載 iPhone（中型ディスプレイ）」の欄に、`docs/store/ios/6.3inch/` の画像を入れる。日本語版（ja-）と英語版（en-）各 4 枚。このゲームは縦画面なので **1206 × 2622（縦向き）** |
| ヘッダ・検索結果 | 「ヘッダと検索結果」タブに `docs/store/ios/appstore-header-3840x1646.png` と `appstore-search-3840x2560.png`（ヘッダを入れたら検索結果も入れる） |
| 名前・サブタイトル・プロモーション用テキスト・キーワード・概要 | `docs/store/ios/listing.md` |
| サポート URL | https://techgym.jp/ |
| プライバシーポリシー URL（App 情報と「アプリのプライバシー」） | https://techgym.jp/privacy-policy/ |
| カテゴリ（App 情報） | ゲーム ／ アクション |
| コンテンツの配信権（App 情報） | 第三者のコンテンツを「**はい**」（国土地理院の地理院タイルを加工して使っている。国土地理院の利用規約では出典の表示で使える。タイトル画面と概要に出典を表示済み）。権利を持っているか、使用の許可があることを確認するチェックを入れる |
| 著作権 | 2026 TECH GYM K.K. |
| ビルド | TestFlight で確認したビルドを選ぶ |
| 年齢制限 | 質問に答える（刀・槍・鉄砲で人を倒す、船が爆発する表現あり。流血の描写なし。「まれ／軽度な漫画的または空想上の暴力」と「頻繁／極度な…」の間で、目安は「頻繁／強度の漫画的または空想上の暴力」） |
| App のプライバシー | AdMob が収集するデータを申告する（下記） |
| App Review に関する情報 | ログイン不要。連絡先を入力。**メモ**に下の「審査へのメモ」を貼る |

**App のプライバシー（AdMob を使うアプリの目安）**
Google の「Apple の App Store のデータ開示要件への準備」（AdMob のヘルプ）に、AdMob が収集するデータの一覧があります。必ずそちらを見て最終確認してください。目安は次のとおりです。

- 収集する：ID（デバイス ID）、使用状況データ（広告データ、製品の操作）、診断（クラッシュデータ、パフォーマンスデータ、その他の診断データ）、位置情報（おおよその場所）
- 目的：サードパーティ広告、アナリティクス
- ユーザーに関連付け：しない
- トラッキングに使用：デバイス ID と広告データは「する」

### 審査へのメモ（最初の提出から「メモ」に入れておく）

初回の審査で「Guideline 2.1 - Information Needed」が来ることが多いので、はじめから入れておきます。2.1 が来たら、同じ文に 4 章の画面収録を添えて返信します（動画が大きすぎて添付できないときは、Finder で右クリック →「選択したビデオファイルをエンコード」→ 720p で小さくする）。

```
1. Purpose and audience: Pirate King of the Seto Sea is a free action game for ages 13+. The player sails a pirate ship across a 3D model of Japan's real Seto Inland Sea, fights enemy ships with muskets and a cannon, lands on islands to fight historical samurai with a sword and spear, takes their treasure, and wins a final naval battle at Ganryujima.

2. How to use: No login or account is needed. On the title screen, choose Japanese or English and tap "Set sail". Use the joystick on the left to steer, and the buttons on the right to fire the guns and the cannon. Sail into a port marked by a golden pillar of light to land on an island; there, use the joystick to move and the buttons to attack. Tap the pause button and "Back to title" to save the game.

3. External services: Google AdMob (banner, interstitial and rewarded ads) with Google's consent form (UMP) and App Tracking Transparency. Rewarded ads are optional: watching one lets the player continue with full HP after being defeated (up to 3 times per game). Island terrain and aerial photos are loaded from the GSI Tiles map service of the Geospatial Information Authority of Japan (no account, no personal data). No other services or in-app purchases.

4. Regional differences: None, except that the ad consent form appears only where required (e.g. EEA/UK).

5. Regulated content / third-party material: The game is not in a regulated industry. The terrain, aerial photos and buildings are processed from GSI Tiles (Geospatial Information Authority of Japan), which may be used with attribution under the GSI terms of use; the attribution is shown on the title screen and in the App Store description. The battle system, sounds and main character come from our own game "Kobayakawa: Lone Samurai" (TECH GYM). All other graphics and music are original.
```

入力が終わったら「審査用に追加」→「審査へ提出」。

---

## 6. 公開後にやること

- AdMob で iOS アプリを App Store のアプリに紐づける（「アプリ」→ iOS の瀬戸内の海賊王 →「アプリの設定」）
- App Store からインストールして、起動・同意画面・トラッキングの確認・広告を確認する

---

## 7. 自動化の準備（2回目以降を GitHub Actions に任せる場合）

push するだけで GitHub Actions（GitHub の Mac 環境）がビルドし、TestFlight にアップロードできるようにするための準備です。
API キーと証明書は Apple Developer のチーム共通なので、**JET STRIKE などほかのゲームで作ったものをそのまま使えます**（.p12・.p8 のファイルとパスワードを保管していれば、作り直さなくてよい）。初めて作るときの手順は techgymjp/jet-fighter の `docs/IOS_BUILD.md` の 7 章にあります。

リポジトリの Settings → Secrets and variables → Actions（https://github.com/techgymjp/kaizoku/settings/secrets/actions）に、次の 5 つを登録します。

| 名前 | 内容 |
| --- | --- |
| `IOS_DIST_CERT_P12_BASE64` | 配布用の証明書（.p12）を変換した文字列 |
| `IOS_DIST_CERT_PASSWORD` | .p12 を書き出したときのパスワード |
| `ASC_KEY_ID` | App Store Connect の API キーのキー ID |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8_BASE64` | API キー（.p8）を変換した文字列 |

ファイルを文字列に変換してクリップボードにコピーするには、ターミナルで次を 1 つずつ実行し、そのつど GitHub に貼り付けます。

```bash
base64 -i 証明書.p12 | tr -d '\n' | pbcopy
```

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n' | pbcopy
```

5 つとも登録済みで、自動アップロードのワークフロー（`.github/workflows/ios-release.yml` と `scripts/ios_profile.py`。techgymjp/shutoko と同じもの）も入っています。既定のブランチに push するたびに、本番広告の設定でビルドし、ビルド番号（100 + 実行回数。Mac から手でアップロードする 1、2、… と重ならない）を自動で付けて、TestFlight にアップロードします。Actions の画面の「iOS release (TestFlight)」から手動でも動かせます。審査への提出は、これまでどおり App Store Connect で行います。

動かすには、Apple Developer に Bundle ID `jp.techgym.kaizoku` が登録されている（0 章の 1）ことと、App Store Connect にアプリが作られている（0 章の 2）ことが必要です。

**注意**：証明書（.p12）、そのパスワード、API キー（.p8）は、チャット・AI へのアップロード・リポジトリへのコミットで**絶対に共有しない**でください。登録したら「登録した」とだけ伝えれば十分です。

---

## つまずきやすいところ

| 症状 | 対処 |
| --- | --- |
| アップロードで「同じビルド番号がすでにある」 | General の Build の番号を上げてから Archive し直す |
| Signing でエラー（チームが選べない、証明書がない） | Xcode の Accounts で Apple ID にサインインし直し、Team に自分のチームを選ぶ。「Automatically manage signing」をオンにする |
| 実行先に iPhone が出ない | ケーブルをつなぎ直し、iPhone で「信頼」を許可。デベロッパモードをオンにする |
| 実行先に「iOS 26.x Not Installed」と出る | 「Get」で iOS のシミュレーターと部品をダウンロードする（8 GB ほど。Archive にも必要） |
| ビルドが古いゲームのまま | `npm run ios:sync`（または `ios:release`）を実行し忘れている。`git pull` してから実行し直す |
| ビルドを選ぼうとしても、アップロードしたビルドが出てこない | App Store Connect のバージョンが「1.0」のまま。1.0.0 に直して保存する |
| 「審査用に追加できません」 | 「コンテンツの配信権」と「アプリのプライバシー」のプライバシーポリシー URL が入っているか確認する |
| 6.9 インチのスクリーンショットがアップロードできない | 欄が「中型ディスプレイ」。`docs/store/ios/6.3inch/` の画像を使う |
| 島に上陸すると、地形が出るまで時間がかかる・出ない | 通信が必要。Wi-Fi か電波のよい所で試す |
| 本番広告とテスト広告の取り違え | App Store 用は必ず `npm run ios:release`。Xcode から実機で試すときは `npm run ios:sync` に戻す |
| App Store の審査で「Xcode が古い」と言われる | Xcode を最新版に更新してから Archive し直す |
