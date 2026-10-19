// =============================================
// 每日英文文章抓取程式（由 GitHub Actions 每天執行一次）
//
// 來源：The Conversation（由大學學者撰寫的新聞評論）
//   授權：CC BY-ND 4.0，允許轉載全文，條件是標明作者、連回原文、不可改寫內容。
//   網站閱讀頁會顯示作者、原文連結與授權說明，並保留 The Conversation 的瀏覽計數。
//
// 需要的環境變數（GitHub Secrets，與其他排程共用）：
//   SHEET_API_URL、WRITE_KEY
// =============================================
import { createSheet, run } from './lib/sheet.mjs';

const {
  SHEET_API_URL,
  WRITE_KEY,
  // 可以改成其他分類，例如 https://theconversation.com/us/technology/articles.atom
  ENGLISH_FEEDS = 'https://theconversation.com/us/articles.atom,https://theconversation.com/articles.atom?language=en'
} = process.env;

const KEEP_DAYS = 30;              // 文章保留天數（單字庫不受影響）
const MIN_WORDS = 450;             // 太短的文章略過
const MAX_WORDS = 1600;            // 太長的文章略過（一天讀一篇剛好的長度）

// ---------- 解析 Atom feed（不需要額外套件） ----------
function decodeEntities(text = '') {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

// 文章 HTML → 純文字段落（保留小標題，去掉圖片、圖說、表格與推廣文字）
function htmlToParagraphs(html) {
  const cleaned = html
    .replace(/<(figure|figcaption|aside|table|script|style|iframe)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ');
  const blocks = [...cleaned.matchAll(/<(p|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return blocks
    .map(([, kind, inner]) => {
      const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return /^h[23]$/i.test(kind) ? `## ${text}` : text;   // 小標題以 ## 開頭
    })
    .filter(t => t && !/^(This article is republished|Read more:|Get news that|Sign up)/i.test(t));
}

function parseAtom(xml) {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(([, e]) => {
    const linkTag = (e.match(/<link\b[^>]*rel="alternate"[^>]*>/i) || e.match(/<link\b[^>]*>/i) || [''])[0];
    const html = decodeEntities(tag(e, 'content'));
    const counter = (html.match(/<img[^>]+src="(https:\/\/counter\.theconversation\.com[^"]+)"/i) || [])[1] || '';
    const authors = [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
      .map(m => decodeEntities(m[1]).trim()).filter(Boolean);
    const paragraphs = htmlToParagraphs(html);
    const body = paragraphs.join('\n\n');
    return {
      title: decodeEntities(tag(e, 'title')).replace(/<[^>]+>/g, '').trim(),
      url: (linkTag.match(/href="([^"]+)"/) || [])[1] || '',
      author: authors.join(', '),
      publishedAt: (tag(e, 'published') || tag(e, 'updated')).trim(),
      body,
      words: body.replace(/^## /gm, '').split(/\s+/).filter(Boolean).length,
      counter
    };
  });
}

// ---------- 主程式 ----------
async function main() {
  const sheet = createSheet({ url: SHEET_API_URL, key: WRITE_KEY });
  const existing = await sheet.get('articles');
  const seen = new Set(existing.map(a => a.url));

  let picked = null;
  const tried = [];
  for (const feed of ENGLISH_FEEDS.split(',').map(s => s.trim()).filter(Boolean)) {
    try {
      const res = await fetch(feed, { headers: { 'User-Agent': 'Mozilla/5.0 (superWeb personal reader)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = parseAtom(await res.text()).filter(a => a.title && a.url && a.body && !seen.has(a.url));
      console.log(`${feed}：${entries.length} 篇未收錄`);
      // 優先挑長度適中的最新文章；都不符合就挑最新一篇
      picked = entries.find(a => a.words >= MIN_WORDS && a.words <= MAX_WORDS) || entries[0] || null;
      if (picked) break;
    } catch (err) {
      tried.push(`${feed}：${err.message}`);
      console.error(`讀取失敗 ${feed}：${err.message}`);
    }
  }

  const nowIso = new Date().toISOString();
  if (picked) {
    await sheet.post({
      action: 'add', sheet: 'articles',
      row: { ...picked, source: 'The Conversation', fetchedAt: nowIso, readAt: '' }
    });
    console.log(`新增文章：${picked.title}（${picked.words} 字）`);
  } else {
    console.log('沒有新的文章可以收錄');
  }

  const before = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
  await sheet.post({ action: 'deleteBefore', sheet: 'articles', field: 'fetchedAt', before });
  await sheet.post({
    action: 'upsert', sheet: 'meta',
    row: { id: 'english.lastRun', value: picked ? `新增：${picked.title}` : (tried.length ? `失敗：${tried.join('；')}` : '沒有新文章'), updatedAt: nowIso }
  });

  if (!picked && tried.length) throw new Error('所有文章來源都讀取失敗');
}

run(main); // 每天只跑一次，失敗時讓 GitHub 寄信通知
