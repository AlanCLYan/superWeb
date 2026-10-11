// =============================================
// 入口網站核心：模組註冊、導覽列、頁面切換
// 一般情況下不需要修改這個檔案
// =============================================
const Portal = (() => {
  const modules = [];

  // 每個功能模組呼叫 Portal.register({...}) 把自己加進網站
  function register(mod) {
    modules.push(mod);
  }

  // 防止文字中的特殊符號破壞網頁
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // 把時間轉成「3 小時前」這種格式
  function timeAgo(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return '剛剛';
    if (diff < 60) return `${Math.floor(diff)} 分鐘前`;
    if (diff < 1440) return `${Math.floor(diff / 60)} 小時前`;
    return `${Math.floor(diff / 1440)} 天前`;
  }

  function demoBanner() {
    return DataStore.isDemo()
      ? `<div class="banner">目前顯示的是<strong>示範資料</strong>。接上 Google 試算表後，這裡會換成真實資料。</div>`
      : '';
  }

  function renderNav(activeId) {
    const nav = document.getElementById('nav');
    nav.innerHTML = [
      `<a href="#/" class="${activeId ? '' : 'active'}">首頁</a>`,
      ...modules.map(m =>
        `<a href="#/${m.id}" class="${m.id === activeId ? 'active' : ''}">${m.icon} ${esc(m.name)}</a>`)
    ].join('');
  }

  function renderHome(root) {
    root.innerHTML = `
      <section class="hero">
        <h1>歡迎回來</h1>
        <p>選擇一個功能開始使用。</p>
      </section>
      <section class="module-grid">
        ${modules.map(m => `
          <a class="module-card" href="#/${m.id}">
            <span class="module-icon">${m.icon}</span>
            <h2>${esc(m.name)}</h2>
            <p>${esc(m.description)}</p>
          </a>`).join('')}
        <div class="module-card placeholder">
          <span class="module-icon">＋</span>
          <h2>更多功能</h2>
          <p>之後新增的功能會出現在這裡。</p>
        </div>
      </section>`;
  }

  async function route() {
    const id = location.hash.replace(/^#\/?/, '').split('/')[0];
    const root = document.getElementById('app');
    const mod = modules.find(m => m.id === id);
    renderNav(mod ? id : '');

    if (!mod) {
      document.title = 'superWeb 萬用入口';
      renderHome(root);
      return;
    }

    document.title = `${mod.name} · superWeb`;
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

  return { register, start, esc, timeAgo, demoBanner };
})();
