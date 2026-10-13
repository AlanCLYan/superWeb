// =============================================
// 股市新聞自動抓取程式（由 GitHub Actions 定時執行）
//
// 資料來源（免費、不需要金鑰）：
//   台股       Yahoo股市「台股動態」RSS + Google 新聞「台股」
//   美股・國際  Yahoo股市「國際財經」RSS + Google 新聞「美股」
//   自選股     Google 新聞搜尋（依試算表 watchlist 的名稱／代號）
//
// 需要的環境變數（設定在 GitHub Secrets，與機票共用）：
//   SHEET_API_URL  Google Apps Script 網址（/exec 結尾）
//   WRITE_KEY      寫入密碼
// =============================================

const {
  SHEET_API_URL,
  WRITE_KEY,
  YAHOO_RSS_BASE = 'https://tw.stock.yahoo.com/rss',
  GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search'
} = process.env;

const KEEP_DAYS = 14;        // 新聞保留天數
const FRESH_HOURS = 48;      // 只收錄最近幾小時內發布的新聞
const PER_FEED = 25;         // 每個大盤來源最多收幾則
const PER_STOCK = 8;         // 每檔自選股最多收幾則

// ---------- 來源 ----------
const yahoo = category => `${YAHOO_RSS_BASE}?category=${category}`;
const google = query => `${GOOGLE_NEWS_BASE}?${new URLSearchParams({
  q: `${query} when:2d`, hl: 'zh-TW', gl: 'TW', ceid: 'TW:zh-Hant'
})}`;

const MARKET_FEEDS = [
  { market: '台股', url: yahoo('tw-market'), source: 'Yahoo股市' },
  { market: '台股', url: google('台股 OR 加權指數 OR 櫃買') },
  { market: '美股', url: yahoo('intl-markets'), source: 'Yahoo股市' },
  { market: '美股', url: google('美股 OR 道瓊 OR 那斯達克 OR 費半') }
];

// ---------- RSS 解析（不需要額外套件） ----------
function decode(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

function parseRss(xml) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, block]) => ({
    title: tag(block, 'title').replace(/^"(.*)"$/, '$1'),
    link: tag(block, 'link'),
    pubDate: tag(block, 'pubDate'),
    source: tag(block, 'source')
  }));
}

async function fetchFeed(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (superWeb personal news reader)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseRss(await res.text());
}

// Google 新聞的標題結尾是「 - 來源」，拆開成標題與來源
function splitTitle(item, fallbackSource) {
  let { title, source } = item;
  if (!source) source = fallbackSource || '';
  if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
  else if (!source) {
    const m = title.match(/^(.*) - ([^-]{2,30})$/);
    if (m) { title = m[1]; source = m[2]; }
  }
  return { title: title.trim(), source: source.trim() };
}

// 用來判斷是否為同一則新聞（去掉空白與標點）
const normalize = s => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

// ---------- 試算表 ----------
async function sheetGet(sheet) {
  const res = await fetch(`${SHEET_API_URL}?sheet=${sheet}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(`讀取 ${sheet} 失敗：${data.error || res.status}`);
  return data;
}

async function sheetPost(body) {
  const res = await fetch(SHEET_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, key: WRITE_KEY })
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(data.error === 'unauthorized'
      ? '寫入密碼不正確，請檢查 GitHub Secrets 的 WRITE_KEY'
      : `寫入失敗：${data.error}`);
  }
  return data;
}

// ---------- 自選股比對 ----------
function matcher(watchlist) {
  return title => {
    const upper = title.toUpperCase();
    return watchlist.filter(w => {
      const symbol = String(w.symbol || '').toUpperCase();
      const name = String(w.name || '');
      if (name && title.includes(name)) return true;
      if (!symbol) return false;
      // 美股代號要是獨立的英文字（避免 AAPL 以外的字誤判），台股代號要是獨立的數字
      const re = /^\d+$/.test(symbol)
        ? new RegExp(`(^|\\D)${symbol}(\\D|$)`)
        : new RegExp(`(^|[^A-Z])${symbol}([^A-Z]|$)`);
      return symbol.length >= 2 && re.test(upper);
    }).map(w => String(w.symbol).toUpperCase());
  };
}

function stockQuery(w) {
  const name = String(w.name || '').trim();
  const symbol = String(w.symbol || '').trim();
  if (w.market === '台股') return name || symbol;          // 台股用名稱搜尋較準
  return [name, symbol].filter(Boolean).join(' OR ');      // 美股用名稱或代號
}

// ---------- 主程式 ----------
async function main() {
  for (const [k, v] of Object.entries({ SHEET_API_URL, WRITE_KEY })) {
    if (!v) throw new Error(`缺少設定 ${k}，請到 GitHub → Settings → Secrets 新增`);
  }

  const [watchlist, existing] = await Promise.all([sheetGet('watchlist'), sheetGet('news')]);
  const seen = new Set(existing.map(n => normalize(n.title)));
  const match = matcher(watchlist);
  const freshLimit = Date.now() - FRESH_HOURS * 3600000;

  const tasks = [
    ...MARKET_FEEDS.map(f => ({ ...f, limit: PER_FEED, symbol: '' })),
    ...watchlist
      .filter(w => stockQuery(w))
      .map(w => ({ market: w.market === '台股' ? '台股' : '美股', url: google(stockQuery(w)), limit: PER_STOCK, symbol: String(w.symbol).toUpperCase(), label: `${w.symbol} ${w.name || ''}` }))
  ];

  const fresh = [];
  const errors = [];

  for (const t of tasks) {
    const label = t.label || `${t.market}・${t.source || 'Google 新聞'}`;
    try {
      const items = (await fetchFeed(t.url))
        .map(it => ({ ...it, time: new Date(it.pubDate).getTime() }))
        .filter(it => it.title && it.link && !isNaN(it.time) && it.time >= freshLimit)
        .sort((a, b) => b.time - a.time)
        .slice(0, t.limit);

      let added = 0;
      for (const it of items) {
        const { title, source } = splitTitle(it, t.source);
        const key = normalize(title);
        if (!key) continue;
        const symbols = new Set(match(title));
        if (t.symbol) symbols.add(t.symbol);

        const dup = fresh.find(n => normalize(n.title) === key);
        if (dup) { // 同一則新聞出現在多個來源：合併自選股標記
          dup.symbols = [...new Set([...dup.symbols.split(',').filter(Boolean), ...symbols])].join(',');
          continue;
        }
        if (seen.has(key)) continue;
        fresh.push({ market: t.market, title, source, link: it.link, symbols: [...symbols].join(','), publishedAt: new Date(it.time).toISOString() });
        added++;
      }
      console.log(`${label}：取得 ${items.length} 則，新增 ${added} 則`);
    } catch (err) {
      errors.push(`${label}：${err.message}`);
      console.error(`錯誤 ${label}：${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800)); // 放慢速度，對新聞網站友善一點
  }

  // 依時間由舊到新寫入
  fresh.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  if (fresh.length) await sheetPost({ action: 'addMany', sheet: 'news', rows: fresh });

  const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  const { removed } = await sheetPost({ action: 'deleteBefore', sheet: 'news', field: 'publishedAt', before });

  const nowIso = new Date().toISOString();
  await sheetPost({ action: 'upsert', sheet: 'meta', row: { id: 'news.lastRun', value: nowIso, updatedAt: nowIso } });
  await sheetPost({
    action: 'upsert', sheet: 'meta',
    row: { id: 'news.lastMessage', value: errors.length === tasks.length
      ? `全部來源失敗：${errors.join('；')}`
      : errors.length ? `新增 ${fresh.length} 則（${errors.length} 個來源暫時失敗：${errors.join('；')}）` : `新增 ${fresh.length} 則`, updatedAt: nowIso }
  });

  console.log(`完成：新增 ${fresh.length} 則，清除 ${removed} 則舊新聞，失敗來源 ${errors.length} 個`);
  if (errors.length === tasks.length) process.exitCode = 1; // 全部來源都失敗才標示失敗
}

main().catch(err => {
  console.error(`執行失敗：${err.message}`);
  process.exitCode = 1;
});
