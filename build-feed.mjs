// Renovator Avito feed generator.
// Pulls the seller's listings via Avito API (core/v1/items) and emits a Yandex-YML feed
// for B24U (feed_format=yml; B24U indexes name+description text).
// Creds come from repo root .env (RENOVATOR_AVITO_CLIENT_ID/SECRET/USER_ID) — never printed.
// Usage: node build-feed.mjs [--status active|all]   (default: all)
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CID = process.env.RENOVATOR_AVITO_CLIENT_ID;
const CSEC = process.env.RENOVATOR_AVITO_CLIENT_SECRET;
const UID = process.env.RENOVATOR_AVITO_USER_ID;
if (!CID || !CSEC || !UID) { console.error('Missing RENOVATOR_AVITO_* env'); process.exit(1); }

const STATUS_ARG = process.argv.includes('--status') ? process.argv[process.argv.indexOf('--status') + 1] : 'all';
const STATUS = STATUS_ARG === 'active' ? 'active' : 'active,old,removed,blocked,rejected';
// HR categories (Вакансии 111, Резюме 112) are not sales objects — exclude from the bot's feed.
const EXCLUDE_CATEGORIES = new Set([111, 112]);

const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

async function token() {
  const r = await fetch('https://api.avito.ru/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('no token: ' + JSON.stringify(j));
  return j.access_token;
}

async function allItems(tok) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`https://api.avito.ru/core/v1/items?per_page=100&page=${page}&status=${STATUS}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    const res = j.resources || [];
    out.push(...res);
    if (res.length < 100) break;
  }
  return out;
}

// Каталог отражает реальный ассортимент агентства. Объявления на Avito периодически
// снимаются/переподнимаются, поэтому в фиде помечаем available=true (иначе B24U прячет
// их как «не в продаже» и бот вообще не видит объекты), а актуальность/показ бот уводит
// к менеджеру (см. промпт + текст описания). Переопределить: AVAILABLE_FROM_STATUS=1.
const AVAILABLE_FROM_STATUS = process.env.AVAILABLE_FROM_STATUS === '1';
// B24U ищет по тексту name+description, не по структурным полям. Avito-заголовки дают
// «1-к.», «студия» — добавляем словоформы («однокомнатная»), тип и район, иначе естественные
// запросы («однокомнатную в Дагомысе») не цепляют объект.
const ROOMS = { '1': 'однокомнатная 1-комнатная', '2': 'двухкомнатная 2-комнатная', '3': 'трёхкомнатная 3-комнатная', '4': 'четырёхкомнатная 4-комнатная', '5': 'пятикомнатная 5-комнатная' };
function synonyms(title, catName) {
  const t = title.toLowerCase();
  const out = [];
  if (/студи/.test(t)) out.push('квартира-студия', 'студия');
  const m = t.match(/(\d+)-?\s*к/);
  if (m && ROOMS[m[1]]) out.push(ROOMS[m[1]], 'квартира');
  if (/дом|коттедж|дач/.test(t)) out.push('дом', 'коттедж', 'дача');
  if (/гараж|машином/.test(t)) out.push('гараж', 'машиноместо');
  if (/комнат/.test(t) && !/квартир/.test(t)) out.push('комната');
  if (/(коммерч|офис|помещен|псн|здани)/.test(t) || /Коммерческая/i.test(catName)) out.push('коммерческая недвижимость', 'помещение');
  return [...new Set(out)].join(' ');
}
function offerXml(it) {
  const cat = it.category?.name || 'Недвижимость';
  const addr = it.address || 'Сочи';
  const priceText = it.price ? `${Number(it.price).toLocaleString('ru-RU')} ₽` : 'по запросу';
  const avail = AVAILABLE_FROM_STATUS ? (it.status === 'active') : true;
  const syn = synonyms(it.title, cat);
  // URL дублируем В ТЕКСТ описания (не только в поле <url>): B24U индексирует name+description,
  // и только так бот цитирует точную ссылку, а не достраивает 404 (целостность ссылок).
  const desc = `${it.title}. ${cat}. ${syn ? syn + '. ' : ''}Адрес: ${addr}. Цена объявления: ${priceText}. ` +
    `Ссылка на объявление: ${it.url}. Актуальность наличия и показ уточняйте у менеджера.`;
  return `    <offer id="${it.id}" available="${avail}">
      <url>${xmlEsc(it.url)}</url>
      <price>${it.price || 0}</price>
      <currencyId>RUR</currencyId>
      <categoryId>${it.category?.id || 0}</categoryId>
      <name>${xmlEsc(it.title)}</name>
      <description>${xmlEsc(desc)}</description>
    </offer>`;
}

const tok = await token();
const itemsRaw = await allItems(tok);
const items = itemsRaw.filter(it => !EXCLUDE_CATEGORIES.has(it.category?.id));
const cats = new Map();
for (const it of items) if (it.category?.id) cats.set(it.category.id, it.category.name);
const catXml = [...cats].map(([id, name]) => `      <category id="${id}">${xmlEsc(name)}</category>`).join('\n');
const offersXml = items.map(offerXml).join('\n');

const yml = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="${new Date().toISOString().slice(0, 19)}">
  <shop>
    <name>СК Реноватор</name>
    <company>СК Реноватор</company>
    <url>https://www.avito.ru/brands/imperial_stroy</url>
    <currencies>
      <currency id="RUR" rate="1"/>
    </currencies>
    <categories>
${catXml}
    </categories>
    <offers>
${offersXml}
    </offers>
  </shop>
</yml_catalog>
`;

const outDir = fileURLToPath(new URL('./public', import.meta.url));
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/feed.xml`;
writeFileSync(outPath, yml, 'utf8');
const byStatus = {};
for (const it of items) byStatus[it.status] = (byStatus[it.status] || 0) + 1;
console.log(`offers=${items.length} statuses=${JSON.stringify(byStatus)} categories=${cats.size}`);
console.log(`written: ${outPath}`);
console.log('sample:', items.slice(0, 3).map(i => `${i.title} — ${i.price}₽ [${i.status}]`).join(' | '));
