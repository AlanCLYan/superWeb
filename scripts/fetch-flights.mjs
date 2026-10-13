// =============================================
// 機票價格自動抓取程式（由 GitHub Actions 每天執行）
//
// 流程：
//   1. 從 Google 試算表讀取你追蹤的航線
//   2. 用 SerpApi 查詢 Google 航班價格
//        固定日期 → Google Flights API
//        彈性月份 → Google Travel Explore API（找出該月最便宜的日期）
//   3. 把結果寫回試算表，價格達到目標時寄 Email 提醒
//
// 需要的環境變數（設定在 GitHub Secrets）：
//   SHEET_API_URL  Google Apps Script 網址（/exec 結尾）
//   WRITE_KEY      寫入密碼
//   SERPAPI_KEY    SerpApi 金鑰
// =============================================

const {
  SHEET_API_URL,
  WRITE_KEY,
  SERPAPI_KEY,
  SERPAPI_BASE = 'https://serpapi.com'
} = process.env;

// 每次執行最多查詢幾條航線（保護每月 250 次的免費額度）
const MAX_CALLS_PER_RUN = Number(process.env.MAX_CALLS_PER_RUN || 8);
// 價格紀錄保留天數
const HISTORY_DAYS = 180;
// 每條航線最多保留幾筆報價
const KEEP_PER_ROUTE = 5;

const TZ = 'Asia/Taipei';
const DURATION = { weekend: 1, week: 2, twoweeks: 3 };
const DURATION_LABEL = { oneway: '單程', weekend: '週末', week: '一週', twoweeks: '兩週' };

// ---------- 小工具 ----------
const todayTW = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
const money = n => `NT$ ${Number(n).toLocaleString('en-US')}`;

function monthsAhead(ym) {
  const [y, m] = ym.split('-').map(Number);
  const [ty, tm] = todayTW().split('-').map(Number);
  return (y - ty) * 12 + (m - tm);
}

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

// ---------- SerpApi ----------
async function serp(params) {
  const qs = new URLSearchParams({
    ...params,
    currency: 'TWD',
    hl: 'zh-tw',
    gl: 'tw',
    api_key: SERPAPI_KEY
  });
  const res = await fetch(`${SERPAPI_BASE}/search.json?${qs}`);
  const data = await res.json();
  // 查無航班時 SerpApi 會回傳錯誤訊息，這種情況當作「沒有結果」而不是失敗
  if (data.error && /hasn't returned any results/i.test(data.error)) return {};
  if (data.error) throw new Error(data.error);
  return data;
}

// 查詢剩餘搜尋次數（這個查詢本身不算次數）
async function searchesLeft() {
  try {
    const res = await fetch(`${SERPAPI_BASE}/account.json?api_key=${SERPAPI_KEY}`);
    const data = await res.json();
    const left = data.total_searches_left ?? data.plan_searches_left;
    return typeof left === 'number' ? left : null;
  } catch {
    return null;
  }
}

// 固定日期：Google Flights
async function searchByDate(route) {
  const roundTrip = Boolean(route.returnDate);
  const data = await serp({
    engine: 'google_flights',
    departure_id: route.from,
    arrival_id: route.to,
    outbound_date: route.departDate,
    ...(roundTrip ? { return_date: route.returnDate, type: 1 } : { type: 2 })
  });
  const link = data.search_metadata?.google_flights_url || '';
  const list = [...(data.best_flights || []), ...(data.other_flights || [])];
  return list
    .filter(f => typeof f.price === 'number')
    .map(f => ({
      airline: [...new Set((f.flights || []).map(s => s.airline).filter(Boolean))].join('、'),
      depart: route.departDate,
      returnDate: route.returnDate || '',
      price: f.price,
      stops: (f.layovers || []).length,
      link,
      currency: 'TWD'
    }));
}

// 彈性月份：Google Travel Explore（找出該月最便宜的日期組合）
async function searchByMonth(route) {
  const oneWay = route.duration === 'oneway';
  const data = await serp({
    engine: 'google_travel_explore',
    departure_id: route.from,
    arrival_id: route.to,
    month: Number(route.month.slice(5, 7)),
    ...(oneWay ? { type: 2 } : { type: 1, travel_duration: DURATION[route.duration] || 2 })
  });
  const link = data.google_flights_link || data.search_metadata?.google_flights_url || '';
  return (data.flights || [])
    .filter(f => typeof f.price === 'number')
    .map(f => ({
      airline: f.airline || '',
      depart: f.start_date || data.start_date || '',
      returnDate: oneWay ? '' : (f.end_date || data.end_date || ''),
      price: f.price,
      stops: f.number_of_stops ?? '',
      link: f.google_flights_link || link,
      currency: 'TWD'
    }));
}

// 檢查航線設定是否可以查詢，不行就回傳原因
function whySkip(route, today) {
  if (route.mode === 'date') {
    if (!route.departDate) return '沒有出發日期';
    if (route.departDate < today) return '出發日期已過';
    if (route.returnDate && route.returnDate < route.departDate) return '回程早於出發';
    return '';
  }
  if (route.mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(route.month || '')) return '沒有設定月份';
    const ahead = monthsAhead(route.month);
    if (ahead < 0) return '月份已過';
    if (ahead > 6) return '彈性月份只能查詢未來 6 個月內';
    return '';
  }
  return '尚未設定日期（請刪除後重新新增）';
}

function describe(route) {
  const name = `${route.from}→${route.to}${route.toName ? ` ${route.toName}` : ''}`;
  if (!route.mode) return name;
  if (route.mode === 'date') {
    return `${name}（${route.departDate}${route.returnDate ? ` ~ ${route.returnDate}` : ' 單程'}）`;
  }
  return `${name}（${route.month} 彈性・${DURATION_LABEL[route.duration] || ''}）`;
}

// ---------- 主程式 ----------
async function main() {
  for (const [k, v] of Object.entries({ SHEET_API_URL, WRITE_KEY, SERPAPI_KEY })) {
    if (!v) throw new Error(`缺少設定 ${k}，請到 GitHub → Settings → Secrets 新增`);
  }

  const today = todayTW();
  const nowIso = new Date().toISOString();
  const [routes, history] = await Promise.all([sheetGet('routes'), sheetGet('history')]);

  let left = await searchesLeft();
  console.log(`共 ${routes.length} 條航線，SerpApi 剩餘次數：${left ?? '未知'}`);

  const budget = Math.min(MAX_CALLS_PER_RUN, left ?? Infinity);
  const alerts = [];
  const errors = [];
  let calls = 0;
  let success = 0;

  for (const route of routes) {
    const skip = whySkip(route, today);
    if (skip) {
      console.log(`略過 ${describe(route)}：${skip}`);
      continue;
    }
    if (calls >= budget) {
      console.log(`略過 ${describe(route)}：已達本次查詢上限`);
      continue;
    }

    calls++;
    try {
      const found = route.mode === 'date' ? await searchByDate(route) : await searchByMonth(route);
      const rows = found
        .sort((a, b) => a.price - b.price)
        .slice(0, KEEP_PER_ROUTE)
        .map(r => ({ ...r, routeId: route.id, fetchedAt: nowIso }));

      await sheetPost({ action: 'replaceWhere', sheet: 'prices', field: 'routeId', value: route.id, rows });

      if (!rows.length) {
        console.log(`${describe(route)}：查無航班`);
        success++;
        continue;
      }

      const best = rows[0];
      const past = history
        .filter(h => h.routeId === route.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      const prev = past.length ? Number(past[past.length - 1].minPrice) : null;

      await sheetPost({ action: 'add', sheet: 'history', row: { routeId: route.id, date: nowIso, minPrice: best.price } });

      const change = prev == null ? '' : best.price < prev ? `（↓ ${money(prev - best.price)}）` : best.price > prev ? `（↑ ${money(best.price - prev)}）` : '（持平）';
      console.log(`${describe(route)}：最低 ${money(best.price)} ${best.airline}${change}`);

      // 降價提醒：價格 ≤ 目標價，而且是第一次達標或比上次更便宜
      const target = Number(route.target);
      if (target && best.price <= target && (prev == null || best.price < prev)) {
        alerts.push(
          `✈️ ${describe(route)}\n` +
          `   最低價 ${money(best.price)}（目標 ${money(target)}）${change}\n` +
          `   ${best.airline}・${best.depart}${best.returnDate ? ` ~ ${best.returnDate}` : ''}・` +
          `${best.stops === 0 ? '直飛' : `轉機 ${best.stops} 次`}\n` +
          (best.link ? `   ${best.link}\n` : '')
        );
      }
      success++;
    } catch (err) {
      errors.push(`${describe(route)}：${err.message}`);
      console.error(`錯誤 ${describe(route)}：${err.message}`);
    }
  }

  if (left != null) left = Math.max(0, left - calls);

  // 記錄這次執行的狀態，網站會顯示
  await sheetPost({ action: 'upsert', sheet: 'meta', row: { id: 'flights.lastRun', value: nowIso, updatedAt: nowIso } });
  await sheetPost({ action: 'upsert', sheet: 'meta', row: { id: 'flights.searchesLeft', value: left ?? '', updatedAt: nowIso } });
  await sheetPost({
    action: 'upsert', sheet: 'meta',
    row: { id: 'flights.lastMessage', value: errors.length ? `${errors.length} 條航線查詢失敗：${errors.join('；')}` : `成功查詢 ${success} 條航線`, updatedAt: nowIso }
  });

  // 清除太舊的價格紀錄
  const before = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString();
  await sheetPost({ action: 'deleteBefore', sheet: 'history', field: 'date', before });

  if (alerts.length) {
    await sheetPost({
      action: 'notify',
      subject: `✈️ superWeb 降價提醒：${alerts.length} 條航線達到目標價`,
      body: `以下航線的價格已達到你設定的目標：\n\n${alerts.join('\n')}\n— superWeb 自動通知`
    });
    console.log(`已寄出降價提醒（${alerts.length} 條）`);
  }

  console.log(`完成：查詢 ${calls} 次，成功 ${success}，失敗 ${errors.length}`);
  // 全部失敗時讓 GitHub Actions 顯示紅色失敗，GitHub 會寄信通知你
  if (calls > 0 && success === 0) process.exitCode = 1;
}

main().catch(err => {
  console.error(`執行失敗：${err.message}`);
  process.exitCode = 1;
});
