// 日本語・英語の切り替え。文言は使う場所で L('日本語', 'English') と書く
let lang = 'ja';
try { lang = localStorage.getItem('kaizoku.lang') || ((navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'); } catch (e) { lang = (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'; }

export function getLang() { return lang; }
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('kaizoku.lang', l); } catch (e) { /* 保存できなくても遊べる */ }
  applyHTML();
}
export const L = (ja, en) => (lang === 'en' ? en : ja);

// かな → ローマ字（ヘボン式・長音は省く）
const K1 = { あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po' };
const K2 = { きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', しゃ: 'sha', しゅ: 'shu', しょ: 'sho', ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo', みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo', じゃ: 'ja', じゅ: 'ju', じょ: 'jo', びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo' };
export function romaji(kana) {
  let out = '';
  for (let i = 0; i < kana.length; i++) {
    const two = kana.slice(i, i + 2);
    if (K2[two]) { out += K2[two]; i++; continue; }
    const c = kana[i];
    if (c === 'っ') { const nx = K2[kana.slice(i + 1, i + 3)] || K1[kana[i + 1]] || ''; out += nx[0] === 'c' ? 't' : nx[0] || ''; continue; }
    if (c === 'ー') continue;
    out += K1[c] || c;
  }
  // 長音を詰める（しょう → sho, おお → o）
  out = out.replace(/ou(?=[^aeiou]|$)/g, 'o').replace(/uu/g, 'u').replace(/oo(?=[^aeiou]|$)/g, 'o');
  return out.charAt(0).toUpperCase() + out.slice(1);
}
export function islandName(isl) { return lang === 'en' ? romaji(isl.kana || isl.name) : isl.name; }

// HTML の data-ja / data-en を入れ替える
export function applyHTML() {
  document.documentElement.lang = lang;
  document.body.classList.toggle('lang-en', lang === 'en');
  for (const el of document.querySelectorAll('[data-en]')) {
    if (!el.dataset.ja) el.dataset.ja = el.innerHTML;
    el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.ja;
  }
  for (const b of document.querySelectorAll('.lang-btn')) b.classList.toggle('on', b.dataset.lang === lang);
  document.title = L('瀬戸内の海賊王', 'Pirate King of the Seto Inland Sea');
}
