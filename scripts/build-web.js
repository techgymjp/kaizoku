// Android / iOS アプリに同梱する Web ファイルを www/ にコピーする
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const item of ['index.html', 'howto.html', 'style.css', 'js', 'data', 'assets/audio']) {
  const src = path.join(root, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, item), { recursive: true });
}
// Google Play / App Store 用のビルドでは本番の広告を使う
const mode = process.env.ADMOB_MODE === 'production' ? 'production' : 'test';
fs.writeFileSync(path.join(out, 'js', 'ads-config.js'), `// ビルド時に生成\nwindow.AD_MODE = '${mode}';\n`);
// タイトル画面に出すバージョン（CI では VERSION_NAME / VERSION_CODE を使う）
const pkgVersion = require('../package.json').version;
const version = process.env.VERSION_CODE ? `v${process.env.VERSION_NAME || pkgVersion} (build ${process.env.VERSION_CODE})` : 'dev';
fs.writeFileSync(path.join(out, 'js', 'build-info.js'), `// ビルド時に生成\nwindow.APP_VERSION = '${version}';\n`);
// 読み込みの版番号（index.html が見る）
fs.writeFileSync(path.join(out, 'version.txt'), (process.env.VERSION_CODE || pkgVersion).toString());
console.log(`built web assets into www/ (ads: ${mode}, version: ${version})`);
