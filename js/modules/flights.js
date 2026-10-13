// =============================================
// 功能模組：便宜機票追蹤
//   固定日期：指定出發（與回程）日期，追蹤價格變化
//   彈性月份：指定月份與行程長度，找出該月最便宜的日期
// =============================================
Portal.register({
  id: 'flights',
  name: '便宜機票',
  icon: '✈️',
  description: '追蹤想去的航線，價格低於目標時標示並寄信提醒。',

  formMode: 'date', // 新增表單目前選的模式

  async render(root) {
    const { esc, timeAgo, demoBanner } = Portal;
    const [routes, prices, history, meta] = await Promise.all([
      DataStore.get('routes'),
      DataStore.get('prices'),
      DataStore.get('history').catch(() => []),
      DataStore.get('meta').catch(() => [])
    ]);

    const money = n => `NT$ ${Number(n).toLocaleString('zh-TW')}`;
    const DURATION_LABEL = { oneway: '單程', weekend: '週末', week: '一週', twoweeks: '兩週' };
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
    const md = d => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
      return m ? `${Number(m[2])}/${Number(m[3])}` : esc(d);
    };
    const metaValue = id => (meta.find(m => m.id === id) || {}).value || '';

    // 未來 6 個月（彈性月份只能查詢這個範圍）
    const monthOptions = Array.from({ length: 6 }, (_, i) => {
      const [y, m] = today.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + i, 1));
      const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      return `<option value="${val}">${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月</option>`;
    }).join('');

    // 航線說明文字
    function routeWhen(r) {
      if (r.mode === 'date') {
        return r.returnDate
          ? `${md(r.departDate)} 出發・${md(r.returnDate)} 回程`
          : `${md(r.departDate)} 出發・單程`;
      }
      if (r.mode === 'month') {
        const m = /^(\d{4})-(\d{2})$/.exec(r.month || '');
        return `${m ? `${Number(m[2])} 月` : esc(r.month)}・${DURATION_LABEL[r.duration] || ''}・彈性日期`;
      }
      return '';
    }

    function routeProblem(r) {
      if (r.mode === 'date') return r.departDate && r.departDate < today ? '出發日期已過，不再更新' : '';
      if (r.mode === 'month') return r.month && r.month < today.slice(0, 7) ? '月份已過，不再更新' : '';
      return '尚未設定日期，請刪除後重新新增';
    }

    // 小型價格走勢圖
    function sparkline(points) {
      if (points.length < 2) return '';
      const w = 120, h = 32, pad = 3;
      const vals = points.map(p => p.minPrice);
      const min = Math.min(...vals), max = Math.max(...vals);
      const x = i => pad + (i * (w - pad * 2)) / (points.length - 1);
      const y = v => (max === min ? h / 2 : pad + ((max - v) * (h - pad * 2)) / (max - min));
      const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const last = vals.length - 1;
      return `
        <svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-label="價格走勢">
          <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
          <circle cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="2.5" fill="currentColor"/>
        </svg>`;
    }

    const cards = routes.map(r => {
      const list = prices
        .filter(p => p.routeId === r.id)
        .sort((a, b) => Number(a.price) - Number(b.price));
      const best = list[0];
      const target = Number(r.target);
      const hit = best && Number(best.price) <= target;
      const problem = routeProblem(r);

      const past = history
        .filter(h => h.routeId === r.id)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .slice(-30);
      let trend = '';
      if (past.length >= 2) {
        const diff = past[past.length - 1].minPrice - past[past.length - 2].minPrice;
        trend = diff < 0
          ? `<span class="trend down">↓ ${money(-diff)}</span>`
          : diff > 0 ? `<span class="trend up">↑ ${money(diff)}</span>` : '<span class="trend">持平</span>';
      }

      const stopsText = p => p.stops === '' || p.stops == null ? '' : Number(p.stops) === 0 ? '直飛' : `轉機 ${p.stops} 次`;
      const dates = p => p.returnDate ? `${md(p.depart)} ~ ${md(p.returnDate)}` : `${md(p.depart)} 單程`;

      return `
        <article class="card route-card ${hit ? 'hit' : ''} ${problem ? 'stale' : ''}">
          <header class="route-head">
            <div>
              <h3>${esc(r.from)} → ${esc(r.to)} <span class="muted">${esc(r.toName || '')}</span></h3>
              <span class="muted small">${routeWhen(r)}</span>
            </div>
            <button class="icon-btn" data-remove="${esc(r.id)}" title="刪除這條航線">✕</button>
          </header>

          ${problem ? `<p class="warn small">${problem}</p>` : ''}

          ${best ? `
            <div class="price-row">
              <span class="price">${money(best.price)}</span>
              ${hit ? '<span class="tag tag-good">低於目標價</span>' : ''}
              ${trend}
            </div>
            <p class="muted small">
              目標 ${money(target)}・${esc(best.airline)}${stopsText(best) ? `・${stopsText(best)}` : ''}<br>
              ${r.mode === 'month' ? '最便宜日期 ' : ''}${dates(best)}・${timeAgo(best.fetchedAt)}更新
            </p>
            <div class="route-foot">
              ${sparkline(past)}
              ${best.link ? `<a class="small" href="${esc(best.link)}" target="_blank" rel="noopener">在 Google 航班查看 ↗</a>` : ''}
            </div>
            ${list.length > 1 ? `
              <details>
                <summary>其他 ${list.length - 1} 筆報價</summary>
                <ul class="price-list">
                  ${list.slice(1).map(p => `
                    <li><span>${esc(p.airline)}${stopsText(p) ? `・${stopsText(p)}` : ''}${r.mode === 'month' ? `・${dates(p)}` : ''}</span><span>${money(p.price)}</span></li>`).join('')}
                </ul>
              </details>` : ''}
          ` : problem ? '' : `
            <p class="muted">尚無報價，下次自動抓取後會出現在這裡。</p>
            <p class="muted small">目標 ${money(target)}</p>
          `}
        </article>`;
    }).join('');

    const lastRun = metaValue('flights.lastRun');
    const left = metaValue('flights.searchesLeft');
    const lastMessage = metaValue('flights.lastMessage');
    const status = lastRun
      ? `上次自動更新：${timeAgo(lastRun)}${left !== '' ? `・本月剩餘查詢 ${esc(left)} 次` : ''}`
      : '尚未執行過自動抓取';

    root.innerHTML = `
      ${demoBanner()}
      <div class="page-head">
        <h1>✈️ 便宜機票</h1>
        <p class="muted">共追蹤 ${routes.length} 條航線</p>
      </div>
      <p class="muted small status-line" title="${esc(lastMessage)}">${status}</p>
      ${/失敗/.test(lastMessage) ? `<p class="warn small">${esc(lastMessage)}</p>` : ''}

      <section class="grid">${cards || '<p class="muted">還沒有追蹤任何航線。</p>'}</section>

      <section class="card form-card">
        <h2>新增追蹤航線</h2>
        <div class="tabs mode-tabs">
          <button type="button" class="tab ${this.formMode === 'date' ? 'active' : ''}" data-mode="date">固定日期</button>
          <button type="button" class="tab ${this.formMode === 'month' ? 'active' : ''}" data-mode="month">彈性月份</button>
        </div>
        <p class="muted small">${this.formMode === 'date'
          ? '已經決定日期，想等價格降下來再買。'
          : '日期彈性，想知道某個月哪幾天去最便宜（可查未來 6 個月）。'}</p>

        <form id="route-form" class="form-row">
          <label>出發<input name="from" value="TPE" maxlength="3" required></label>
          <label>目的地代碼<input name="to" placeholder="如 OKA" maxlength="3" required></label>
          <label>目的地名稱<input name="toName" placeholder="如 沖繩"></label>
          ${this.formMode === 'date' ? `
            <label>出發日期<input name="departDate" type="date" min="${today}" required></label>
            <label>回程日期（單程免填）<input name="returnDate" type="date" min="${today}"></label>
          ` : `
            <label>月份<select name="month">${monthOptions}</select></label>
            <label>行程長度
              <select name="duration">
                <option value="week">一週</option>
                <option value="weekend">週末</option>
                <option value="twoweeks">兩週</option>
                <option value="oneway">單程</option>
              </select>
            </label>
          `}
          <label>目標價（NT$）<input name="target" type="number" min="0" step="100" placeholder="如 6000" required></label>
          <button class="btn" type="submit">新增</button>
        </form>
        <p class="muted small">機場代碼是 3 個英文字母，例如 TPE 桃園、TSA 松山、KHH 高雄、NRT 成田、HND 羽田、KIX 關西、ICN 仁川。
        來回票的價格是來回總價。</p>
      </section>`;

    root.querySelectorAll('[data-mode]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.formMode = btn.dataset.mode;
        this.render(root);
      }));

    root.querySelector('#route-form').addEventListener('submit', Portal.action(async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const row = {
        from: f.get('from').trim().toUpperCase(),
        to: f.get('to').trim().toUpperCase(),
        toName: f.get('toName').trim(),
        target: Number(f.get('target')),
        mode: this.formMode
      };
      if (this.formMode === 'date') {
        row.departDate = f.get('departDate');
        row.returnDate = f.get('returnDate') || '';
        if (row.returnDate && row.returnDate < row.departDate) throw new Error('回程日期不能早於出發日期');
      } else {
        row.month = f.get('month');
        row.duration = f.get('duration');
      }
      if (!/^[A-Z]{3}$/.test(row.from) || !/^[A-Z]{3}$/.test(row.to)) throw new Error('機場代碼必須是 3 個英文字母');
      await DataStore.add('routes', row);
      this.render(root);
    }));

    root.querySelectorAll('[data-remove]').forEach(btn =>
      btn.addEventListener('click', Portal.action(async () => {
        if (!confirm('確定不再追蹤這條航線？（價格紀錄也會一併刪除）')) return;
        await DataStore.remove('routes', btn.dataset.remove);
        this.render(root);
      })));
  }
});
