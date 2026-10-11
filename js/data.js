// =============================================
// 資料層：網站所有讀寫都經過這裡
// 目前是「示範模式」，資料只存在你的瀏覽器裡。
// 第 3 步接上 Google 試算表後，只要把下面的網址填進去，
// 各功能模組完全不用改。
// =============================================
const CONFIG = {
  // 第 3 步會拿到 Google Apps Script 的網址，貼在這裡
  SHEET_API_URL: ''
};

const DataStore = (() => {
  const STORAGE_KEY = 'superWeb-demo-v1';
  const now = Date.now();
  const hoursAgo = h => new Date(now - h * 3600000).toISOString();
  const daysLater = d => new Date(now + d * 86400000).toISOString().slice(0, 10);

  // ---------- 示範資料（每個工作表一組） ----------
  const demo = {
    routes: [
      { id: 'r1', from: 'TPE', to: 'NRT', toName: '東京成田', target: 8000 },
      { id: 'r2', from: 'TPE', to: 'KIX', toName: '大阪關西', target: 7000 },
      { id: 'r3', from: 'TPE', to: 'ICN', toName: '首爾仁川', target: 6500 },
      { id: 'r4', from: 'TPE', to: 'BKK', toName: '曼谷', target: 7500 }
    ],
    prices: [
      { routeId: 'r1', airline: '台灣虎航', depart: daysLater(21), price: 7290, fetchedAt: hoursAgo(2) },
      { routeId: 'r1', airline: '星宇航空', depart: daysLater(21), price: 11850, fetchedAt: hoursAgo(2) },
      { routeId: 'r1', airline: '樂桃航空', depart: daysLater(35), price: 7980, fetchedAt: hoursAgo(8) },
      { routeId: 'r2', airline: '樂桃航空', depart: daysLater(14), price: 7650, fetchedAt: hoursAgo(3) },
      { routeId: 'r2', airline: '中華航空', depart: daysLater(14), price: 12400, fetchedAt: hoursAgo(3) },
      { routeId: 'r3', airline: '德威航空', depart: daysLater(28), price: 5890, fetchedAt: hoursAgo(5) },
      { routeId: 'r3', airline: '長榮航空', depart: daysLater(28), price: 10200, fetchedAt: hoursAgo(5) },
      { routeId: 'r4', airline: '越捷航空', depart: daysLater(42), price: 8320, fetchedAt: hoursAgo(6) },
      { routeId: 'r4', airline: '泰國航空', depart: daysLater(42), price: 11900, fetchedAt: hoursAgo(6) }
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
    return res.json();
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

  async function post(body) {
    // 用 text/plain 送出，Google Apps Script 才不會被瀏覽器的跨網域檢查擋下
    const res = await fetch(CONFIG.SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('寫入失敗');
    return res.json();
  }

  // 清除示範模式下你做的修改，回到原始示範資料
  function resetDemo() {
    local = structuredClone(demo);
    saveLocal();
  }

  return { get, add, remove, isDemo, resetDemo };
})();
