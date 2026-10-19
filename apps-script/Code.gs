/**
 * superWeb 資料庫 API（Google Apps Script）
 * ------------------------------------------------------------
 * 把這份 Google 試算表變成網站可以讀寫的資料庫。
 *
 * 使用方式：
 *   1. 把下面 WRITE_KEY 改成你自己的寫入密碼
 *   2. 執行一次 setup()，自動建立或更新所有工作表
 *   3. 部署成「網頁應用程式」（更新程式後要部署「新版本」）
 */

// ★ 請改成你自己的密碼（網站新增、刪除資料，以及自動抓取程式寫入時會用到）
const WRITE_KEY = '請改成你的密碼';

// 每個工作表的欄位（第一列標題）。
// ※ 新增欄位一律加在最後面，舊資料才不會錯位。
const SCHEMA = {
  // 追蹤航線
  //   mode：date＝固定日期、month＝彈性月份
  //   departDate / returnDate：固定日期用（回程留空＝單程）
  //   month：彈性月份用（如 2026-12）
  //   duration：彈性月份的行程長度 oneway / weekend / week / twoweeks
  routes:    ['id', 'from', 'to', 'toName', 'target', 'mode', 'departDate', 'returnDate', 'month', 'duration'],
  // 最新報價（每次抓取會覆蓋該航線的舊報價）
  prices:    ['id', 'routeId', 'airline', 'depart', 'price', 'fetchedAt', 'returnDate', 'stops', 'link', 'currency'],
  // 價格紀錄（每次抓取記下該航線最低價，用來畫走勢、判斷降價）
  history:   ['id', 'routeId', 'date', 'minPrice'],
  // 系統狀態（上次抓取時間、剩餘搜尋次數等）
  meta:      ['id', 'value', 'updatedAt'],
  watchlist: ['id', 'symbol', 'name', 'market'],
  news:      ['id', 'market', 'title', 'source', 'link', 'symbols', 'publishedAt'],
  // 英文閱讀：每日文章（body 是全文，段落之間以空行分隔）
  articles:  ['id', 'title', 'author', 'source', 'url', 'publishedAt', 'fetchedAt', 'body', 'words', 'counter', 'readAt'],
  // 英文閱讀：單字庫
  //   box / nextReview：間隔複習用（box 越大代表越熟，nextReview 是下次該複習的日期）
  vocab:     ['id', 'word', 'meaning', 'definition', 'phonetic', 'pos', 'example', 'source', 'sourceUrl',
              'createdAt', 'box', 'nextReview', 'correct', 'wrong', 'lastReviewed']
};

// 這些欄位讀出來時轉成數字，其他一律當文字
const NUMBER_FIELDS = ['target', 'price', 'minPrice', 'stops', 'words', 'box', 'correct', 'wrong'];

// 刪除航線時，一併刪除這些工作表中屬於該航線的資料
const ROUTE_CHILDREN = ['prices', 'history'];

// ============================================================
// 建立 / 更新工作表（第一次使用、或程式更新後執行一次）
// ============================================================
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(SCHEMA).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = SCHEMA[name];
    // 整張表設為純文字，避免日期、股票代號被 Google 自動轉換格式
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });

  // 刪除新試算表預設的空白工作表
  ['工作表1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  if (ss.getSheetByName('watchlist').getLastRow() < 2) {
    appendRows_('watchlist', [
      { symbol: '2330', name: '台積電', market: '台股' },
      { symbol: '2317', name: '鴻海', market: '台股' },
      { symbol: 'NVDA', name: 'NVIDIA', market: '美股' },
      { symbol: 'AAPL', name: 'Apple', market: '美股' }
    ]);
  }

  // 觸發 Email 權限授權（降價提醒用），不會真的寄信
  MailApp.getRemainingDailyQuota();

  Logger.log('設定完成！');
}

// ============================================================
// 讀取：GET ?sheet=routes　／　翻譯：GET ?translate=text
// ============================================================
function doGet(e) {
  // 翻譯：GET ?translate=英文 → 繁體中文（使用 Google 翻譯，英文閱讀查單字用）
  if (e && e.parameter && e.parameter.translate) {
    try {
      const text = String(e.parameter.translate).slice(0, 1000);
      return json_({ ok: true, text: LanguageApp.translate(text, 'en', 'zh-TW') });
    } catch (err) {
      return json_({ ok: false, error: '翻譯失敗：' + err.message });
    }
  }
  const name = e && e.parameter && e.parameter.sheet;
  if (!SCHEMA[name]) return json_({ ok: false, error: '找不到工作表：' + name });
  return json_(readRows_(name));
}

// ============================================================
// 寫入：POST { key, action, sheet, ... }
// ============================================================
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '資料格式錯誤' });
  }
  if (body.key !== WRITE_KEY) return json_({ ok: false, error: 'unauthorized' });

  // 寄送降價提醒 Email 給試算表擁有者（也就是你）
  if (body.action === 'notify') {
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), body.subject || 'superWeb 通知', body.body || '');
    return json_({ ok: true });
  }

  if (!SCHEMA[body.sheet]) return json_({ ok: false, error: '找不到工作表：' + body.sheet });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // 避免同時寫入造成資料錯亂
  try {
    switch (body.action) {
      case 'add':
        return json_({ ok: true, rows: appendRows_(body.sheet, [body.row]) });

      case 'addMany': // 一次寫入多筆
        return json_({ ok: true, rows: appendRows_(body.sheet, body.rows || []) });

      case 'remove': {
        const removed = removeRow_(body.sheet, body.id);
        if (body.sheet === 'routes' && removed) {
          ROUTE_CHILDREN.forEach(child => deleteWhere_(child, 'routeId', body.id));
        }
        return json_({ ok: true, removed: removed });
      }

      case 'replaceWhere': // 刪掉 field = value 的舊資料，換成新的 rows
        deleteWhere_(body.sheet, body.field, body.value);
        return json_({ ok: true, rows: appendRows_(body.sheet, body.rows || []) });

      case 'upsert': // 依 id 更新，沒有就新增
        return json_({ ok: true, row: upsert_(body.sheet, body.row) });

      case 'upsertMany': // 一次更新多筆（例如測驗結束後更新多個單字）
        return json_({ ok: true, rows: (body.rows || []).map(r => upsert_(body.sheet, r)) });

      case 'deleteBefore': // 清除舊資料：刪除某個時間欄位早於指定時間的列
        return json_({ ok: true, removed: deleteBefore_(body.sheet, body.field, body.before) });

      default:
        return json_({ ok: false, error: '未知的動作：' + body.action });
    }
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// 內部工具函式
// ============================================================
function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function readRows_(name) {
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = SCHEMA[name];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
  return values
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = NUMBER_FIELDS.indexOf(h) >= 0 && r[i] !== '' ? Number(r[i]) : r[i];
      });
      return obj;
    });
}

function toValues_(name, rows) {
  const headers = SCHEMA[name];
  return rows.map(row => headers.map(h => (row[h] === undefined || row[h] === null) ? '' : String(row[h])));
}

function appendRows_(name, rows) {
  if (!rows.length) return [];
  const sheet = sheet_(name);
  const headers = SCHEMA[name];
  const filled = rows.map(row => Object.assign({ id: Utilities.getUuid().slice(0, 8) }, row));
  const values = toValues_(name, filled);
  const start = sheet.getLastRow() + 1;
  const range = sheet.getRange(start, 1, values.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(values);
  return filled;
}

function upsert_(name, row) {
  const sheet = sheet_(name);
  const headers = SCHEMA[name];
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === String(row.id)) {
        const range = sheet.getRange(i + 2, 1, 1, headers.length);
        range.setNumberFormat('@');
        range.setValues(toValues_(name, [row]));
        return row;
      }
    }
  }
  return appendRows_(name, [row])[0];
}

function removeRow_(name, id) {
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = ids.length - 1; i >= 0; i--) {
    if (ids[i][0] === String(id)) {
      sheet.deleteRow(i + 2);
      return 1;
    }
  }
  return 0;
}

// 刪除符合條件的列（test 回傳 true 的列會被刪除）
function deleteRowsIf_(name, field, test) {
  const col = SCHEMA[name].indexOf(field);
  if (col < 0) return 0;
  const sheet = sheet_(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, col + 1, lastRow - 1, 1).getDisplayValues();
  let removed = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (test(values[i][0])) {
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

function deleteWhere_(name, field, value) {
  return deleteRowsIf_(name, field, v => v === String(value));
}

function deleteBefore_(name, field, before) {
  if (!before) return 0;
  const limit = new Date(before).getTime();
  return deleteRowsIf_(name, field, v => {
    const t = new Date(v).getTime();
    return !isNaN(t) && t < limit;
  });
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
