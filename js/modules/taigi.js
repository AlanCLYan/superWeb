// =============================================
// 功能模組：台語推薦用字 700 字複習
//   資料：教育部〈臺灣台語推薦用字 700 字表〉（js/data/taigi700.json）
//   規則：700 字隨機出題；同一字詞「連續」答對 5 次就熟記、不再出現；答錯一次，連續答對次數歸零
//   進度存在試算表 taigi 工作表，手機、電腦同步
//
//   #/taigi        練習
//   #/taigi/list   字表與進度
// =============================================
(() => {
  const { esc } = Portal;
  const DATA_URL = 'js/data/taigi700.json?v=20261022';
  const GOAL = 5;            // 連續答對幾次算熟記
  const RECENT = 8;          // 最近出過的題目不會馬上再出
  const MODE_KEY = 'superWeb-taigi-mode';

  // 「尾蝶（仔）/（尾）蝶仔」→ 尾蝶仔、尾蝶、蝶仔（括號內可有可無，斜線分隔不同寫法）
  function candidates(word) {
    const out = [];
    for (const alt of String(word).split(/[／/]/)) {
      const groups = alt.match(/（[^）]*）|\([^)]*\)/g) || [];
      const parts = alt.split(/（[^）]*）|\([^)]*\)/);
      for (let mask = 0; mask < (1 << groups.length); mask++) {
        let s = parts[0];
        groups.forEach((g, i) => { s += ((mask >> i) & 1 ? g.slice(1, -1) : '') + parts[i + 1]; });
        s = s.trim();
        if (s && !out.includes(s)) out.push(s);
      }
    }
    return out.sort((a, b) => [...b].length - [...a].length);
  }

  // 從用例中挑一句含有建議用字的句子，把用字挖空
  function makeQuestion(entry) {
    const cands = candidates(entry.word);
    const segs = entry.ex.split('、').map(s => s.replace(/[（）()]/g, '').trim()).filter(Boolean)
      .sort((a, b) => b.length - a.length);
    for (const seg of segs) {
      const hit = cands.find(c => seg.includes(c));
      if (hit) {
        const blank = '＿'.repeat([...hit].length);
        return { entry, answer: hit, cands, sentence: seg.split(hit).join(`\u0000${blank}\u0000`) };
      }
    }
    return { entry, answer: cands[0], cands, sentence: '' };   // 沒有可挖空的句子時，只看華語作答
  }

  const normalize = s => String(s).replace(/[\s（）()／/]/g, '');
  const statusOf = p => !p ? 'new' : p.masteredAt ? 'done' : 'learning';

  Portal.register({
    id: 'taigi',
    name: '台語用字',
    icon: '🗣️',
    description: '教育部台語推薦用字 700 字，看華語與用例填入台語用字，連續答對 5 次就熟記。',

    entries: null,      // 700 字資料
    progress: null,     // Map：編號 → 進度
    loadedAt: 0,
    current: null,      // 目前題目
    answered: null,     // 本題作答結果
    recent: [],
    session: { total: 0, right: 0 },
    listFilter: { q: '', status: 'all' },
    queue: Promise.resolve(),

    async load(force = false) {
      if (!this.entries) {
        const res = await fetch(DATA_URL);
        if (!res.ok) throw new Error('讀取 700 字資料失敗');
        this.entries = await res.json();
      }
      if (force || !this.progress || Date.now() - this.loadedAt > 60000) {
        const rows = await DataStore.get('taigi').catch(() => []);
        this.progress = new Map(rows.map(r => [String(r.id).padStart(3, '0'), r]));
        this.loadedAt = Date.now();
      }
    },

    save(row) {
      const copy = { ...row };
      this.queue = this.queue.then(() => DataStore.update('taigi', copy)).catch(err => alert(`進度同步失敗：${err.message}`));
    },

    stats() {
      let done = 0, learning = 0;
      for (const e of this.entries) {
        const s = statusOf(this.progress.get(e.no));
        if (s === 'done') done++; else if (s === 'learning') learning++;
      }
      return { done, learning, fresh: this.entries.length - done - learning, total: this.entries.length };
    },

    async summary() {
      await this.load();
      const s = this.stats();
      return `已熟記 <strong class="good">${s.done}</strong> / ${s.total}・學習中 ${s.learning}`;
    },

    getMode() {
      try { return localStorage.getItem(MODE_KEY) || 'type'; } catch { return 'type'; }
    },
    setMode(m) {
      try { localStorage.setItem(MODE_KEY, m); } catch { /* 無法儲存時忽略 */ }
    },

    async render(root) {
      const [, view = ''] = location.hash.replace(/^#\/?/, '').split('/');
      await this.load();
      const tab = (href, label, key) => `<a class="tab ${view === key ? 'active' : ''}" href="#/taigi${href}">${label}</a>`;
      root.innerHTML = `
        ${Portal.demoBanner()}
        <div class="page-head"><h1>🗣️ 台語用字</h1></div>
        <nav class="tabs en-tabs" aria-label="台語用字分頁">
          ${tab('', '練習', '')}
          ${tab('/list', '字表', 'list')}
        </nav>
        <div id="tg-stats"></div>
        <div id="tg-view"></div>`;
      this.renderStats(root);
      const box = root.querySelector('#tg-view');
      if (view === 'list') return this.renderList(box, root);
      return this.renderPractice(box, root);
    },

    renderStats(root) {
      const s = this.stats();
      const el = root.querySelector('#tg-stats');
      if (!el) return;
      const pct = n => `${(n / s.total) * 100}%`;
      el.innerHTML = `
        <div class="tg-bar" role="img" aria-label="已熟記 ${s.done}、學習中 ${s.learning}、未出現 ${s.fresh}">
          <span class="done" style="width:${pct(s.done)}"></span><span class="learning" style="width:${pct(s.learning)}"></span>
        </div>
        <p class="tg-legend small">
          <span><i class="done"></i>已熟記 ${s.done}</span>
          <span><i class="learning"></i>學習中 ${s.learning}</span>
          <span><i></i>未出現 ${s.fresh}</span>
          ${this.session.total ? `<span class="muted">本次 ${this.session.right} / ${this.session.total} 題答對</span>` : ''}
        </p>`;
    },

    nextQuestion() {
      const pool = this.entries.filter(e => statusOf(this.progress.get(e.no)) !== 'done');
      if (!pool.length) return null;
      const fresh = pool.filter(e => !this.recent.includes(e.no));
      const list = fresh.length ? fresh : pool;
      const entry = list[Math.floor(Math.random() * list.length)];
      this.recent = [entry.no, ...this.recent].slice(0, RECENT);
      const q = makeQuestion(entry);
      // 選擇題選項：優先挑字數相同的其他用字
      const len = [...q.answer].length;
      const others = this.entries.filter(e => e.no !== entry.no && !candidates(e.word).includes(q.answer));
      const same = others.filter(e => [...candidates(e.word)[0]].length === len);
      const pick = (arr, n) => { const a = [...arr]; const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]); return out; };
      const distractors = pick(same.length >= 3 ? same : others, 3).map(e => candidates(e.word)[0]);
      q.options = pick([q.answer, ...distractors], 4);
      return q;
    },

    renderPractice(box, root) {
      if (!this.current) this.current = this.nextQuestion();
      const q = this.current;
      if (!q) {
        box.innerHTML = `
          <section class="card en-empty">
            <h2>700 字全部熟記了 🎉</h2>
            <p class="muted">可以到「字表」把想再練習的字重新加入。</p>
          </section>`;
        return;
      }
      const e = q.entry;
      const a = this.answered;
      const mode = this.getMode();
      const p = this.progress.get(e.no) || { streak: 0 };
      const streak = Number(p.streak) || 0;
      const dots = n => `<span class="tg-dots" aria-label="連續答對 ${n} / ${GOAL}">${Array.from({ length: GOAL }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
      const sentenceHtml = q.sentence
        ? q.sentence.split('\u0000').map((part, i) => i % 2 ? `<span class="tg-blank${a ? (a.ok ? ' ok' : ' no') : ''}">${a ? esc(q.answer) : esc(part)}</span>` : esc(part)).join('')
        : '<span class="muted">（這個字詞的用例無法挖空，請依華語填入台語用字）</span>';

      box.innerHTML = `
        <section class="card tg-card">
          <div class="tg-mode">
            <div class="tabs">
              <button class="tab ${mode === 'type' ? 'active' : ''}" data-mode="type" ${a ? 'disabled' : ''}>輸入作答</button>
              <button class="tab ${mode === 'choice' ? 'active' : ''}" data-mode="choice" ${a ? 'disabled' : ''}>選擇作答</button>
            </div>
            ${dots(a ? (a.ok ? Math.min(streak, GOAL) : 0) : streak)}
          </div>

          <dl class="tg-q">
            <dt>對應華語</dt><dd class="tg-zh">${esc(e.zh)}</dd>
            <dt>題目</dt><dd class="tg-sentence">${sentenceHtml}</dd>
          </dl>

          ${!a ? (mode === 'choice' ? `
            <div class="quiz-options tg-options">
              ${q.options.map(o => `<button class="quiz-opt" data-opt="${esc(o)}">${esc(o)}</button>`).join('')}
            </div>
            <button class="link-btn small" id="giveup">不會，看答案</button>` : `
            <form id="tg-form" class="spell-row">
              <input name="answer" autocomplete="off" placeholder="填入台語用字（${[...q.answer].length} 個字）">
              <button class="btn" type="submit">確認</button>
            </form>
            <button class="link-btn small" id="giveup">不會，看答案</button>`) : `
            ${mode === 'choice' ? `
              <div class="quiz-options tg-options">
                ${q.options.map(o => `<button class="quiz-opt ${o === q.answer ? 'right' : o === a.choice ? 'wrong' : 'dim'}" disabled>${esc(o)}</button>`).join('')}
              </div>` : ''}
            <div class="tg-result ${a.ok ? 'ok' : 'no'}">
              <p class="tg-verdict">${a.ok
                ? (a.mastered ? `答對了！已連續答對 ${GOAL} 次，這個字熟記了，之後不會再出現。` : `答對了！連續答對 ${a.streak} / ${GOAL} 次`)
                : `${a.choice ? `你的答案「${esc(a.choice)}」不對。` : ''}連續答對次數歸零。`}</p>
              <dl class="tg-answer">
                <dt>建議用字</dt><dd class="tg-word">${esc(e.word)}</dd>
                <dt>音讀</dt><dd class="tg-pron" lang="nan-Latn-TW">${esc(e.pron)}${e.alt ? `<span class="muted small">　又音 ${esc(e.alt)}</span>` : ''}</dd>
                <dt>編號</dt><dd>${esc(e.no)}</dd>
                <dt>用例</dt><dd>${esc(e.ex)}</dd>
                ${e.var ? `<dt>異用字</dt><dd>${esc(e.var)}</dd>` : ''}
              </dl>
            </div>
            <button class="btn btn-big" id="next">下一題</button>`}
        </section>
        <p class="muted small credit">資料來源：教育部〈臺灣台語推薦用字 700 字表〉（113 年 8 月修正）</p>`;

      const answer = (ok, choice) => {
        const row = this.progress.get(e.no) || { id: e.no, streak: 0, correct: 0, wrong: 0, lastAt: '', masteredAt: '' };
        row.id = e.no;
        row.streak = ok ? (Number(row.streak) || 0) + 1 : 0;
        row.correct = (Number(row.correct) || 0) + (ok ? 1 : 0);
        row.wrong = (Number(row.wrong) || 0) + (ok ? 0 : 1);
        row.lastAt = new Date().toISOString();
        const mastered = ok && row.streak >= GOAL;
        if (mastered) row.masteredAt = row.lastAt;
        this.progress.set(e.no, row);
        this.save(row);
        this.session.total++;
        if (ok) this.session.right++;
        this.answered = { ok, choice, streak: row.streak, mastered };
        this.renderStats(root);
        this.renderPractice(box, root);
      };

      box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { this.setMode(b.dataset.mode); this.renderPractice(box, root); });
      box.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => answer(b.dataset.opt === q.answer, b.dataset.opt));
      const form = box.querySelector('#tg-form');
      if (form) {
        form.answer.focus();
        form.onsubmit = ev => {
          ev.preventDefault();
          const v = normalize(form.answer.value);
          if (!v) return form.answer.focus();
          // 要填的是空格裡的那個寫法（例如「敏豆仔」；輸入「敏豆（仔）」也算對）
          const ok = v === normalize(q.answer);
          answer(ok, form.answer.value.trim());
        };
      }
      const giveup = box.querySelector('#giveup');
      if (giveup) giveup.onclick = () => answer(false, '');
      const next = box.querySelector('#next');
      if (next) {
        next.focus();
        next.onclick = () => { this.current = this.nextQuestion(); this.answered = null; this.renderPractice(box, root); };
      }
    },

    renderList(box, root) {
      const f = this.listFilter;
      const q = f.q.trim().toLowerCase();
      const rows = this.entries.filter(e => {
        const p = this.progress.get(e.no);
        const s = statusOf(p);
        if (f.status === 'done' && s !== 'done') return false;
        if (f.status === 'learning' && s !== 'learning') return false;
        if (f.status === 'new' && s !== 'new') return false;
        if (f.status === 'wrong' && !(Number(p?.wrong) > 0)) return false;
        return !q || `${e.no} ${e.word} ${e.pron} ${e.alt} ${e.zh} ${e.ex}`.toLowerCase().includes(q);
      });
      const shown = rows.slice(0, f.limit || 100);

      box.innerHTML = `
        <div class="toolbar">
          <input id="tq" class="search" type="search" placeholder="搜尋用字、華語、拼音或編號…" value="${esc(f.q)}">
          <select id="ts">
            ${[['all', '全部'], ['learning', '學習中'], ['new', '未出現'], ['done', '已熟記'], ['wrong', '答錯過']].map(([v, l]) =>
              `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span class="muted small">${rows.length} 個</span>
        </div>
        <ul class="tg-list">
          ${shown.map(e => {
            const p = this.progress.get(e.no);
            const s = statusOf(p);
            const streak = Number(p?.streak) || 0;
            return `
              <li class="tg-item ${s}">
                <span class="tg-no">${esc(e.no)}</span>
                <div class="tg-main">
                  <p><strong class="tg-item-word">${esc(e.word)}</strong> <span class="muted" lang="nan-Latn-TW">${esc(e.pron)}</span></p>
                  <p class="small">${esc(e.zh)}<span class="muted">　${esc(e.ex)}</span></p>
                </div>
                <div class="tg-side">
                  ${s === 'done' ? `<span class="good small">已熟記</span><button class="link-btn small" data-reset="${esc(e.no)}">重新練習</button>`
                    : s === 'learning' ? `<span class="tg-dots">${Array.from({ length: GOAL }, (_, i) => `<i class="${i < streak ? 'on' : ''}"></i>`).join('')}</span><span class="muted small">錯 ${Number(p.wrong) || 0}</span>`
                    : '<span class="muted small">未出現</span>'}
                </div>
              </li>`;
          }).join('') || '<li class="muted">沒有符合條件的字詞。</li>'}
        </ul>
        ${rows.length > shown.length ? `<div class="more"><button class="btn btn-ghost" id="tmore">顯示更多（還有 ${rows.length - shown.length} 個）</button></div>` : ''}`;

      let timer;
      box.querySelector('#tq').addEventListener('input', ev => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          f.q = ev.target.value; f.limit = 100;
          this.renderList(box, root);
          const again = box.querySelector('#tq');
          again.focus(); again.setSelectionRange(again.value.length, again.value.length);
        }, 250);
      });
      box.querySelector('#ts').onchange = ev => { f.status = ev.target.value; f.limit = 100; this.renderList(box, root); };
      const more = box.querySelector('#tmore');
      if (more) more.onclick = () => { f.limit = (f.limit || 100) + 100; this.renderList(box, root); };
      box.querySelectorAll('[data-reset]').forEach(b => b.onclick = Portal.action(async () => {
        const row = this.progress.get(b.dataset.reset);
        Object.assign(row, { streak: 0, masteredAt: '' });
        await DataStore.update('taigi', row);
        this.renderStats(root);
        this.renderList(box, root);
      }));
    }
  });
})();
