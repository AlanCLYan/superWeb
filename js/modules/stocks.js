// =============================================
// 功能模組：股市焦點新聞
// =============================================
Portal.register({
  id: 'stocks',
  name: '股市新聞',
  icon: '📈',
  description: '台股、美股焦點新聞，自選股相關新聞優先標示。',

  // 記住目前選的篩選條件（切換頁面回來時保留）
  filter: { market: '全部', onlyWatch: false },

  async render(root) {
    const { esc, timeAgo, demoBanner } = Portal;
    const [watchlist, news] = await Promise.all([
      DataStore.get('watchlist'),
      DataStore.get('news')
    ]);
    const watchSymbols = new Set(watchlist.map(w => String(w.symbol).toUpperCase()));
    const related = item => String(item.symbols || '')
      .split(',').map(s => s.trim().toUpperCase()).filter(s => watchSymbols.has(s));

    const shown = news
      .filter(n => this.filter.market === '全部' || n.market === this.filter.market)
      .filter(n => !this.filter.onlyWatch || related(n).length)
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const tabs = ['全部', '台股', '美股'].map(m =>
      `<button class="tab ${m === this.filter.market ? 'active' : ''}" data-market="${m}">${m}</button>`).join('');

    const chips = watchlist.map(w => `
      <span class="chip">
        <strong>${esc(w.symbol)}</strong> ${esc(w.name || '')}
        <button data-unwatch="${esc(w.id)}" title="移除">✕</button>
      </span>`).join('');

    const items = shown.map(n => {
      const hits = related(n);
      const title = n.link
        ? `<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a>`
        : esc(n.title);
      return `
        <li class="news-item ${hits.length ? 'watched' : ''}">
          <div class="news-meta">
            <span class="tag">${esc(n.market)}</span>
            ${hits.map(s => `<span class="tag tag-good">${esc(s)}</span>`).join('')}
            <span class="muted small">${esc(n.source)}・${timeAgo(n.publishedAt)}</span>
          </div>
          <h3>${title}</h3>
        </li>`;
    }).join('');

    root.innerHTML = `
      ${demoBanner()}
      <div class="page-head">
        <h1>📈 股市焦點新聞</h1>
        <p class="muted">共 ${shown.length} 則</p>
      </div>

      <section class="card">
        <h2>自選股</h2>
        <div class="chips">${chips || '<span class="muted">尚未加入自選股</span>'}</div>
        <form id="watch-form" class="form-row">
          <label>代號<input name="symbol" placeholder="如 2454 或 TSLA" required></label>
          <label>名稱<input name="name" placeholder="如 聯發科"></label>
          <label>市場
            <select name="market"><option>台股</option><option>美股</option></select>
          </label>
          <button class="btn" type="submit">加入</button>
        </form>
      </section>

      <div class="toolbar">
        <div class="tabs">${tabs}</div>
        <label class="toggle">
          <input type="checkbox" id="only-watch" ${this.filter.onlyWatch ? 'checked' : ''}>
          只看自選股相關
        </label>
      </div>

      <ul class="news-list">${items || '<li class="muted">目前沒有符合條件的新聞。</li>'}</ul>`;

    root.querySelectorAll('[data-market]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.filter.market = btn.dataset.market;
        this.render(root);
      }));

    root.querySelector('#only-watch').addEventListener('change', e => {
      this.filter.onlyWatch = e.target.checked;
      this.render(root);
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
