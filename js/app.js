// =============================================
// 入口網站核心：模組註冊、導覽列、頁面切換、首頁
// 一般情況下不需要修改這個檔案。
//
// 每個功能模組用 Portal.register({...}) 把自己加進網站，可用的欄位：
//   id           網址代號，例如 'flights' → 網址 #/flights（英文小寫）
//   name         顯示名稱
//   icon         圖示（emoji）
//   description  首頁卡片上的說明
//   render(root) 把頁面內容畫進 root（站內功能必填）
//   url          外部網站網址：有填就變成「入口卡片」，點了另開分頁（此時不需要 render）
//   summary()    選填，回傳一行文字顯示在首頁卡片上，例如「3 條航線達標」
// =============================================
const Portal = (() => {
  const modules = [];

  function register(mod) {
    if (!mod.id || !(mod.render || mod.url)) throw new Error('模組必須有 id，以及 render 或 url');
    if (modules.some(m => m.id === mod.id)) throw new Error(`模組 id 重複：${mod.id}`);
    modules.push(mod);
  }

  // ---------- 給各模組使用的小工具 ----------

  // 防止文字中的特殊符號破壞網頁（顯示任何資料前都要經過它）
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 把時間轉成「3 小時前」這種格式
  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = (Date.now() - t) / 60000;
    if (diff < 1) return '剛剛';
    if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
    if (diff < 1440) return `${Math.floor(diff / 60)} 小時前`;
    return `${Math.floor(diff / 1440)} 天前`;
  }

  // 示範模式提示（沒有接上 Google 試算表時顯示）
  function demoBanner() {
    return DataStore.isDemo()
      ? `<div class="banner">目前顯示的是<strong>示範資料</strong>。接上 Google 試算表後，這裡會換成真實資料。</div>`
      : '';
  }

  // 包住新增、刪除等動作：失敗時跳出提示，而不是默默沒反應
  function action(fn) {
    return async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        alert(`操作失敗：${err.message}`);
      }
    };
  }

  // ---------- 導覽列與首頁 ----------
  function renderNav(activeId) {
    const nav = document.getElementById('nav');
    nav.innerHTML = [
      `<a href="#/" class="${activeId ? '' : 'active'}">首頁</a>`,
      ...modules.map(m => m.url
        ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${m.icon || ''} ${esc(m.name)}<span class="ext" aria-label="（另開網站）">↗</span></a>`
        : `<a href="#/${m.id}" class="${m.id === activeId ? 'active' : ''}">${m.icon || ''} ${esc(m.name)}</a>`)
    ].join('');
  }

  function greeting() {
    const h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', hour12: false }));
    if (h < 5) return '夜深了';
    if (h < 11) return '早安';
    if (h < 14) return '午安';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  function renderHome(root) {
    const date = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' });
    root.innerHTML = `
      <section class="hero">
        <h1>${greeting()}</h1>
        <p>${date}</p>
      </section>
      ${demoBanner()}
      <section class="module-grid">
        ${modules.map(m => `
          <a class="module-card ${m.url ? 'external' : ''}" href="${m.url ? esc(m.url) : `#/${m.id}`}"${m.url ? ' target="_blank" rel="noopener"' : ''}>
            <span class="module-icon">${m.icon || '📄'}</span>
            <h2>${esc(m.name)}${m.url ? '<span class="ext" aria-label="（另開網站）">↗</span>' : ''}</h2>
            <p>${esc(m.description || '')}</p>
            ${m.summary ? `<p class="module-summary" data-summary="${esc(m.id)}">讀取中…</p>` : ''}
            ${m.url && !m.summary ? `<p class="module-summary">${esc(new URL(m.url).host + new URL(m.url).pathname.replace(/\/$/, ''))}</p>` : ''}
          </a>`).join('')}
      </section>`;

    // 各模組的摘要各自載入，某個失敗不影響其他
    modules.filter(m => m.summary).forEach(async m => {
      const el = root.querySelector(`[data-summary="${m.id}"]`);
      try {
        const text = await m.summary();
        if (el) el.innerHTML = text || '';
      } catch {
        if (el) el.textContent = '';
      }
    });
  }

  // ---------- 頁面切換 ----------
  async function route() {
    const id = location.hash.replace(/^#\/?/, '').split('/')[0];
    const root = document.getElementById('app');
    const mod = modules.find(m => m.id === id && m.render);
    renderNav(mod ? id : '');

    if (!mod) {
      document.title = 'SUPER Web 萬用入口';
      renderHome(root);
      return;
    }

    document.title = `${mod.name} · SUPER Web`;
    root.innerHTML = '<p class="loading">載入中…</p>';
    try {
      await mod.render(root);
    } catch (err) {
      root.innerHTML = `<div class="error">載入失敗：${esc(err.message)}</div>`;
    }
    window.scrollTo(0, 0);
  }

  function start() {
    window.addEventListener('hashchange', route);
    route();
  }

  return { register, start, esc, timeAgo, demoBanner, action };
})();
