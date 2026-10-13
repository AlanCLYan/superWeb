// =============================================
// 資料層：網站所有讀寫都經過這裡
// SHEET_API_URL 有填：讀寫 Google 試算表
// SHEET_API_URL 留空：示範模式，資料只存在你的瀏覽器裡
// =============================================
const CONFIG = {
  // Google Apps Script 的網址（/exec 結尾）
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbwaiimN33G_-LdQKphJjleByRQZCqwuv3uVJuutzA4FBOoCZwaI-TALW3L-unpWxJlI1w/exec'
};

const DataStore = (() => {
  const STORAGE_KEY = 'superWeb-demo-v2';
  const now = Date.now();
  const hoursAgo = h => new Date(now - h * 3600000).toISOString();
  const daysLater = d => new Date(now + d * 86400000).toISOString().slice(0, 10);

  // ---------- 示範資料（每個工作表一組） ----------
  const demo = {
    routes: [
      { id: 'r1', from: 'TPE', to: 'NRT', toName: '東京成田', target: 8000, mode: 'date', departDate: daysLater(21), returnDate: daysLater(26) },
      { id: 'r2', from: 'TPE', to: 'KIX', toName: '大阪關西', target: 7000, mode: 'month', month: daysLater(45).slice(0, 7), duration: 'week' },
      { id: 'r3', from: 'TPE', to: 'ICN', toName: '首爾仁川', target: 6500, mode: 'date', departDate: daysLater(28), returnDate: '' }
    ],
    prices: [
      { routeId: 'r1', airline: '台灣虎航', depart: daysLater(21), returnDate: daysLater(26), price: 7290, stops: 0, fetchedAt: hoursAgo(2) },
      { routeId: 'r1', airline: '星宇航空', depart: daysLater(21), returnDate: daysLater(26), price: 11850, stops: 0, fetchedAt: hoursAgo(2) },
      { routeId: 'r1', airline: '樂桃航空', depart: daysLater(21), returnDate: daysLater(26), price: 7980, stops: 0, fetchedAt: hoursAgo(2) },
      { routeId: 'r2', airline: '樂桃航空', depart: daysLater(47), returnDate: daysLater(54), price: 7650, stops: 0, fetchedAt: hoursAgo(3) },
      { routeId: 'r2', airline: '中華航空', depart: daysLater(47), returnDate: daysLater(54), price: 12400, stops: 0, fetchedAt: hoursAgo(3) },
      { routeId: 'r3', airline: '德威航空', depart: daysLater(28), returnDate: '', price: 3890, stops: 0, fetchedAt: hoursAgo(5) },
      { routeId: 'r3', airline: '長榮航空', depart: daysLater(28), returnDate: '', price: 6200, stops: 0, fetchedAt: hoursAgo(5) }
    ],
    history: [
      ...[8100, 7950, 7990, 7600, 7450, 7290].map((v, i) => ({ routeId: 'r1', date: hoursAgo((6 - i) * 24 + 2), minPrice: v })),
      ...[7400, 7800, 7650].map((v, i) => ({ routeId: 'r2', date: hoursAgo((3 - i) * 24 + 3), minPrice: v }))
    ],
    meta: [
      { id: 'flights.lastRun', value: hoursAgo(2) },
      { id: 'flights.searchesLeft', value: '212' }
    ],
    watchlist: [
      { id: 'w1', symbol: '2330', name: '台積電', market: '台股' },
      { id: 'w2', symbol: '2317', name: '鴻海', market: '台股' },
      { id: 'w3', symbol: 'NVDA', name: 'NVIDIA', market: '美股' },
      { id: 'w4', symbol: 'AAPL', name: 'Apple', market: '美股' }
    ],
    news: [
      { market: '台股', title: '【示範】半導體類股走強，加權指數盤中上漲逾百點', source: '示範來源', link: '', symbols: '2330', publishedAt: hoursAgo(1) },
      { market: '美股', title: '【示範】AI 晶片需求續旺，費城半導體指數收高', source: '示範來源', link: '', symbols: 'NVDA', publishedAt: hoursAgo(3) },
      { market: '台股', title: '【示範】外資連三日買超，電子權值股成主要標的', source: '示範來源', link: '', symbols: '2330,2317', publishedAt: hoursAgo(4) },
      { market: '美股', title: '【示範】科技巨頭財報季將至，市場關注營收指引', source: '示範來源', link: '', symbols: 'AAPL', publishedAt: hoursAgo(7) },
      { market: '台股', title: '【示範】航運股表現分歧，貨櫃三雄漲跌互見', source: '示範來源', link: '', symbols: '', publishedAt: hoursAgo(10) },
      { market: '美股', title: '【示範】聯準會官員談話，美債殖利率小幅波動', source: '示範來源', link: '', symbols: '', publishedAt: hoursAgo(15) }
    ]
  };

  // 示範模式下，你新增或刪除的資料會記在瀏覽器裡（重新整理不會消失）
  let local = null;
  function loadLocal() {
    if (local) return local;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      local = saved ? JSON.parse(saved) : structuredClone(demo);
    } catch {
      local = structuredClone(demo);
    }
    return local;
  }
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(local)); } catch { /* 無法儲存時忽略 */ }
  }

  function isDemo() {
    return !CONFIG.SHEET_API_URL;
  }

  // ---------- 對外提供的三個動作：讀取、新增、刪除 ----------
  async function get(sheet) {
    if (isDemo()) return structuredClone(loadLocal()[sheet] || []);
    const res = await fetch(`${CONFIG.SHEET_API_URL}?sheet=${encodeURIComponent(sheet)}`);
    if (!res.ok) throw new Error(`讀取「${sheet}」失敗`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error(data.error || `讀取「${sheet}」失敗`);
    return data;
  }

  async function add(sheet, row) {
    row = { id: crypto.randomUUID().slice(0, 8), ...row };
    if (isDemo()) {
      const data = loadLocal();
      (data[sheet] ||= []).push(row);
      saveLocal();
      return row;
    }
    await post({ action: 'add', sheet, row });
    return row;
  }

  async function remove(sheet, id) {
    if (isDemo()) {
      const data = loadLocal();
      data[sheet] = (data[sheet] || []).filter(r => r.id !== id);
      saveLocal();
      return;
    }
    await post({ action: 'remove', sheet, id });
  }

  // 寫入密碼：第一次新增或刪除時會請你輸入，之後記在這台裝置的瀏覽器裡
  const KEY_STORAGE = 'superWeb-write-key';
  function getKey(forceAsk) {
    let key = '';
    try { key = localStorage.getItem(KEY_STORAGE) || ''; } catch { /* 忽略 */ }
    if (!key || forceAsk) {
      key = prompt(forceAsk ? '密碼不正確，請重新輸入寫入密碼：' : '請輸入寫入密碼（只需輸入一次）：') || '';
      try { localStorage.setItem(KEY_STORAGE, key); } catch { /* 忽略 */ }
    }
    return key;
  }

  async function post(body, retried = false) {
    const key = getKey(retried);
    if (!key) throw new Error('未輸入寫入密碼');
    // 用 text/plain 送出，Google Apps Script 才不會被瀏覽器的跨網域檢查擋下
    const res = await fetch(CONFIG.SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key })
    });
    if (!res.ok) throw new Error('寫入失敗');
    const result = await res.json();
    if (result.error === 'unauthorized' && !retried) return post(body, true);
    if (!result.ok) throw new Error(result.error === 'unauthorized' ? '寫入密碼不正確' : result.error);
    return result;
  }

  // 清除示範模式下你做的修改，回到原始示範資料
  function resetDemo() {
    local = structuredClone(demo);
    saveLocal();
  }

  return { get, add, remove, isDemo, resetDemo };
})();
