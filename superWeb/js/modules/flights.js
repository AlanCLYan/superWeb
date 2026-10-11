// =============================================
// 功能模組：便宜機票追蹤
// =============================================
Portal.register({
  id: 'flights',
  name: '便宜機票',
  icon: '✈️',
  description: '追蹤想去的航線，價格低於目標時標示提醒。',

  async render(root) {
    const { esc, timeAgo, demoBanner } = Portal;
    const [routes, prices] = await Promise.all([
      DataStore.get('routes'),
      DataStore.get('prices')
    ]);
    const money = n => `NT$ ${Number(n).toLocaleString('zh-TW')}`;

    const cards = routes.map(r => {
      const list = prices
        .filter(p => p.routeId === r.id)
        .sort((a, b) => a.price - b.price);
      const best = list[0];
      const hit = best && best.price <= r.target;

      return `
        <article class="card route-card ${hit ? 'hit' : ''}">
          <header class="route-head">
            <div>
              <h3>${esc(r.from)} → ${esc(r.to)}</h3>
              <span class="muted">${esc(r.toName || '')}</span>
            </div>
            <button class="icon-btn" data-remove="${esc(r.id)}" title="刪除這條航線">✕</button>
          </header>

          ${best ? `
            <div class="price-row">
              <span class="price">${money(best.price)}</span>
              ${hit ? '<span class="tag tag-good">低於目標價</span>' : ''}
            </div>
            <p class="muted small">
              目標價 ${money(r.target)}・${esc(best.airline)}・${esc(best.depart)} 出發・${timeAgo(best.fetchedAt)}更新
            </p>
            ${list.length > 1 ? `
              <details>
                <summary>其他 ${list.length - 1} 筆報價</summary>
                <ul class="price-list">
                  ${list.slice(1).map(p => `
                    <li><span>${esc(p.airline)}・${esc(p.depart)}</span><span>${money(p.price)}</span></li>`).join('')}
                </ul>
              </details>` : ''}
          ` : `
            <p class="muted">尚無報價資料，排程抓取後會出現在這裡。</p>
            <p class="muted small">目標價 ${money(r.target)}</p>
          `}
        </article>`;
    }).join('');

    root.innerHTML = `
      ${demoBanner()}
      <div class="page-head">
        <h1>✈️ 便宜機票</h1>
        <p class="muted">共追蹤 ${routes.length} 條航線</p>
      </div>

      <section class="grid">${cards || '<p class="muted">還沒有追蹤任何航線。</p>'}</section>

      <section class="card form-card">
        <h2>新增追蹤航線</h2>
        <form id="route-form" class="form-row">
          <label>出發<input name="from" value="TPE" maxlength="3" required></label>
          <label>目的地代碼<input name="to" placeholder="如 OKA" maxlength="3" required></label>
          <label>目的地名稱<input name="toName" placeholder="如 沖繩"></label>
          <label>目標價（NT$）<input name="target" type="number" min="0" step="100" placeholder="如 6000" required></label>
          <button class="btn" type="submit">新增</button>
        </form>
        <p class="muted small">機場代碼是 3 個英文字母，例如 TPE 桃園、NRT 成田、HND 羽田、KIX 關西。</p>
      </section>`;

    root.querySelector('#route-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      await DataStore.add('routes', {
        from: f.get('from').trim().toUpperCase(),
        to: f.get('to').trim().toUpperCase(),
        toName: f.get('toName').trim(),
        target: Number(f.get('target'))
      });
      this.render(root);
    });

    root.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', async () => {
        if (!confirm('確定不再追蹤這條航線？')) return;
        await DataStore.remove('routes', btn.dataset.remove);
        this.render(root);
      }));
  }
});
