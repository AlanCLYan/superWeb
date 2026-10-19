// =============================================
// 功能模組：英文閱讀與單字庫
//   #/english            今日文章與文章列表
//   #/english/read/<id>  閱讀文章：點單字查意思、加入單字庫
//   #/english/vocab      單字庫：搜尋、手動新增、編輯
//   #/english/review     字卡複習（間隔複習：記得的字隔越久才再出現）
//   #/english/quiz       測驗（選中文、選英文、拼字）
//
// 查字典：Free Dictionary API（英英解釋、音標）＋ MyMemory（中文翻譯），免費、不需金鑰
// 發音：瀏覽器內建的語音（iPhone、Android、電腦都支援）
// =============================================
(() => {
  const { esc } = Portal;

  // 複習間隔（天）：box 0～6，記得一次 box +1
  const INTERVALS = [0, 1, 2, 4, 7, 15, 30];
  const MAX_BOX = 6;
  const CACHE_MS = 60000;

  const todayTW = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
  const addDays = (ymd, n) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  };
  const dateOf = iso => {
    const t = new Date(iso);
    return isNaN(t) ? '' : t.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' });
  };
  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const isDue = v => !v.nextReview || v.nextReview <= todayTW();
  const boxOf = v => Number(v.box) || 0;

  // ---------- 發音、字典、翻譯 ----------
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // 簡單的字尾還原：running → run、studies → study、played → play
  function stems(w) {
    const out = [];
    const add = s => { if (s && s.length > 1 && s !== w && !out.includes(s)) out.push(s); };
    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) add(w.slice(0, -2));
    if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
    if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (w.at(-3) === w.at(-4)) add(w.slice(0, -3)); }
    if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (w.at(-4) === w.at(-5)) add(w.slice(0, -4)); }
    if (w.endsWith('ly')) add(w.slice(0, -2));
    if (w.endsWith('er')) add(w.slice(0, -2));
    if (w.endsWith('est')) add(w.slice(0, -3));
    return out;
  }

  async function lookup(word) {
    for (const w of [word, ...stems(word)]) {
      try {
        const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
        if (!res.ok) continue;
        const data = await res.json();
        const entry = data[0];
        const phonetic = entry.phonetic || (entry.phonetics || []).map(p => p.text).find(Boolean) || '';
        const meanings = (entry.meanings || []).slice(0, 3).map(m => ({
          pos: m.partOfSpeech,
          defs: (m.definitions || []).slice(0, 2).map(d => d.definition)
        }));
        return { headword: entry.word || w, phonetic, meanings };
      } catch { /* 換下一個字形再試 */ }
    }
    return null;
  }

  async function translate(text) {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=en|zh-TW`);
    const data = await res.json();
    if (Number(data.responseStatus) !== 200) throw new Error(data.responseDetails || '翻譯服務暫時無法使用');
    return String(data.responseData?.translatedText || '').trim();
  }

  const POS = { noun: '名詞', verb: '動詞', adjective: '形容詞', adverb: '副詞', pronoun: '代名詞', preposition: '介系詞', conjunction: '連接詞', interjection: '感嘆詞' };
  const posLabel = p => POS[p] || p || '';
  const defText = info => info ? info.meanings.map(m => `(${m.pos}) ${m.defs[0] || ''}`).join('；') : '';

  // ---------- 文章斷句、斷字 ----------
  const WORD_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  function splitSentences(text) {
    return text.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)\s*/g) || [text];
  }

  Portal.register({
    id: 'english',
    name: '英文閱讀',
    icon: '📖',
    description: '每天一篇英文文章，點單字查意思、存進單字庫，再用字卡複習和測驗。',

    cache: null,          // { at, articles, vocab, meta }
    review: null,         // 複習進度
    quiz: null,           // 測驗進度
    queue: Promise.resolve(),

    async load(force = false) {
      if (!force && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
      const [articles, vocab, meta] = await Promise.all([
        DataStore.get('articles').catch(() => []),
        DataStore.get('vocab').catch(() => []),
        DataStore.get('meta').catch(() => [])
      ]);
      articles.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)));
      this.cache = { at: Date.now(), articles, vocab, meta };
      return this.cache;
    },

    // 單字數或待複習數改變後，更新分頁上的數字
    refreshTabs() {
      const v = document.querySelector('[data-count="vocab"]');
      const d = document.querySelector('[data-count="due"]');
      if (v) v.textContent = this.cache.vocab.length;
      if (d) {
        const due = this.cache.vocab.filter(isDue).length;
        d.innerHTML = due ? ` <span class="badge">${due}</span>` : '';
      }
    },

    // 背景依序寫入，不卡住畫面
    save(task) {
      this.queue = this.queue.then(task).catch(err => alert(`同步失敗：${err.message}`));
      return this.queue;
    },

    async summary() {
      const { articles, vocab } = await this.load();
      const latest = articles[0];
      const due = vocab.filter(isDue).length;
      const parts = [];
      parts.push(latest ? `今日文章：${esc(latest.title.length > 26 ? latest.title.slice(0, 26) + '…' : latest.title)}` : '還沒有文章');
      parts.push(due ? `<strong class="good">待複習 ${due} 個單字</strong>` : `單字庫 ${vocab.length} 個`);
      return parts.join('<br>');
    },

    async render(root) {
      const [, view = '', arg = ''] = location.hash.replace(/^#\/?/, '').split('/');
      const data = await this.load();
      const due = data.vocab.filter(isDue).length;
      const tab = (href, label, key) =>
        `<a class="tab ${view === key || (key === '' && view === 'read') ? 'active' : ''}" href="#/english${href}">${label}</a>`;

      root.innerHTML = `
        ${Portal.demoBanner()}
        <div class="page-head">
          <h1>📖 英文閱讀</h1>
        </div>
        <nav class="tabs en-tabs" aria-label="英文閱讀分頁">
          ${tab('', '閱讀', '')}
          ${tab('/vocab', `單字庫 <span data-count="vocab">${data.vocab.length}</span>`, 'vocab')}
          ${tab('/review', `複習<span data-count="due">${due ? ` <span class="badge">${due}</span>` : ''}</span>`, 'review')}
          ${tab('/quiz', '測驗', 'quiz')}
        </nav>
        <div id="en-view"></div>`;
      const box = root.querySelector('#en-view');

      // 重新進入分頁時，已完成的複習／測驗重新開始
      if (view === 'review' && this.review && this.review.i >= this.review.list.length) this.review = null;
      if (view === 'quiz' && this.quiz && this.quiz.i >= this.quiz.qs.length) this.quiz = null;
      if (view !== 'review') document.onkeydown = null;

      if (view === 'read' && arg) return this.renderArticle(box, arg);
      if (view === 'vocab') return this.renderVocab(box);
      if (view === 'review') return this.renderReview(box);
      if (view === 'quiz') return this.renderQuiz(box);
      return this.renderList(box);
    },

    // =============== 文章列表 ===============
    renderList(box) {
      const { articles, meta } = this.cache;
      const lastRun = (meta.find(m => m.id === 'english.lastRun') || {});
      if (!articles.length) {
        box.innerHTML = `
          <section class="card en-empty">
            <h2>還沒有文章</h2>
            <p class="muted">每天早上 06:37 會自動抓一篇新文章。想馬上開始，可以到 GitHub 的 Actions 手動執行「抓取每日英文文章」。</p>
            ${lastRun.value ? `<p class="muted small">上次執行：${esc(lastRun.value)}</p>` : ''}
          </section>`;
        return;
      }
      const [latest, ...rest] = articles;
      const minutes = a => Math.max(1, Math.round(Number(a.words) / 200));
      box.innerHTML = `
        <a class="card en-today" href="#/english/read/${esc(latest.id)}">
          <span class="muted small">${dateOf(latest.fetchedAt)} 的文章${latest.readAt ? '・已讀完' : ''}</span>
          <h2>${esc(latest.title)}</h2>
          <p class="muted small">${esc(latest.author || '')}${latest.author ? '・' : ''}${esc(latest.source || '')}</p>
          <p class="en-meta"><span>${Number(latest.words) || '?'} 字</span><span>約 ${minutes(latest)} 分鐘</span></p>
          <span class="btn">${latest.readAt ? '再讀一次' : '開始閱讀'}</span>
        </a>
        ${rest.length ? `
          <h2 class="en-sub">過去的文章</h2>
          <ul class="en-list">
            ${rest.map(a => `
              <li><a href="#/english/read/${esc(a.id)}">
                <span class="en-list-title">${esc(a.title)}</span>
                <span class="muted small">${dateOf(a.fetchedAt)}・${Number(a.words) || '?'} 字${a.readAt ? '・<span class="good">已讀</span>' : ''}</span>
              </a></li>`).join('')}
          </ul>` : ''}
        <p class="muted small credit">文章來源：The Conversation，依 CC BY-ND 4.0 授權轉載。文章保留 30 天，單字庫會一直保留。</p>`;
    },

    // =============== 閱讀文章 ===============
    renderArticle(box, id) {
      const article = this.cache.articles.find(a => a.id === id);
      if (!article) {
        box.innerHTML = `<p class="muted">找不到這篇文章，可能已超過保留期限。<a href="#/english">回到文章列表</a></p>`;
        return;
      }
      const saved = () => new Set(this.cache.vocab.map(v => String(v.word).toLowerCase()));
      const isSaved = (w, set) => set.has(w) || stems(w).some(s => set.has(s));
      const sentences = [];   // 每個句子的原文，給「例句」與「翻譯這句」使用

      const renderText = (text, set) => splitSentences(text).map(sentence => {
        const si = sentences.push(sentence.trim()) - 1;
        let html = '', last = 0;
        for (const m of sentence.matchAll(WORD_RE)) {
          const lower = m[0].toLowerCase();
          html += esc(sentence.slice(last, m.index));
          html += `<span class="w${isSaved(lower, set) ? ' saved' : ''}" data-w="${esc(lower)}" data-s="${si}">${esc(m[0])}</span>`;
          last = m.index + m[0].length;
        }
        return html + esc(sentence.slice(last));
      }).join('');

      const set = saved();
      const body = String(article.body || '').split(/\n{2,}/).map(p =>
        p.startsWith('## ') ? `<h3>${renderText(p.slice(3), set)}</h3>` : `<p>${renderText(p, set)}</p>`).join('');
      const published = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' }) : '';

      box.innerHTML = `
        <article class="en-article">
          <a class="small" href="#/english">← 文章列表</a>
          <h2 class="en-title">${esc(article.title)}</h2>
          <p class="muted small">${esc(article.author || '')}${published ? `・${published}` : ''}・${Number(article.words) || '?'} 字</p>
          <p class="en-hint small">點任何單字可以查意思並加入單字庫，已在單字庫的字會加上底線。</p>
          <div class="en-body" lang="en">${body}</div>
          <footer class="en-credit small">
            本文作者為 ${esc(article.author || '原作者')}，原刊登於
            <a href="${esc(article.url)}" target="_blank" rel="noopener">The Conversation</a>，
            依 <a href="https://creativecommons.org/licenses/by-nd/4.0/" target="_blank" rel="noopener">CC BY-ND 4.0</a> 授權轉載，內容未經修改（圖片未收錄）。
            ${article.counter ? `<img src="${esc(article.counter)}" alt="" width="1" height="1" style="border:0;width:1px;height:1px" referrerpolicy="no-referrer-when-downgrade">` : ''}
          </footer>
          <div class="en-done">
            <button class="btn" id="read-done" ${article.readAt ? 'disabled' : ''}>${article.readAt ? '已讀完 ✓' : '讀完了'}</button>
            <a class="btn btn-ghost" href="#/english/review">去複習單字</a>
          </div>
        </article>
        <div class="en-sheet" id="sheet" hidden></div>`;

      const sheet = box.querySelector('#sheet');
      let current = null;   // 目前查詢的資料

      const closeSheet = () => {
        sheet.hidden = true;
        box.querySelectorAll('.w.active').forEach(el => el.classList.remove('active'));
      };

      const markSaved = word => {
        const s = new Set([word]);
        box.querySelectorAll('.w').forEach(el => { if (isSaved(el.dataset.w, s)) el.classList.add('saved'); });
      };

      const showSheet = async (el) => {
        box.querySelectorAll('.w.active').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        const word = el.dataset.w;
        const sentence = sentences[Number(el.dataset.s)] || '';
        const existing = this.cache.vocab.find(v => {
          const lw = String(v.word).toLowerCase();
          return lw === word || stems(word).includes(lw);
        });
        current = { word, sentence, info: null, existing };
        const highlighted = esc(sentence).replace(new RegExp(`\\b(${word.replace(/[^a-z'’-]/gi, '')})\\b`, 'i'), '<mark>$1</mark>');

        sheet.hidden = false;
        sheet.innerHTML = `
          <div class="sheet-head">
            <div>
              <strong class="sheet-word">${esc(existing ? existing.word : word)}</strong>
              <span class="muted" id="sh-phon">${existing?.phonetic ? esc(existing.phonetic) : ''}</span>
              <button class="icon-btn" id="sh-speak" title="發音">🔊</button>
            </div>
            <button class="icon-btn" id="sh-close" aria-label="關閉">✕</button>
          </div>
          <div id="sh-defs" class="sheet-defs muted small">${existing ? esc(existing.definition || '') : '查詢中…'}</div>
          <label class="sheet-label">中文意思
            <input id="sh-meaning" value="${esc(existing?.meaning || '')}" placeholder="${existing ? '' : '翻譯中…'}">
          </label>
          <div class="sheet-sentence">
            <p>${highlighted}</p>
            <button class="link-btn small" id="sh-trans">翻譯這句</button>
            <p class="muted small" id="sh-trans-out"></p>
          </div>
          <div class="sheet-actions">
            ${existing
              ? `<span class="good small">已在單字庫</span><button class="btn btn-ghost" id="sh-update">更新中文意思</button>`
              : `<button class="btn" id="sh-add">加入單字庫</button>`}
          </div>`;

        sheet.querySelector('#sh-close').onclick = closeSheet;
        sheet.querySelector('#sh-speak').onclick = () => speak(existing ? existing.word : (current.info?.headword || word));
        sheet.querySelector('#sh-trans').onclick = async e => {
          e.target.disabled = true;
          const out = sheet.querySelector('#sh-trans-out');
          out.textContent = '翻譯中…';
          try { out.textContent = await translate(sentence); } catch (err) { out.textContent = err.message; }
        };

        const addBtn = sheet.querySelector('#sh-add');
        if (addBtn) addBtn.onclick = Portal.action(async () => {
          const info = current.info;
          const headword = (info?.headword || word).toLowerCase();
          if (this.cache.vocab.some(v => String(v.word).toLowerCase() === headword)) throw new Error(`「${headword}」已經在單字庫裡`);
          addBtn.disabled = true;
          addBtn.textContent = '儲存中…';
          const row = await DataStore.add('vocab', {
            word: headword,
            meaning: sheet.querySelector('#sh-meaning').value.trim(),
            definition: defText(info),
            phonetic: info?.phonetic || '',
            pos: info ? info.meanings.map(m => m.pos).join(', ') : '',
            example: sentence,
            source: article.title,
            sourceUrl: article.url,
            createdAt: new Date().toISOString(),
            box: 0, nextReview: todayTW(), correct: 0, wrong: 0, lastReviewed: ''
          });
          this.cache.vocab.push(row);
          this.refreshTabs();
          markSaved(headword);
          markSaved(word);
          sheet.querySelector('.sheet-actions').innerHTML = '<span class="good">已加入單字庫 ✓</span>';
          setTimeout(closeSheet, 900);
        });

        const upBtn = sheet.querySelector('#sh-update');
        if (upBtn) upBtn.onclick = Portal.action(async () => {
          existing.meaning = sheet.querySelector('#sh-meaning').value.trim();
          upBtn.disabled = true;
          await DataStore.update('vocab', existing);
          sheet.querySelector('.sheet-actions').innerHTML = '<span class="good">已更新 ✓</span>';
        });

        if (existing) return;
        // 同時查字典與中文翻譯
        const [info, zh] = await Promise.all([lookup(word), translate(word).catch(() => '')]);
        if (current.word !== word || sheet.hidden) return;   // 使用者已經點了別的字
        current.info = info;
        if (info) {
          sheet.querySelector('.sheet-word').textContent = info.headword;
          sheet.querySelector('#sh-phon').textContent = info.phonetic;
          sheet.querySelector('#sh-defs').innerHTML = info.meanings.map(m =>
            `<p><span class="tag">${esc(posLabel(m.pos))}</span> ${esc(m.defs.join(' / '))}</p>`).join('');
        } else {
          sheet.querySelector('#sh-defs').textContent = '字典裡查不到這個字，可以自己填中文意思再加入。';
        }
        const input = sheet.querySelector('#sh-meaning');
        input.placeholder = '自己填寫中文意思';
        if (!input.value && zh && zh.toLowerCase() !== word) input.value = zh;
      };

      box.querySelector('.en-body').addEventListener('click', e => {
        const el = e.target.closest('.w');
        if (el) showSheet(el);
      });
      document.addEventListener('keydown', function onKey(e) {
        if (!document.body.contains(sheet)) return document.removeEventListener('keydown', onKey);
        if (e.key === 'Escape') closeSheet();
      });

      const doneBtn = box.querySelector('#read-done');
      doneBtn.onclick = Portal.action(async () => {
        doneBtn.disabled = true;
        article.readAt = new Date().toISOString();
        await DataStore.update('articles', article);
        doneBtn.textContent = '已讀完 ✓';
      });
    },

    // =============== 單字庫 ===============
    vocabFilter: { q: '', status: 'all' },

    renderVocab(box) {
      const f = this.vocabFilter;
      const q = f.q.trim().toLowerCase();
      const list = this.cache.vocab
        .filter(v => !q || `${v.word} ${v.meaning}`.toLowerCase().includes(q))
        .filter(v => f.status === 'all'
          || (f.status === 'due' && isDue(v))
          || (f.status === 'learning' && boxOf(v) < 4)
          || (f.status === 'known' && boxOf(v) >= 4))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

      const dots = v => `<span class="dots" title="熟練度 ${boxOf(v)}/${MAX_BOX}">${
        Array.from({ length: MAX_BOX }, (_, i) => `<i class="${i < boxOf(v) ? 'on' : ''}"></i>`).join('')}</span>`;

      box.innerHTML = `
        <section class="card form-card">
          <h2>新增單字</h2>
          <form id="add-word" class="form-row">
            <label>英文<input name="word" required autocomplete="off" autocapitalize="none" placeholder="如 resilient"></label>
            <label>中文意思<input name="meaning" placeholder="可留空，按「查詢」自動帶入"></label>
            <label class="grow">例句或備註<input name="example" placeholder="在哪裡看到、怎麼用"></label>
            <button class="btn btn-ghost" type="button" id="auto">查詢</button>
            <button class="btn" type="submit">加入</button>
          </form>
          <p class="muted small" id="auto-out"></p>
        </section>

        <div class="toolbar">
          <input id="vq" class="search" type="search" placeholder="搜尋單字或中文…" value="${esc(f.q)}">
          <select id="vs">
            ${[['all', '全部'], ['due', '今天要複習'], ['learning', '學習中'], ['known', '已熟記']].map(([v, l]) =>
              `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <span class="muted small">${list.length} 個</span>
        </div>

        <ul class="vocab-list">
          ${list.map(v => `
            <li class="vocab-item">
              <div class="vocab-main">
                <div class="vocab-head">
                  <strong class="vocab-word" lang="en">${esc(v.word)}</strong>
                  <span class="muted small">${esc(v.phonetic || '')}</span>
                  <button class="icon-btn" data-speak="${esc(v.word)}" title="發音">🔊</button>
                  ${dots(v)}
                </div>
                <p class="vocab-meaning">${esc(v.meaning || '（尚未填寫中文）')}</p>
                ${v.definition ? `<p class="muted small" lang="en">${esc(v.definition)}</p>` : ''}
                ${v.example ? `<p class="vocab-example small" lang="en">${esc(v.example)}</p>` : ''}
                <p class="muted small">${v.sourceUrl ? `<a href="${esc(v.sourceUrl)}" target="_blank" rel="noopener">${esc(v.source || '文章')}</a>` : esc(v.source || '生活')}・${dateOf(v.createdAt)}</p>
              </div>
              <div class="vocab-actions">
                <button class="icon-btn" data-edit="${esc(v.id)}" title="編輯中文意思">✏️</button>
                <button class="icon-btn" data-del="${esc(v.id)}" title="刪除">✕</button>
              </div>
            </li>`).join('') || `<li class="muted">${this.cache.vocab.length ? '沒有符合條件的單字。' : '單字庫還是空的。閱讀文章時點單字就能加入，也可以在上面手動新增。'}</li>`}
        </ul>`;

      const form = box.querySelector('#add-word');
      const out = box.querySelector('#auto-out');
      let info = null;

      box.querySelector('#auto').onclick = async () => {
        const word = form.word.value.trim().toLowerCase();
        if (!word) return form.word.focus();
        out.textContent = '查詢中…';
        const [res, zh] = await Promise.all([lookup(word), translate(word).catch(() => '')]);
        info = res;
        if (!form.meaning.value && zh && zh.toLowerCase() !== word) form.meaning.value = zh;
        out.textContent = res ? `${res.headword} ${res.phonetic}　${defText(res)}` : '字典裡查不到這個字，可以直接填中文意思加入。';
      };

      form.onsubmit = Portal.action(async e => {
        e.preventDefault();
        const word = form.word.value.trim().toLowerCase();
        if (this.cache.vocab.some(v => String(v.word).toLowerCase() === word)) throw new Error(`「${word}」已經在單字庫裡`);
        const row = await DataStore.add('vocab', {
          word,
          meaning: form.meaning.value.trim(),
          definition: info && info.headword.toLowerCase() === word ? defText(info) : '',
          phonetic: info?.phonetic || '',
          pos: info ? info.meanings.map(m => m.pos).join(', ') : '',
          example: form.example.value.trim(),
          source: '生活', sourceUrl: '',
          createdAt: new Date().toISOString(),
          box: 0, nextReview: todayTW(), correct: 0, wrong: 0, lastReviewed: ''
        });
        this.cache.vocab.push(row);
        this.refreshTabs();
        this.renderVocab(box);
      });

      let timer;
      box.querySelector('#vq').addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          f.q = e.target.value;
          this.renderVocab(box);
          const again = box.querySelector('#vq');
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }, 250);
      });
      box.querySelector('#vs').onchange = e => { f.status = e.target.value; this.renderVocab(box); };

      box.querySelectorAll('[data-speak]').forEach(b => b.onclick = () => speak(b.dataset.speak));
      box.querySelectorAll('[data-edit]').forEach(b => b.onclick = Portal.action(async () => {
        const v = this.cache.vocab.find(x => x.id === b.dataset.edit);
        const meaning = prompt(`「${v.word}」的中文意思：`, v.meaning || '');
        if (meaning === null) return;
        v.meaning = meaning.trim();
        await DataStore.update('vocab', v);
        this.renderVocab(box);
      }));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = Portal.action(async () => {
        const v = this.cache.vocab.find(x => x.id === b.dataset.del);
        if (!confirm(`確定從單字庫刪除「${v.word}」？`)) return;
        await DataStore.remove('vocab', v.id);
        this.cache.vocab = this.cache.vocab.filter(x => x.id !== v.id);
        this.refreshTabs();
        this.renderVocab(box);
      }));
    },

    // =============== 字卡複習 ===============
    startReview(all = false) {
      const pool = all ? shuffle(this.cache.vocab).slice(0, 20)
        : this.cache.vocab.filter(isDue).sort((a, b) => String(a.nextReview).localeCompare(String(b.nextReview))).slice(0, 30);
      this.review = { list: pool, i: 0, flipped: false, remembered: 0 };
    },

    renderReview(box) {
      if (!this.review) this.startReview();
      const r = this.review;

      if (!r.list.length) {
        box.innerHTML = `
          <section class="card en-empty">
            <h2>今天沒有要複習的單字 🎉</h2>
            <p class="muted">${this.cache.vocab.length ? '已經複習完了。想多練習的話，可以隨機抽 20 個複習。' : '單字庫還是空的，先去讀文章或手動新增單字吧。'}</p>
            ${this.cache.vocab.length ? '<button class="btn" id="random">隨機複習 20 個</button>' : '<a class="btn" href="#/english">去讀文章</a>'}
          </section>`;
        const btn = box.querySelector('#random');
        if (btn) btn.onclick = () => { this.startReview(true); this.renderReview(box); };
        return;
      }

      if (r.i >= r.list.length) {
        box.innerHTML = `
          <section class="card en-empty">
            <h2>複習完成</h2>
            <p>這次複習 ${r.list.length} 個單字，記得 <strong class="good">${r.remembered}</strong> 個。</p>
            <p class="muted small">記得的字會隔幾天再出現，不記得的字明天會再複習。</p>
            <div class="en-done">
              <button class="btn" id="again">再複習一輪</button>
              <a class="btn btn-ghost" href="#/english/quiz">去做測驗</a>
            </div>
          </section>`;
        box.querySelector('#again').onclick = () => { this.startReview(); this.renderReview(box); };
        return;
      }

      const v = r.list[r.i];
      box.innerHTML = `
        <div class="progress"><span style="width:${(r.i / r.list.length) * 100}%"></span></div>
        <p class="muted small center">${r.i + 1} / ${r.list.length}</p>
        <section class="card flash ${r.flipped ? 'flipped' : ''}">
          <div class="flash-front">
            <span class="flash-word" lang="en">${esc(v.word)}</span>
            <span class="muted">${esc(v.phonetic || '')}</span>
            <button class="icon-btn" id="speak" title="發音">🔊</button>
          </div>
          ${r.flipped ? `
            <div class="flash-back">
              <p class="flash-meaning">${esc(v.meaning || '（尚未填寫中文）')}</p>
              ${v.definition ? `<p class="muted small" lang="en">${esc(v.definition)}</p>` : ''}
              ${v.example ? `<p class="vocab-example small" lang="en">${esc(v.example)}</p>` : ''}
            </div>` : ''}
        </section>
        <div class="flash-actions">
          ${r.flipped
            ? `<button class="btn btn-ghost btn-big" id="forgot">不記得</button><button class="btn btn-big" id="remember">記得</button>`
            : `<button class="btn btn-big" id="flip">顯示答案</button>`}
        </div>
        <p class="muted small center key-hint">鍵盤：空白鍵顯示答案，1 不記得、2 記得</p>`;

      const next = remembered => {
        const b = boxOf(v);
        const nb = remembered ? Math.min(b + 1, MAX_BOX) : 1;
        Object.assign(v, {
          box: nb,
          nextReview: addDays(todayTW(), INTERVALS[nb]),
          lastReviewed: new Date().toISOString(),
          correct: (Number(v.correct) || 0) + (remembered ? 1 : 0),
          wrong: (Number(v.wrong) || 0) + (remembered ? 0 : 1)
        });
        if (remembered) r.remembered++;
        const row = { ...v };
        this.save(() => DataStore.update('vocab', row));
        r.i++;
        r.flipped = false;
        this.refreshTabs();
        this.renderReview(box);
      };

      box.querySelector('#speak').onclick = () => speak(v.word);
      const flip = box.querySelector('#flip');
      if (flip) flip.onclick = () => { r.flipped = true; this.renderReview(box); speak(v.word); };
      const rem = box.querySelector('#remember');
      if (rem) rem.onclick = () => next(true);
      const fog = box.querySelector('#forgot');
      if (fog) fog.onclick = () => next(false);

      document.onkeydown = e => {
        if (!document.body.contains(box) || !location.hash.startsWith('#/english/review')) { document.onkeydown = null; return; }
        if (e.target.matches('input, textarea, select')) return;
        if (!r.flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); r.flipped = true; this.renderReview(box); }
        else if (r.flipped && e.key === '1') next(false);
        else if (r.flipped && e.key === '2') next(true);
      };
    },

    // =============== 測驗 ===============
    startQuiz() {
      const pool = this.cache.vocab.filter(v => String(v.meaning || '').trim());
      const picked = pool
        .map(v => ({ v, score: boxOf(v) * 2 - (Number(v.wrong) || 0) + Math.random() * 3 }))
        .sort((a, b) => a.score - b.score)
        .slice(0, 10)
        .map(x => x.v);
      const qs = shuffle(picked).map(v => {
        const others = shuffle(pool.filter(o => o.id !== v.id && o.meaning !== v.meaning)).slice(0, 3);
        const canSpell = /^[a-z'-]{2,14}$/i.test(v.word);
        const type = shuffle(['w2m', 'm2w', ...(canSpell ? ['spell'] : [])])[0];
        return { v, type, options: type === 'spell' ? [] : shuffle([v, ...others]) };
      });
      this.quiz = { qs, i: 0, answered: null, results: [] };
    },

    renderQuiz(box) {
      const pool = this.cache.vocab.filter(v => String(v.meaning || '').trim());
      if (pool.length < 4) {
        box.innerHTML = `
          <section class="card en-empty">
            <h2>單字還不夠</h2>
            <p class="muted">測驗至少需要 4 個有中文意思的單字，目前有 ${pool.length} 個。</p>
            <a class="btn" href="#/english/vocab">去單字庫新增</a>
          </section>`;
        return;
      }
      if (!this.quiz) this.startQuiz();
      const z = this.quiz;

      if (z.i >= z.qs.length) {
        const right = z.results.filter(x => x.ok).length;
        const wrong = z.results.filter(x => !x.ok).map(x => x.v);
        box.innerHTML = `
          <section class="card en-empty">
            <h2>測驗結束：${right} / ${z.qs.length}</h2>
            <p class="muted">${right === z.qs.length ? '全部答對！' : '答錯的單字明天會再出現在複習裡。'}</p>
            ${wrong.length ? `<ul class="quiz-wrong">${wrong.map(v => `<li><strong lang="en">${esc(v.word)}</strong>　${esc(v.meaning)}</li>`).join('')}</ul>` : ''}
            <div class="en-done">
              <button class="btn" id="restart">再測一次</button>
              <a class="btn btn-ghost" href="#/english/vocab">看單字庫</a>
            </div>
          </section>`;
        box.querySelector('#restart').onclick = () => { this.startQuiz(); this.renderQuiz(box); };
        return;
      }

      const q = z.qs[z.i];
      const a = z.answered;   // { ok, choice }
      const prompts = {
        w2m: `<span class="quiz-q" lang="en">${esc(q.v.word)}</span><span class="muted small">選出正確的中文意思</span>`,
        m2w: `<span class="quiz-q">${esc(q.v.meaning)}</span><span class="muted small">選出對應的英文單字</span>`,
        spell: `<span class="quiz-q">${esc(q.v.meaning)}</span><span class="muted small">拼出英文單字（提示：${esc(q.v.word[0])}… 共 ${q.v.word.length} 個字母）</span>`
      };

      box.innerHTML = `
        <div class="progress"><span style="width:${(z.i / z.qs.length) * 100}%"></span></div>
        <p class="muted small center">第 ${z.i + 1} 題 / 共 ${z.qs.length} 題</p>
        <section class="card quiz-card">
          <div class="quiz-prompt">${prompts[q.type]}</div>
          ${q.type === 'spell' ? `
            <form id="spell" class="spell-row">
              <input name="answer" autocomplete="off" autocapitalize="none" spellcheck="false" lang="en" ${a ? 'disabled' : ''} value="${esc(a?.choice || '')}" placeholder="輸入英文">
              ${a ? '' : '<button class="btn" type="submit">確認</button>'}
            </form>` : `
            <div class="quiz-options">
              ${q.options.map(o => {
                const label = q.type === 'w2m' ? esc(o.meaning) : `<span lang="en">${esc(o.word)}</span>`;
                const cls = !a ? '' : o.id === q.v.id ? 'right' : o.id === a.choice ? 'wrong' : 'dim';
                return `<button class="quiz-opt ${cls}" data-id="${esc(o.id)}" ${a ? 'disabled' : ''}>${label}</button>`;
              }).join('')}
            </div>`}
          ${a ? `
            <div class="quiz-feedback ${a.ok ? 'ok' : 'no'}">
              <strong>${a.ok ? '答對了' : '答錯了'}</strong>
              <span lang="en">${esc(q.v.word)}</span> ${esc(q.v.phonetic || '')}　${esc(q.v.meaning)}
              <button class="icon-btn" id="speak" title="發音">🔊</button>
            </div>
            <button class="btn btn-big" id="next">${z.i + 1 < z.qs.length ? '下一題' : '看結果'}</button>` : ''}
        </section>`;

      const answer = (ok, choice) => {
        z.answered = { ok, choice };
        z.results.push({ v: q.v, ok });
        const v = q.v;
        Object.assign(v, ok
          ? { correct: (Number(v.correct) || 0) + 1 }
          : { wrong: (Number(v.wrong) || 0) + 1, box: 1, nextReview: addDays(todayTW(), 1) });
        this.refreshTabs();
        this.renderQuiz(box);
        speak(v.word);
      };

      box.querySelectorAll('.quiz-opt').forEach(b => b.onclick = () => answer(b.dataset.id === q.v.id, b.dataset.id));
      const spell = box.querySelector('#spell');
      if (spell && !a) {
        spell.answer.focus();
        spell.onsubmit = e => {
          e.preventDefault();
          const value = spell.answer.value.trim();
          if (!value) return;
          answer(value.toLowerCase() === q.v.word.toLowerCase(), value);
        };
      }
      const sp = box.querySelector('#speak');
      if (sp) sp.onclick = () => speak(q.v.word);
      const nx = box.querySelector('#next');
      if (nx) {
        nx.focus();
        nx.onclick = () => {
          z.answered = null;
          z.i++;
          if (z.i >= z.qs.length) {
            // 測驗結束：一次把所有單字的成績寫回試算表
            const rows = [...new Map(z.results.map(x => [x.v.id, { ...x.v }])).values()];
            this.save(() => DataStore.updateMany('vocab', rows));
          }
          this.renderQuiz(box);
        };
      }
    }
  });
})();
