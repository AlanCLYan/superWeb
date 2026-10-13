// =============================================
// 自動抓取程式範本
//
// 適用：需要定時從外部抓資料、寫進試算表的功能（像機票價格、股市新聞）。
// 使用方式：
//   1. 複製這個檔案，改名，例如 scripts/fetch-weather.mjs
//   2. 修改下面標 ★ 的地方
//   3. 建立排程檔 .github/workflows/fetch-weather.yml（範本見 README）
//   4. 如果用到需要金鑰的 API，把金鑰存到 GitHub Secrets，再從 process.env 讀取
// =============================================

const { SHEET_API_URL, WRITE_KEY } = process.env;

const SHEET = 'notes';   // ★ 要寫入的工作表名稱（必須先在 Apps Script 的 SCHEMA 定義）
const KEEP_DAYS = 30;    // ★ 資料保留天數（不需要清除舊資料就設成 0）

// ---------- 試算表讀寫（直接沿用，不用改） ----------
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
  if (!data.ok) throw new Error(data.error === 'unauthorized' ? '寫入密碼不正確' : `寫入失敗：${data.error}`);
  return data;
}

// ---------- ★ 在這裡抓資料，回傳要寫入的列 ----------
async function collect() {
  // 範例：呼叫某個公開 API
  // const res = await fetch('https://api.example.com/data');
  // const json = await res.json();
  // return json.items.map(it => ({ text: it.title, createdAt: new Date().toISOString() }));
  return [{ text: `自動抓取測試 ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`, createdAt: new Date().toISOString() }];
}

// ---------- 主程式 ----------
async function main() {
  if (!SHEET_API_URL || !WRITE_KEY) throw new Error('缺少 SHEET_API_URL 或 WRITE_KEY，請到 GitHub Secrets 設定');

  const rows = await collect();
  if (rows.length) await sheetPost({ action: 'addMany', sheet: SHEET, rows });

  // 其他可用的寫入動作：
  //   { action: 'replaceWhere', sheet, field, value, rows } 刪掉 field=value 的舊資料再寫入新的
  //   { action: 'upsert', sheet, row }                       依 id 更新，沒有就新增
  //   { action: 'remove', sheet, id }                        刪除一列
  //   { action: 'notify', subject, body }                    寄 Email 給你自己

  if (KEEP_DAYS > 0) {
    const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    await sheetPost({ action: 'deleteBefore', sheet: SHEET, field: 'createdAt', before }); // ★ 時間欄位名稱
  }

  console.log(`完成：寫入 ${rows.length} 筆`);
}

main().catch(err => {
  console.error(`執行失敗：${err.message}`);
  process.exitCode = 1;
});
