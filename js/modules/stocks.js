// =============================================
// 功能模組：股市焦點新聞
// =============================================
Portal.register({
  id: 'stocks',
  name: '股市新聞',
  icon: '📈',
  description: '台股、美股焦點新聞每 15 分鐘自動更新，自選股相關新聞優先標示。',

  // 記住目前的篩選條件（切換頁面回來時保留）
  // watch：'' = 全部新聞、'*' = 所有自選股相關、其他 = 單一檔自選股代號
  filter: { market: '全部', watch: '', keyword: '', limit: 50 },

  cache: null,

  // 首頁卡片上的摘要
  async summary() {
    const [watchlist, news] = await Promise.all([DataStore.get('watchlist'), DataStore.get('news')]);
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
    const todays = news.filter(n => new Date(n.publishedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }) === today);
    const symbols = new Set(watchlist.map(w => String(w.symbol).toUpperCase()));
    const names = watchlist.map(w => w.name).filter(Boolean);
    const watched = todays.filter(n =>
      String(n.symbols || '').split(',').some(s => symbols.has(s.trim().toUpperCase()))
      || names.some(name => String(n.title).includes(name)));
    return `今天 ${todays.length} 則新聞` + (watched.length ? `・<strong class="good">自選股相關 ${watched.length} 則</strong>` : '');
  },

  // opts.reload = false：只改篩選條件，沿用已載入的資料（不重新讀取試算表）
  async render(root, opts = {}) {
    const { esc, timeAgo, demoBanner } = Portal;
    if (opts.reload !== false || !this.cache) {
      this.cache = await Promise.all([
        DataStore.get('watchlist'),
        DataStore.get('news'),
        DataStore.get('meta').catch(() => [])
      ]);
    }
    const [watchlist, news, meta] = this.cache;
    const metaValue = id => (meta.find(m => m.id === id) || {}).value || '';

    // 自選股比對：抓取時標記的代號，加上標題中出現的名稱或代號
    const watch = watchlist.map(w => ({
      symbol: String(w.symbol || '').toUpperCase(),
      name: String(w.name || '')
    }));
    const related = item => {
      const tagged = String(item.symbols || '').split(',').map(s => s.trim().toUpperCase());
      const title = String(item.title || '');
      const upper = title.toUpperCase();
      return watch
        .filter(w => tagged.includes(w.symbol)
          || (w.name && title.includes(w.name))
          || (w.symbol.length >= 2 && new RegExp(`(^|[^A-Z0-9])${w.symbol}([^A-Z0-9]|$)`).test(upper)))
        .map(w => w.symbol);
    };

    if (this.filter.watch && this.filter.watch !== '*' && !watch.some(w => w.symbol === this.filter.watch)) this.filter.watch = '';
    const kw = this.filter.keyword.trim().toLowerCase();
    const all = news
      .map(n => ({ ...n, hits: related(n) }))
      .filter(n => this.filter.market === '全部' || n.market === this.filter.market)
      .filter(n => !this.filter.watch
        || (this.filter.watch === '*' ? n.hits.length : n.hits.includes(this.filter.watch)))
      .filter(n => !kw || `${n.title} ${n.source}`.toLowerCase().includes(kw))
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    const shown = all.slice(0, this.filter.limit);

    // 依日期分組（台灣時間）
    const dayKey = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
    const today = dayKey(new Date().toISOString());
    const yesterday = dayKey(new Date(Date.now() - 86400000).toISOString());
    const dayLabel = key => {
      if (key === today) return '今天';
      if (key === yesterday) return '昨天';
      const [, m, d] = key.split('-');
      const w = '日一二三四五六'[new Date(`${key}T12:00:00+08:00`).getDay()];
      return `${Number(m)}/${Number(d)}（${w}）`;
    };
    const timeOf = iso => new Date(iso).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false });

    let lastDay = '';
    const items = shown.map(n => {
      const key = dayKey(n.publishedAt);
      const header = key !== lastDay ? `<li class="day-head">${dayLabel(key)}</li>` : '';
      lastDay = key;
      const title = n.link
        ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
        : esc(n.title);
      return `${header}
        <li class="news-item ${n.hits.length ? 'watched' : ''}">
          <div class="news-meta">
            <span class="tag">${esc(n.market)}</span>
            ${n.hits.map(s => `<span class="tag tag-good">${esc(s)}</span>`).join('')}
            <span class="muted small">${esc(n.source)}・${timeOf(n.publishedAt)}・${timeAgo(n.publishedAt)}</span>
          </div>
          <h3>${title}</h3>
        </li>`;
    }).join('');

    const tabs = [['全部', '全部'], ['台股', '台股'], ['美股', '美股・國際']].map(([value, label]) =>
      `<button class="tab ${value === this.filter.market ? 'active' : ''}" data-market="${value}">${label}</button>`).join('');

    const chips = watchlist.map(w => `
      <span class="chip">
        <strong>${esc(w.symbol)}</strong> ${esc(w.name || '')}
        <button data-unwatch="${esc(w.id)}" title="移除">✕</button>
      </span>`).join('');

    const lastRun = metaValue('news.lastRun');
    const lastMessage = metaValue('news.lastMessage');

    root.innerHTML = `
      ${demoBanner()}
      <div class="page-head">
        <h1>📈 股市焦點新聞</h1>
        <p class="muted">${all.length} 則</p>
      </div>
      <p class="muted small status-line">${lastRun ? `上次自動更新：${timeAgo(lastRun)}・每 15 分鐘更新（08:13～23:58）` : '尚未執行過自動抓取'}</p>
      ${/全部來源失敗/.test(lastMessage) ? `<p class="warn small">新聞抓取失敗：${esc(lastMessage)}</p>` : ''}

      <section class="card">
        <h2>自選股</h2>
        <div class="chips">${chips || '<span class="muted">尚未加入自選股</span>'}</div>
        <form id="watch-form" class="form-row">
          <label>代號<input name="symbol" placeholder="如 2454 或 TSLA" required></label>
          <label>名稱<input name="name" placeholder="如 聯發科、特斯拉"></label>
          <label>市場
            <select name="market"><option>台股</option><option>美股</option></select>
          </label>
          <button class="btn" type="submit">加入</button>
        </form>
        <p class="muted small">名稱請填新聞常用的中文名稱（例如 NVIDIA 填「輝達」），比較容易抓到相關新聞。新加入的自選股，下次自動更新時就會開始收集新聞。</p>
      </section>

      <div class="toolbar">
        <div class="tabs">${tabs}</div>
        <input id="kw" class="search" type="search" placeholder="搜尋標題…" value="${esc(this.filter.keyword)}">
        <label class="watch-filter">
          <span class="muted small">自選股</span>
          <select id="watch-filter">
            <option value="">全部新聞</option>
            <option value="*" ${this.filter.watch === '*' ? 'selected' : ''}>所有自選股相關</option>
            ${watch.map(w => {
              const count = news.filter(n => related(n).includes(w.symbol)).length;
              return `<option value="${esc(w.symbol)}" ${this.filter.watch === w.symbol ? 'selected' : ''}>${esc(w.symbol)} ${esc(w.name)}（${count}）</option>`;
            }).join('')}
          </select>
        </label>
      </div>

      <ul class="news-list">${items || '<li class="muted">目前沒有符合條件的新聞。</li>'}</ul>
      ${all.length > shown.length ? `<div class="more"><button class="btn btn-ghost" id="more">顯示更多（還有 ${all.length - shown.length} 則）</button></div>` : ''}
      <p class="muted small credit">新聞來源：Yahoo股市、Google 新聞，著作權屬各原始媒體。</p>`;

    root.querySelectorAll('[data-market]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.filter.market = btn.dataset.market;
        this.filter.limit = 50;
        this.render(root, { reload: false });
      }));

    root.querySelector('#watch-filter').addEventListener('change', e => {
      this.filter.watch = e.target.value;
      this.filter.limit = 50;
      this.render(root, { reload: false });
    });

    // 搜尋：輸入停頓 0.3 秒後再篩選，並保持游標在輸入框
    const kwInput = root.querySelector('#kw');
    let timer;
    kwInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        this.filter.keyword = kwInput.value;
        this.filter.limit = 50;
        await this.render(root, { reload: false });
        const again = root.querySelector('#kw');
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }, 300);
    });

    const more = root.querySelector('#more');
    if (more) more.addEventListener('click', () => {
      const y = window.scrollY;
      this.filter.limit += 50;
      this.render(root, { reload: false }).then(() => window.scrollTo(0, y));
    });

    root.querySelector('#watch-form').addEventListener('submit', Portal.action(async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      await DataStore.add('watchlist', {
        symbol: f.get('symbol').trim().toUpperCase(),
        name: f.get('name').trim(),
        market: f.get('market')
      });
      this.render(root);
    }));

    root.querySelectorAll('[data-unwatch]').forEach(btn =>
      btn.addEventListener('click', Portal.action(async () => {
        await DataStore.remove('watchlist', btn.dataset.unwatch);
        this.render(root);
      })));
  }
});
