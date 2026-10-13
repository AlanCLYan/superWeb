// =============================================
// 新功能模組範本（範例：簡易記事本）
//
// 這個檔案預設「沒有」載入，不會出現在網站上。
// 新增功能時：
//   1. 複製這個檔案，改名，例如 js/modules/notes.js
//   2. 修改下面標 ★ 的地方
//   3. 如果需要存資料：在 Apps Script 的 SCHEMA 加一個工作表（見 README）
//   4. 在 index.html 的模組區多加一行：
//        <script src="js/modules/notes.js"></script>
// =============================================
Portal.register({
  id: 'notes',                // ★ 網址代號（英文小寫，不能和其他模組重複）→ #/notes
  name: '記事本',              // ★ 導覽列與首頁顯示的名稱
  icon: '📝',                 // ★ 圖示（任何 emoji）
  description: '隨手記下想法，所有裝置同步。', // ★ 首頁卡片說明

  // 選填：首頁卡片上的一行摘要（不需要就整段刪掉）
  async summary() {
    const notes = await DataStore.get('notes');
    return `共 ${notes.length} 則記事`;
  },

  // 必填：畫出這個功能的頁面
  async render(root) {
    const { esc, timeAgo, demoBanner } = Portal;

    // ① 讀取資料：DataStore.get('工作表名稱') 會回傳一個陣列，每列是一個物件
    const notes = await DataStore.get('notes');
    notes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    // ② 畫出畫面（顯示任何資料都要用 esc() 包起來，避免特殊符號破壞網頁）
    root.innerHTML = `
      ${demoBanner()}
      <div class="page-head">
        <h1>📝 記事本</h1>
        <p class="muted">${notes.length} 則</p>
      </div>

      <section class="card form-card">
        <form id="note-form" class="form-row">
          <label style="flex:1">內容<input name="text" placeholder="寫點什麼…" required style="width:100%"></label>
          <button class="btn" type="submit">新增</button>
        </form>
      </section>

      <ul class="news-list" style="margin-top:16px">
        ${notes.map(n => `
          <li class="news-item">
            <div class="news-meta">
              <span class="muted small">${timeAgo(n.createdAt)}</span>
              <button class="icon-btn" data-remove="${esc(n.id)}" title="刪除" style="margin-left:auto">✕</button>
            </div>
            <h3>${esc(n.text)}</h3>
          </li>`).join('') || '<li class="muted">還沒有記事。</li>'}
      </ul>`;

    // ③ 新增資料：DataStore.add('工作表名稱', { 欄位: 值 })，id 會自動產生
    //    用 Portal.action() 包起來，失敗時會自動跳出提示
    root.querySelector('#note-form').addEventListener('submit', Portal.action(async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      await DataStore.add('notes', {
        text: f.get('text').trim(),
        createdAt: new Date().toISOString()
      });
      this.render(root); // 重新畫一次頁面
    }));

    // ④ 刪除資料：DataStore.remove('工作表名稱', id)
    root.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', Portal.action(async () => {
        if (!confirm('確定刪除？')) return;
        await DataStore.remove('notes', btn.dataset.remove);
        this.render(root);
      })));
  }
});
