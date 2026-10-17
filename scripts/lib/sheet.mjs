// =============================================
// 共用：讀寫 Google 試算表（所有抓取程式都使用這個檔案）
//
// - 遇到暫時性問題（網路中斷、Apps Script 忙碌或逾時）會自動重試 3 次
// - 設定錯誤（缺少 Secrets、密碼錯誤）會標示為 ConfigError，讓排程顯示失敗
// =============================================

export class ConfigError extends Error {}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createSheet({ url, key }) {
  if (!url) throw new ConfigError('缺少設定 SHEET_API_URL，請到 GitHub → Settings → Secrets 新增');
  if (!key) throw new ConfigError('缺少設定 WRITE_KEY，請到 GitHub → Settings → Secrets 新增');

  // 送出請求並解析 JSON，失敗時重試（等 3 秒、6 秒）
  async function request(label, doFetch) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await doFetch();
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          // Apps Script 出錯時會回傳 HTML 錯誤頁，而不是 JSON
          const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
          throw new Error(`Apps Script 回應異常（HTTP ${res.status}）：${snippet}`);
        }
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          console.warn(`${label} 第 ${attempt} 次失敗，稍後重試：${err.message}`);
          await sleep(attempt * 3000);
        }
      }
    }
    throw new Error(`${label} 失敗：${lastError.message}`);
  }

  async function get(sheet) {
    const data = await request(`讀取 ${sheet}`, () => fetch(`${url}?sheet=${encodeURIComponent(sheet)}`));
    if (!Array.isArray(data)) {
      if (/找不到工作表/.test(data.error || '')) {
        throw new ConfigError(`試算表沒有「${sheet}」工作表，請在 Apps Script 執行 setup 並部署新版本`);
      }
      throw new Error(`讀取 ${sheet} 失敗：${data.error || '未知錯誤'}`);
    }
    return data;
  }

  async function post(body) {
    const data = await request(`寫入 ${body.sheet || body.action}`, () => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key })
    }));
    if (!data.ok) {
      if (data.error === 'unauthorized') throw new ConfigError('寫入密碼不正確，請檢查 GitHub Secrets 的 WRITE_KEY');
      throw new Error(`寫入失敗：${data.error}`);
    }
    return data;
  }

  return { get, post };
}

// 統一的結束方式
//   設定錯誤（ConfigError）→ 一律讓排程顯示失敗，GitHub 會寄信通知
//   其他錯誤：strict = true 顯示失敗；strict = false 只記錄，不顯示失敗
//   （新聞每 15 分鐘執行，偶發錯誤下次就會恢復，不需要每次都寄信）
export function run(main, { strict = true } = {}) {
  main().catch(err => {
    console.error(`執行失敗：${err.message}`);
    if (err instanceof ConfigError || strict) {
      process.exitCode = 1;
    } else {
      console.error('（暫時性問題，下次排程會自動再試，因此不標示為失敗）');
    }
  });
}
