# superWeb 萬用入口網站

個人用的入口網站，目前有兩個功能：

- ✈️ **便宜機票**：追蹤航線價格（固定日期或彈性月份），每天自動查價，達到目標價時寄 Email 提醒
- 📈 **股市新聞**：台股、美股焦點新聞每 15 分鐘自動更新，自選股相關新聞優先標示

網址：https://alanclyan.github.io/superWeb/

---

## 一、整體架構

```
┌──────────────────────┐      寫入       ┌───────────────────────┐      讀寫      ┌──────────────────────┐
│ GitHub Actions 排程   │ ─────────────▶ │ Google 試算表（資料庫） │ ◀───────────▶ │ 網站（GitHub Pages）  │
│ scripts/*.mjs        │                │ 透過 Apps Script 存取   │               │ index.html + js/     │
└──────────────────────┘                └───────────────────────┘               └──────────────────────┘
  機票：每天 06:17                         routes / prices / history               你在手機、電腦上看資料
  新聞：08:13～23:58 每 15 分鐘             watchlist / news / meta                 新增航線、自選股
```

| 角色 | 放在哪裡 | 費用 |
|---|---|---|
| 網站 | GitHub Pages（這個儲存庫） | 免費 |
| 資料庫 | Google 試算表「superWeb 資料庫」＋ Apps Script | 免費 |
| 自動抓取 | GitHub Actions | 公開儲存庫免費 |
| 機票價格 | SerpApi（Google 航班） | 免費每月 250 次 |
| 新聞 | Yahoo股市 RSS、Google 新聞 RSS | 免費 |

---

## 二、檔案結構

```
superWeb/
├─ index.html                 網站入口（新增功能時要在這裡加一行 <script>）
├─ favicon.png, icon-180.png  網站圖示
├─ css/style.css              所有樣式（自動支援深色模式）
├─ js/
│  ├─ data.js                 資料層：所有讀寫試算表的動作都在這裡（Apps Script 網址也在這）
│  ├─ app.js                  核心：導覽列、首頁、頁面切換（一般不用改）
│  └─ modules/                ★ 每個功能一個檔案
│     ├─ flights.js           便宜機票
│     ├─ stocks.js            股市新聞
│     └─ _template.js         新功能範本（不會載入）
├─ scripts/                   自動抓取程式（由 GitHub Actions 執行）
│  ├─ fetch-flights.mjs
│  ├─ fetch-news.mjs
│  └─ _template-fetch.mjs     抓取程式範本
├─ apps-script/Code.gs        Apps Script 程式備份（密碼已移除）
└─ .github/workflows/         排程設定
   ├─ fetch-flights.yml
   └─ fetch-news.yml
```

---

## 三、新增一個功能模組

以「記事本」為例。範本 `js/modules/_template.js` 就是一個完整可用的記事本，可以照著改。

### 步驟 1：決定要存哪些資料（不需要存資料可跳過）

打開試算表 → **擴充功能 → Apps Script**，在 `SCHEMA` 裡加一個工作表與欄位：

```js
const SCHEMA = {
  routes: [...],
  // ...原本的不要動...
  notes: ['id', 'text', 'createdAt']   // ← 新增這行，第一個欄位一定要是 id
};
```

- 欄位如果是數字，把欄位名稱加進 `NUMBER_FIELDS`，讀出來才會是數字
- 已經有資料的工作表要加欄位時，**一律加在最後面**，舊資料才不會錯位

接著：
1. 儲存，函式選 **setup** → ▶ 執行（會自動建立新的工作表）
2. **部署 → 管理部署作業 → ✏️ 編輯 → 版本選「新版本」→ 部署**（網址不變）

> 只改程式不重新部署，網站會繼續使用舊版本。

### 步驟 2：建立模組檔

複製 `js/modules/_template.js`，改名為 `js/modules/notes.js`，修改標 ★ 的地方：

```js
Portal.register({
  id: 'notes',          // 網址代號 → #/notes
  name: '記事本',
  icon: '📝',
  description: '隨手記下想法',
  async summary() { ... },   // 選填：首頁卡片上的一行摘要
  async render(root) { ... } // 必填：畫出頁面
});
```

在 `render` 裡可以使用：

| 寫法 | 用途 |
|---|---|
| `await DataStore.get('notes')` | 讀取整個工作表，回傳陣列 |
| `await DataStore.add('notes', { text: '…' })` | 新增一列（id 自動產生，第一次會要求輸入寫入密碼） |
| `await DataStore.remove('notes', id)` | 刪除一列 |
| `Portal.esc(文字)` | 顯示資料前一定要用，避免特殊符號破壞網頁 |
| `Portal.timeAgo(時間)` | 轉成「3 小時前」 |
| `Portal.action(async () => {...})` | 包住按鈕動作，失敗時自動跳出提示 |

可直接使用的樣式：`card`、`grid`、`btn`、`tag`、`tag-good`、`muted`、`small`、`form-row`、`tabs`／`tab`、`chip`、`news-list`／`news-item`。

### 步驟 3：加進網站

在 `index.html` 的模組區多加一行：

```html
<script src="js/modules/flights.js"></script>
<script src="js/modules/stocks.js"></script>
<script src="js/modules/notes.js"></script>   <!-- ← 新增 -->
```

順序就是導覽列和首頁卡片的順序。上傳後 1～2 分鐘，導覽列和首頁就會出現新功能。

### 步驟 4（選用）：需要定時自動抓資料

1. 複製 `scripts/_template-fetch.mjs`，改名為例如 `scripts/fetch-notes.mjs`，在 `collect()` 裡寫抓資料的方式
2. 用 **Add file → Create new file** 建立 `.github/workflows/fetch-notes.yml`：

```yaml
name: 抓取記事資料

on:
  schedule:
    - cron: '7 0 * * *'     # UTC 時間；台灣 = UTC+8，這行是台灣 08:07
  workflow_dispatch:

jobs:
  fetch:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: node scripts/fetch-notes.mjs
        env:
          SHEET_API_URL: ${{ secrets.SHEET_API_URL }}
          WRITE_KEY: ${{ secrets.WRITE_KEY }}
          # 需要其他 API 金鑰時：先在 Settings → Secrets 新增，再加在這裡
          # MY_API_KEY: ${{ secrets.MY_API_KEY }}
```

3. 到 **Actions** 手動執行一次確認成功

> cron 小技巧：避開整點與 :00、:15、:30、:45，GitHub 比較準時。時間換算：台灣時間減 8 小時。

---

## 四、日常維護

| 情況 | 怎麼做 |
|---|---|
| 想換寫入密碼 | Apps Script 改 `WRITE_KEY` → 部署新版本；GitHub Secrets 的 `WRITE_KEY` 也要改；網站下次寫入時輸入新密碼 |
| 換了一台裝置 | 第一次新增或刪除資料時會要求輸入寫入密碼，輸入一次就會記住 |
| 機票額度不夠 | 網站機票頁會顯示「本月剩餘查詢次數」；每天最多查 8 條（`fetch-flights.mjs` 的 `MAX_CALLS_PER_RUN`） |
| 想手動更新 | GitHub → Actions → 選排程 → **Run workflow** |
| 排程被暫停 | 公開儲存庫 60 天沒有任何更新，GitHub 會暫停排程（會先寄信）。到 Actions 頁面按 **Enable workflow** 即可 |
| 修改 Apps Script 後網站沒變 | 一定要「部署 → 管理部署作業 → 編輯 → 新版本」 |
| 上傳後網站沒變 | 等 1～2 分鐘，用無痕視窗或強制重新整理（Mac：Cmd+Shift+R） |

### GitHub Secrets 一覽

| 名稱 | 內容 | 用在 |
|---|---|---|
| `SHEET_API_URL` | Apps Script 網址（`/exec` 結尾） | 所有抓取程式 |
| `WRITE_KEY` | 寫入密碼 | 所有抓取程式 |
| `SERPAPI_KEY` | SerpApi 金鑰 | 機票 |

---

## 五、疑難排解

- **網站顯示「載入失敗」**：打開 `你的 Apps Script 網址?sheet=routes`，應該看到一串資料。看到登入頁 → 部署時「誰可以存取」要選「所有人」
- **新增資料時顯示「寫入密碼不正確」**：密碼和 Apps Script 第 13 行不一致；輸入錯誤時會自動再問一次
- **Actions 出現紅色叉叉**：點進去看「抓取…」步驟最後幾行的錯誤訊息
  - `寫入密碼不正確` → 檢查 Secrets 的 `WRITE_KEY`
  - `缺少設定 …` → 對應的 Secret 沒有設定
  - `Invalid API key` → 檢查 `SERPAPI_KEY`
- **某條航線一直查無航班**：機場代碼是否正確；彈性月份只能查未來 6 個月內
