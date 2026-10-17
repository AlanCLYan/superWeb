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

  // 農曆日期，例如「丙午年九月初八」
  // 使用內建的農曆月份表（2024–2060），不依賴瀏覽器，iPhone、Android、電腦結果都一樣。
  // 表中每個字元代表一個農曆月：第幾月、是否閏月、大月（30 天）或小月（29 天）。
  const LUNAR = {
    base: Date.UTC(2024, 1, 10), // 2024-02-10 = 甲辰年正月初一
    year: 2024,
    table: 'ADEGJKNPQTVWBCFGILiNORTVWBCFGILMORTVXADEHIKNOQTVWBDFGJgKNOQTVWBDEHILMPQSVWBDEHJKNORSVWADFcHILNORSVWBCEHILNORTUXADEGJKNORTVsXADEGJKNORTUXBCFGILMORTUXBDEHIKjMORSVXBDEHIKNOQTUXBDEHILMPQSVWBDEHJgLMPQTUWBCFHILMPRSVWADEHILNORTUXADaEHILMPRSVXADEGJKMPRSVXBCFGILMkPQTVXBCFGILMORSVXBCFGJKNOQTUXBCFHIhKNOQTUXADFGJLMPQSVWBCFGJLMPRSVWADEdGJKNPQTVWBCEHIKNPQTVXADEGJKMPmRTVXADEGJKMPQTVXADFGILMORSVXADFGJKjMORSVWBDFGJKNOQTUXADFGJKNPQSVWBCFGfILNORTUWBCFGJKNORTVWBCEHIKNORTV'
  };
  const LUNAR_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const LUNAR_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

  function lunarDate(d = new Date()) {
    // 先取得台灣當地的年月日
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
    const num = type => Number((parts.find(p => p.type === type) || {}).value);
    let offset = Math.round((Date.UTC(num('year'), num('month') - 1, num('day')) - LUNAR.base) / 86400000);
    if (!(offset >= 0)) return '';

    let year = LUNAR.year;
    for (let i = 0; i < LUNAR.table.length; i++) {
      const v = LUNAR_CODES.indexOf(LUNAR.table[i]);
      const len = 29 + (v & 1);
      const code = v >> 1;
      const leap = code >= 12;
      const month = (code % 12) + 1;
      if (i > 0 && month === 1 && !leap) year++;
      if (offset < len) {
        const n = offset + 1;
        const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        const day = n <= 10 ? `初${digits[n]}`
          : n < 20 ? `十${digits[n - 10]}`
          : n === 20 ? '二十'
          : n < 30 ? `廿${digits[n - 20]}`
          : '三十';
        const stem = '甲乙丙丁戊己庚辛壬癸'[(year - 4) % 10];
        const branch = '子丑寅卯辰巳午未申酉戌亥'[(year - 4) % 12];
        return `${stem}${branch}年${leap ? '閏' : ''}${LUNAR_MONTHS[month - 1]}${day}`;
      }
      offset -= len;
    }
    return '';
  }

  const clockText = () => new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });
  const dateText = () => new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' });

  // 首頁的時間每分鐘更新一次（離開首頁時停止）
  let clockTimer = null;
  function stopClock() {
    clearTimeout(clockTimer);
    clockTimer = null;
  }
  function tickClock(root) {
    const hero = root.querySelector('.hero');
    if (!hero) return stopClock();
    hero.querySelector('.clock').textContent = clockText();
    hero.querySelector('.greet').textContent = greeting();
    hero.querySelector('.date').textContent = dateText();
    const lunar = lunarDate();
    hero.querySelector('.lunar').textContent = lunar ? `農曆${lunar}` : '';
    clockTimer = setTimeout(() => tickClock(root), 60000 - (Date.now() % 60000) + 50);
  }

  function renderHome(root) {
    const lunar = lunarDate();
    root.innerHTML = `
      <section class="hero">
        <h1><time class="clock">${clockText()}</time><span class="greet">${greeting()}</span></h1>
        <p><span class="date">${dateText()}</span><span class="lunar">${lunar ? `農曆${lunar}` : ''}</span></p>
      </section>
      ${demoBanner()}
      <section class="module-grid">
        ${modules.map(m => `
          <a class="module-card ${m.url ? 'external' : ''}" href="${m.url ? esc(m.url) : `#/${m.id}`}"${m.url ? ' target="_blank" rel="noopener"' : ''}>
            <span class="module-icon">${m.icon || '📄'}</span>
            <h2>${esc(m.name)}${m.url ? '<span class="ext" aria-label="（另開網站）">↗</span>' : ''}</h2>
            <p class="module-desc">${esc(m.description || '')}</p>
            ${m.summary ? `<p class="module-summary" data-summary="${esc(m.id)}">讀取中…</p>` : ''}
            ${m.url && !m.summary ? `<p class="module-summary">${esc(new URL(m.url).host + new URL(m.url).pathname.replace(/\/$/, ''))}</p>` : ''}
            ${!m.url && !m.summary ? '<p class="module-summary empty"></p>' : ''}
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
    stopClock();
    const id = location.hash.replace(/^#\/?/, '').split('/')[0];
    const root = document.getElementById('app');
    const mod = modules.find(m => m.id === id && m.render);
    renderNav(mod ? id : '');

    if (!mod) {
      document.title = 'SUPER Web 萬用入口';
      renderHome(root);
      clockTimer = setTimeout(() => tickClock(root), 60000 - (Date.now() % 60000) + 50);
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

  // ---------- 手機版選單 ----------
  function setupMenu() {
    const bar = document.querySelector('.topbar');
    const btn = document.getElementById('menu-btn');
    if (!bar || !btn) return;
    const setOpen = open => {
      bar.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
    };
    btn.addEventListener('click', () => setOpen(!bar.classList.contains('menu-open')));
    // 點選單裡的項目、點選單外面、按 Esc、或切換頁面時，自動收起
    document.getElementById('nav').addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('click', e => { if (!bar.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('hashchange', () => setOpen(false));
  }

  function start() {
    setupMenu();
    window.addEventListener('hashchange', route);
    route();
  }

  return { register, start, esc, timeAgo, demoBanner, action };
})();
