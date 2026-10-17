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

import { createSheet, run } from './lib/sheet.mjs';

const { SHEET_API_URL, WRITE_KEY } = process.env;

const SHEET = 'notes';   // ★ 要寫入的工作表名稱（必須先在 Apps Script 的 SCHEMA 定義）
const KEEP_DAYS = 30;    // ★ 資料保留天數（不需要清除舊資料就設成 0）

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
  const sheet = createSheet({ url: SHEET_API_URL, key: WRITE_KEY }); // 讀取用 sheet.get('工作表')

  const rows = await collect();
  if (rows.length) await sheet.post({ action: 'addMany', sheet: SHEET, rows });

  // 其他可用的寫入動作：
  //   { action: 'replaceWhere', sheet, field, value, rows } 刪掉 field=value 的舊資料再寫入新的
  //   { action: 'upsert', sheet, row }                       依 id 更新，沒有就新增
  //   { action: 'remove', sheet, id }                        刪除一列
  //   { action: 'notify', subject, body }                    寄 Email 給你自己

  if (KEEP_DAYS > 0) {
    const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
    await sheet.post({ action: 'deleteBefore', sheet: SHEET, field: 'createdAt', before }); // ★ 時間欄位名稱
  }

  console.log(`完成：寫入 ${rows.length} 筆`);
}

// strict: true → 任何錯誤都讓排程顯示失敗；執行很頻繁的排程可改成 false
run(main, { strict: true });
