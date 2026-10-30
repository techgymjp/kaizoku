// 瀬戸内の海賊王 — 地理・名所・橋・海域のデータ（座標は経度・緯度。高さ・長さは実際の m）

// 出発（大阪湾）とゴール（下関・唐戸）
export const START = { lon: 135.33, lat: 34.585, heading: Math.PI };
export const GOAL = { lon: 130.9440, lat: 33.9585, name: '下関・唐戸', en: 'Karato, Shimonoseki' };
// 壇ノ浦の決戦が始まる経度
export const FINAL_LON = 131.03;
export const DANNOURA = { lon: 130.962, lat: 33.963 };

// 橋：a, b は両岸（おおよそ）。実行時に標高データで海の部分を探して架ける
// towers: 主塔の位置（橋の長さに対する割合）、towerH / deck: 主塔の高さ・桁下の高さ（m）
export const BRIDGES = [
  { name: '明石海峡大橋', en: 'Akashi Kaikyō Bridge', type: 'suspension', a: [135.0335, 34.6310], b: [135.0150, 34.6015], towers: [0.2455, 0.7545], towerH: 298, deck: 70, color: '#93aea2', len: 3911 },
  { name: '大鳴門橋', en: 'Ōnaruto Bridge', type: 'suspension', a: [134.6625, 34.2445], b: [134.6430, 34.2385], towers: [0.255, 0.745], towerH: 144, deck: 45, color: '#e6ebe8', len: 1629 },
  { name: '下津井瀬戸大橋', en: 'Shimotsui-Seto Bridge (Great Seto Bridge)', group: '瀬戸大橋', type: 'suspension', a: [133.8015, 34.4400], b: [133.8095, 34.4190], towers: [0.17, 0.83], towerH: 149, deck: 45, color: '#a9b3b8', truss: 13, len: 1447 },
  { name: '櫃石島橋・岩黒島橋', en: 'Hitsuishijima & Iwakurojima Bridges (Great Seto Bridge)', group: '瀬戸大橋', type: 'cable', a: [133.8100, 34.4170], b: [133.8115, 34.4005], towers: [0.25, 0.75], towerH: 152, deck: 45, color: '#a9b3b8', truss: 13, len: 1580, span: 420 },
  { name: '与島橋', en: 'Yoshima Bridge (Great Seto Bridge)', group: '瀬戸大橋', type: 'girder', a: [133.8120, 34.3990], b: [133.8150, 34.3890], towers: [], towerH: 0, deck: 40, color: '#a9b3b8', truss: 13, len: 877 },
  { name: '北備讃瀬戸大橋', en: 'Kita Bisan-Seto Bridge (Great Seto Bridge)', group: '瀬戸大橋', type: 'suspension', a: [133.8170, 34.3840], b: [133.8195, 34.3600], towers: [0.2, 0.8], towerH: 184, deck: 45, color: '#a9b3b8', truss: 13, len: 1611 },
  { name: '南備讃瀬戸大橋', en: 'Minami Bisan-Seto Bridge (Great Seto Bridge)', group: '瀬戸大橋', type: 'suspension', a: [133.8195, 34.3600], b: [133.8240, 34.3330], towers: [0.18, 0.82], towerH: 194, deck: 45, color: '#a9b3b8', truss: 13, len: 1723 },
  { name: '新尾道大橋', en: 'Shin-Onomichi Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'cable', a: [133.2005, 34.4085], b: [133.2025, 34.4005], towers: [0.3, 0.7], towerH: 100, deck: 35, color: '#e8ece8', len: 546, span: 215 },
  { name: '因島大橋', en: 'Innoshima Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'suspension', a: [133.1830, 34.3650], b: [133.1745, 34.3490], towers: [0.2, 0.8], towerH: 146, deck: 50, color: '#e8ece8', len: 1270 },
  { name: '生口橋', en: 'Ikuchi Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'cable', a: [133.1570, 34.3065], b: [133.1420, 34.3015], towers: [0.19, 0.81], towerH: 125, deck: 40, color: '#e8ece8', len: 790, span: 490 },
  { name: '多々羅大橋', en: 'Tatara Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'cable', a: [133.0715, 34.2660], b: [133.0505, 34.2535], towers: [0.2, 0.8], towerH: 220, deck: 50, color: '#cfd9df', len: 1480, span: 890 },
  { name: '大三島橋', en: 'Ōmishima Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'arch', a: [133.0552, 34.2195], b: [133.0538, 34.2128], towers: [], towerH: 0, deck: 30, archH: 40, color: '#e8ece8', len: 328 },
  { name: '伯方・大島大橋', en: 'Hakata-Ōshima Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'suspension', a: [133.0735, 34.2015], b: [133.0665, 34.1895], towers: [0.25, 0.75], towerH: 90, deck: 30, color: '#e8ece8', len: 1165 },
  { name: '来島海峡大橋', en: 'Kurushima Kaikyō Bridge (Shimanami Kaidō)', group: 'しまなみ海道', type: 'suspension', a: [133.0420, 34.1395], b: [133.0030, 34.1045], towers: [0.1, 0.28, 0.4, 0.6, 0.68, 0.9], towerH: 184, deck: 65, color: '#e8ece8', len: 4105 },
  { name: '音戸大橋', en: 'Ondo Bridge', type: 'arch', a: [132.5400, 34.1958], b: [132.5345, 34.1938], towers: [], towerH: 0, deck: 23, archH: 18, color: '#d0321e', len: 172 },
  { name: '周防大島大橋', en: 'Suō-Ōshima Bridge', type: 'girder', a: [132.1960, 33.9490], b: [132.1820, 33.9370], towers: [], towerH: 0, deck: 31, color: '#5a8ab8', truss: 10, len: 1020 },
  { name: '関門橋', en: 'Kanmon Bridge', type: 'suspension', a: [130.9590, 33.9695], b: [130.9645, 33.9570], towers: [0.165, 0.835], towerH: 141, deck: 61, color: '#e8ece8', len: 1068 },
];

// 海から見える名所（海モードでは見やすいように少し大きく作る）
export const LANDMARKS = [
  { id: 'otorii', name: '厳島神社 大鳥居', en: 'the Great Torii of Itsukushima Shrine', kind: 'otorii', lon: 132.31890, lat: 34.29610, inSea: true, h: 16.6, rot: -0.75 },
  { id: 'itsukushima', name: '厳島神社', en: 'Itsukushima Shrine', kind: 'itsukushima', lon: 132.31990, lat: 34.29570, h: 10, rot: -0.75 },
  { id: 'miyajima-pagoda', name: '五重塔（厳島）', en: 'the five-storied pagoda of Miyajima', kind: 'pagoda', lon: 132.32210, lat: 34.29715, h: 29 },
  { id: 'joyato', name: '鞆の浦 常夜燈', en: 'the Jōyatō stone lantern of Tomonoura', kind: 'joyato', lon: 133.38085, lat: 34.38305, h: 10 },
  { id: 'tomo-gangi', name: '鞆の浦 雁木', en: 'the gangi stone steps of Tomonoura', kind: 'gangi', lon: 133.38120, lat: 34.38270, h: 4, rot: 0.3 },
  { id: 'taichoro', name: '福禅寺 対潮楼', en: 'Taichōrō hall, Fukuzen-ji', kind: 'hall', lon: 133.38340, lat: 34.38270, h: 9 },
  { id: 'benten', name: '弁天島（鞆）', en: 'Bentenjima, Tomonoura', kind: 'stupa', lon: 133.38630, lat: 34.37950, h: 8 },
  { id: 'senkoji', name: '千光寺（尾道）', en: 'Senkō-ji temple, Onomichi', kind: 'hall', lon: 133.19870, lat: 34.41180, h: 12 },
  { id: 'kosanji', name: '耕三寺', en: 'Kōsan-ji temple', kind: 'pagoda', lon: 133.09020, lat: 34.30370, h: 18, color: '#e0e0d8' },
  { id: 'oyamazumi', name: '大山祇神社', en: 'Ōyamazumi Shrine', kind: 'shrine', lon: 133.00660, lat: 34.24880, h: 10 },
  { id: 'pumpkin', name: '直島 南瓜', en: 'the yellow Pumpkin of Naoshima', kind: 'pumpkin', lon: 133.98950, lat: 34.44510, h: 2.5 },
  { id: 'angelroad', name: 'エンジェルロード', en: 'Angel Road', kind: 'sandbar', lon: 134.17600, lat: 34.48830, h: 1 },
  { id: 'akama', name: '赤間神宮 水天門', en: 'the Suitenmon gate of Akama Shrine', kind: 'suitenmon', lon: 130.94850, lat: 33.96000, h: 12 },
  { id: 'dannoura', name: '壇ノ浦古戦場', en: 'the Dan-no-ura battlefield', kind: 'tomomori', lon: 130.95740, lat: 33.96820, h: 6 },
  { id: 'mojiko', name: '和布刈神社', en: 'Mekari Shrine', kind: 'shrine', lon: 130.96430, lat: 33.96060, h: 6 },
  { id: 'tomogashima', name: '友ヶ島灯台', en: 'Tomogashima Lighthouse', kind: 'lighthouse', lon: 135.0020, lat: 34.2800, h: 12 },
];

// 渦潮・急流（船を引き込み、ゆさぶる）
export const WHIRLPOOLS = [
  { name: '鳴門の渦潮', en: 'Naruto whirlpools', lon: 134.6520, lat: 34.2395, r: 450, power: 1.0 },
  { name: '来島海峡の潮流', en: 'Kurushima Strait currents', lon: 133.0230, lat: 34.1230, r: 600, power: 0.7 },
  { name: '早鞆の瀬戸', en: 'Hayatomo Strait currents', lon: 130.9630, lat: 33.9630, r: 350, power: 0.6 },
];

// 海域（東から西へ）。faction: 出てくる海賊
export const ZONES = [
  { lon: 135.6, name: '大阪湾', en: 'Osaka Bay', faction: { name: '雑賀衆', en: 'Saika Band', crest: '雑', color: '#5a3a1a' }, rate: 0.6, max: 2 },
  { lon: 134.97, name: '播磨灘', en: 'Harima Sea', faction: { name: '家島の海賊', en: 'Ieshima Pirates', crest: '家', color: '#2a4a3a' }, rate: 0.8, max: 3 },
  { lon: 134.30, name: '備讃瀬戸', en: 'Bisan Strait', faction: { name: '塩飽水軍', en: 'Shiaku Navy', crest: '塩', color: '#1c3a6a' }, rate: 1.0, max: 3 },
  { lon: 133.55, name: '備後灘', en: 'Bingo Sea', faction: { name: '鞆の浦の海賊', en: 'Tomonoura Pirates', crest: '鞆', color: '#4a2a5a' }, rate: 1.0, max: 4 },
  { lon: 133.22, name: '芸予諸島', en: 'Geiyo Islands', faction: { name: '村上水軍', en: 'Murakami Navy', crest: 'maru', color: '#1a2a4a' }, rate: 1.3, max: 5 },
  { lon: 132.78, name: '安芸灘・広島湾', en: 'Aki Sea & Hiroshima Bay', faction: { name: '毛利水軍', en: 'Mōri Navy', crest: '毛', color: '#3a1a1a' }, rate: 1.2, max: 4 },
  { lon: 132.15, name: '伊予灘・周防灘', en: 'Iyo & Suō Seas', faction: { name: '周防の海賊', en: 'Suō Pirates', crest: '周', color: '#2a3a2a' }, rate: 1.1, max: 4 },
  { lon: 131.10, name: '関門海峡', en: 'Kanmon Strait', faction: { name: '平家の怨霊', en: 'Heike Ghosts', crest: 'heike', color: '#8a1010' }, rate: 0, max: 0 },
];
export function zoneAt(lon) {
  let z = ZONES[0];
  for (const q of ZONES) if (lon <= q.lon) z = q;
  return z;
}

// 島ごとの言い伝え（上陸したときに出す。無いときは一般的な文）
export const ISLAND_NOTES = {
  '淡路島-28': '国生み神話の島。伊弉諾神宮が鎮まる',
  '小豆島-37': '寒霞渓の峡谷と、潮が引くと道が現れるエンジェルロード',
  '直島-37': '海辺に黄色い南瓜。銅の製錬所の島でもある',
  '男木島-37': '急な坂に家がひしめく、迷路のような島',
  '女木島-37': '鬼ヶ島の伝説。山の上に鬼の洞窟がある',
  '本島-37': '塩飽水軍の本拠。笠島の町並みが残る',
  '厳島-34': '海に立つ大鳥居と、潮の満ち引きの上に建つ社殿。神の島',
  '大三島-38': '日本総鎮守・大山祇神社。武将が奉納した鎧兜が眠る',
  '因島-34': '村上水軍・因島村上氏の本拠',
  '生口島-34': '耕三寺と、レモンの段々畑',
  '大久野島-34': 'うさぎが群れる島',
  '仙酔島-34': '鞆の浦の対岸。五色の岩の浜',
  '彦島-35': '巌流島の隣。下関の目の前の島',
  '大崎下島-34': '御手洗の港町。潮待ち・風待ちの湊',
  '伯方島-38': '塩の島',
  '大島-38': '能島村上氏の本拠を望む島',
  '倉橋島-34': '遣唐使船を造った島。音戸の瀬戸は清盛が切り開いたと伝わる',
  '江田島-34': '牡蠣の筏が浮かぶ湾',
  '屋代島-35': '周防大島。みかんの島',
  '祝島-35': '石を積み上げた練塀の集落',
  '姫島-44': '七不思議の伝説が残る国東の沖の島',
  '家島-28': '家島諸島の中心。石を切り出してきた島',
  '沼島-28': 'おのころ島とも伝わる、上立神岩の島',
  '白石島-33': '白い花崗岩の島。白石踊が伝わる',
  '北木島-33': '北木石の石切場',
  '真鍋島-33': '真鍋水軍の島。古い町並み',
  '犬島-33': '銅の製錬所跡が残る島',
  '豊島-37': '棚田と清水の島',
  '伊吹島-37': 'いりこの島',
  '粟島-37': 'スクリューの形をした島',
  '佐柳島-37': '猫の島。両墓制の墓が残る',
  '中島-38': '忽那水軍の島',
  '興居島-38': '松山の沖の、みかんの島',
  '大津島-35': '周南の沖の島',
};

export const STORY = [
  '慶長七年。関ヶ原で東西両軍を斬り抜けた小早川秀秋は、死んだことにして大坂を逃れた。',
  '手に入れたのは一艘の海賊船。帆には違い鎌の紋。',
  '目指すは西の果て、下関。瀬戸内の島々に眠る財宝を奪い、海賊どもを沈め、',
  '壇ノ浦に巣くう平家の怨霊を討ち果たせば——その名は「瀬戸内の海賊王」。',
];
export const STORY_EN = [
  'Keichō 7 (1602). Having cut his way through both armies at Sekigahara, Kobayakawa Hideaki faked his own death and slipped out of Osaka.',
  'All he has left is one pirate ship, its sail bearing the crossed-sickle crest.',
  'Sail west to Shimonoseki. Plunder the treasure hidden on the islands of the Seto Inland Sea and sink every pirate in your way.',
  'Destroy the Heike ghosts haunting Dan-no-ura — and you will be the Pirate King of the Seto Inland Sea.',
];

export const ISLAND_NOTES_EN = {
  '淡路島-28': 'The island born first in the creation myth, home of Izanagi Shrine',
  '小豆島-37': 'The Kankakei gorge, and Angel Road, a sandbar that appears at low tide',
  '直島-37': 'A yellow pumpkin by the sea — and a copper smelter',
  '男木島-37': 'A maze of houses crammed onto steep slopes',
  '女木島-37': 'Legendary Onigashima — an ogre cave at the summit',
  '本島-37': 'Base of the Shiaku navy; the old streets of Kasashima remain',
  '厳島-34': 'The great torii stands in the sea, the shrine floats on the tide. The island of the gods',
  '大三島-38': 'Ōyamazumi Shrine, guardian of Japan, keeper of samurai armor',
  '因島-34': 'Stronghold of the Innoshima Murakami clan',
  '生口島-34': 'Kōsan-ji temple and terraced lemon groves',
  '大久野島-34': 'The island of rabbits',
  '仙酔島-34': 'Across from Tomonoura — beaches of five-colored rock',
  '彦島-35': 'The island right in front of Shimonoseki',
  '大崎下島-34': 'Mitarai, the old port where ships waited for tide and wind',
  '伯方島-38': 'The island of salt',
  '倉橋島-34': 'Where envoy ships to Tang China were built; Ondo Strait is said to be carved by Kiyomori',
  '屋代島-35': 'Suō-Ōshima, the island of mandarin oranges',
  '祝島-35': 'A village of stacked-stone walls',
  '姫島-44': 'Island of the Seven Wonders off Kunisaki',
};
