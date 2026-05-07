// ================================================
// worker.js - FINAL VERSION (ALL FEATURES)
// Domain: https://film.vblue.icu
// Features: D1 + SEO + AI + CTA A/B + Progress + Mega Footer + Skeleton + Micro-interactions + Giscus + OneSignal + AMP
// ================================================

function safeHTML(unsafe = '') {
  return String(unsafe)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    if (!pair) continue;
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue;
    const name = pair.slice(0, eqIndex);
    const value = pair.slice(eqIndex + 1);
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function slugify(text) {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

// ==================== D1 DATABASE FUNCTIONS ====================

async function getArticleById(env, id) {
  const result = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  return result || null;
}

async function getArticleBySlug(env, slug) {
  const result = await env.DB.prepare('SELECT * FROM articles WHERE slug = ? AND status = ?').bind(slug, 'published').first();
  return result || null;
}

async function getLatestIds(env, limit = 100, allStatus = false) {
  if (allStatus) {
    const { results } = await env.DB.prepare('SELECT id FROM articles ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    return results.map(r => r.id);
  }
  const { results } = await env.DB.prepare('SELECT id FROM articles WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind('published', limit).all();
  return results.map(r => r.id);
}

async function getArticlesByCategory(env, category) {
  const { results } = await env.DB.prepare('SELECT * FROM articles WHERE category = ? AND status = ? ORDER BY created_at DESC').bind(category, 'published').all();
  return results;
}

async function searchArticles(env, query) {
  const { results } = await env.DB.prepare('SELECT * FROM articles WHERE status = ? AND (title LIKE ? OR intro LIKE ?) ORDER BY created_at DESC').bind('published', `%${query}%`, `%${query}%`).all();
  return results;
}

async function getPopularArticles(env, limit = 6) {
  const { results } = await env.DB.prepare('SELECT title, slug, views FROM articles WHERE status = ? ORDER BY views DESC LIMIT ?').bind('published', limit).all();
  return results;
}

async function getTotalArticles(env) {
  const result = await env.DB.prepare('SELECT COUNT(*) as count FROM articles WHERE status = ?').bind('published').first();
  return result?.count || 0;
}

async function incrementView(env, id) {
  await env.DB.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').bind(id).run();
}

async function incrementClick(env, safelinkId) {
  await env.DB.prepare('UPDATE safelinks SET clicks = clicks + 1 WHERE id = ?').bind(safelinkId).run();
}

async function getTargetUrl(env, safelinkId) {
  const result = await env.DB.prepare('SELECT target_url FROM safelinks WHERE id = ?').bind(safelinkId).first();
  return result?.target_url || null;
}

async function saveArticle(env, formData, oldId) {
  const id = oldId || crypto.randomUUID();
  const oldArticle = oldId ? await getArticleById(env, oldId) : null;
  const safelinkId = formData.get('safelink_id') || (oldArticle ? oldArticle.safelink_id : crypto.randomUUID());
  const targetUrl = formData.get('target_url') || 'https://example.com/watch/' + id;
  const title = formData.get('title') || 'Untitled';
  let newSlug = slugify(title);
  const newCategory = (formData.get('category') || 'action').toLowerCase();

  const existingArticle = await env.DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(newSlug).first();
  if (existingArticle && existingArticle.id !== oldId) { newSlug = newSlug + '-' + Date.now().toString(36); }

  if (oldId) {
    await env.DB.prepare(`UPDATE articles SET title=?, slug=?, image=?, intro=?, content=?, category=?, safelink_id=?, status=? WHERE id=?`)
      .bind(title, newSlug, formData.get('image')||'https://picsum.photos/800/600', formData.get('intro')||'', formData.get('content')||'', newCategory, safelinkId, formData.get('status')||'draft', oldId).run();
  } else {
    await env.DB.prepare(`INSERT INTO articles (id,title,slug,image,intro,content,category,safelink_id,status) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id, title, newSlug, formData.get('image')||'https://picsum.photos/800/600', formData.get('intro')||'', formData.get('content')||'', newCategory, safelinkId, formData.get('status')||'draft').run();
  }
  await env.DB.prepare(`INSERT OR REPLACE INTO safelinks (id,target_url) VALUES (?,?)`).bind(safelinkId, targetUrl).run();
  return id;
}

async function deleteArticle(env, id) {
  const article = await getArticleById(env, id);
  if (!article) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM safelinks WHERE id = ?').bind(article.safelink_id),
    env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id)
  ]);
}

// ==================== KV FUNCTIONS ====================

async function getConfig(env) {
  const d=await env.MY_KV.get('config:delay')||'8', h=await env.MY_KV.get('config:home_limit')||'6', r=await env.MY_KV.get('config:related_limit')||'4';
  return { delay:parseInt(d)||8, homeLimit:parseInt(h)||6, relatedLimit:parseInt(r)||4 };
}

async function getAdsFresh(env) {
  return {
    header:await env.MY_KV.get('config:ads_header')||'', article:await env.MY_KV.get('config:ads_article')||'',
    footer:await env.MY_KV.get('config:ads_footer')||'', home_top:await env.MY_KV.get('config:ads_home_top')||'',
    home_popular:await env.MY_KV.get('config:ads_home_popular')||'', safelink_top:await env.MY_KV.get('config:ads_safelink_top')||'',
    safelink_bottom:await env.MY_KV.get('config:ads_safelink_bottom')||'', sticky:await env.MY_KV.get('config:ads_sticky')||'',
    popunder:await env.MY_KV.get('config:ads_popunder')||''
  };
}

async function rebuildHomepageCache(env) {
  const ids=await getLatestIds(env,12), articles=await Promise.all(ids.slice(0,6).map(id=>getArticleById(env,id)));
  const data=articles.filter(a=>a&&a.status==='published').map(a=>({title:a.title,slug:a.slug,image:a.image,intro:a.intro,category:a.category}));
  await env.MY_KV.put('cache:homepage_data',JSON.stringify(data),{expirationTtl:1800}); return data;
}

async function rebuildPopularCache(env) {
  const popular=await getPopularArticles(env,6);
  await env.MY_KV.put('cache:popular',JSON.stringify(popular),{expirationTtl:600}); return popular;
}

async function invalidateCaches(env) {
  await Promise.all([env.MY_KV.delete('cache:homepage_data'),env.MY_KV.delete('cache:popular'),env.MY_KV.delete('cache:sitemap'),rebuildHomepageCache(env),rebuildPopularCache(env)]);
}

async function generateCSRF(env){const t=crypto.randomUUID();await env.MY_KV.put(`csrf:${t}`,'1',{expirationTtl:3600});return t;}
async function validateCSRF(env,token){if(!token)return false;const e=await env.MY_KV.get(`csrf:${token}`);if(e){await env.MY_KV.delete(`csrf:${token}`);return true;}return false;}
async function isAdmin(request,env){const c=parseCookies(request.headers.get('Cookie')||''),t=c['admin_session'];if(!t)return false;const s=await env.MY_KV.get(`admin_session:${t}`);return!!s;}

// ==================== RENDER FUNCTIONS ====================

function renderAd(adHTML, extraClass = '') {
  if (!adHTML) return '';
  let sc='w-full max-w-full',wc='my-6';
  if(adHTML.includes("'width' : 320"))sc='w-full max-w-[320px] min-h-[50px]';
  else if(adHTML.includes("'width' : 300"))sc='w-full max-w-[300px] min-h-[250px]';
  else if(adHTML.includes("'width' : 336"))sc='w-full max-w-[336px] min-h-[280px]';
  else if(adHTML.includes("'width' : 728"))sc='hidden md:block w-full max-w-[728px] min-h-[90px]';
  else if(adHTML.includes("'width' : 468"))sc='hidden sm:block w-full max-w-[468px] min-h-[60px]';
  return `<div class="w-full flex justify-center items-center ${wc} ${extraClass}"><div class="${sc}">${adHTML}</div></div>`;
}

function renderStickyAd(adHTML){if(!adHTML)return'';return`<div class="fixed bottom-2 left-0 right-0 z-50 flex justify-center lg:hidden px-2"><div class="w-full max-w-[320px] rounded-xl overflow-hidden shadow-2xl">${adHTML}</div></div>`;}

const BASE_URL='https://film.vblue.icu';

function generateSEOHead(title,description,image,url){
  return `<title>${title}</title><meta name="description" content="${description}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${url}"><meta property="og:type" content="article"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:image" content="${image}"><meta property="og:url" content="${url}"><meta name="twitter:card" content="summary_large_image">`;
}

function generateArticleSEO(article){
  return `<title>${safeHTML(article.title)} - FilmViral</title><meta name="description" content="${safeHTML(article.intro)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${BASE_URL}/article/${safeHTML(article.slug)}"><link rel="amphtml" href="${BASE_URL}/amp/article/${safeHTML(article.slug)}"><meta property="og:type" content="article"><meta property="og:title" content="${safeHTML(article.title)}"><meta property="og:description" content="${safeHTML(article.intro)}"><meta property="og:image" content="${safeHTML(article.image)}">`;
}

function generateSchemas(article,category){
  return `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"${safeHTML(article.title)}","description":"${safeHTML(article.intro)}","image":"${article.image}","datePublished":"${article.created_at||new Date().toISOString()}","dateModified":"${article.updated_at||new Date().toISOString()}","author":{"@type":"Organization","name":"FilmViral"},"publisher":{"@type":"Organization","name":"FilmViral","logo":{"@type":"ImageObject","url":"${BASE_URL}/logo.png"}},"mainEntityOfPage":{"@type":"WebPage","@id":"${BASE_URL}/article/${article.slug}"}}</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Beranda","item":"${BASE_URL}/"},{"@type":"ListItem","position":2,"name":"${safeHTML(category)}","item":"${BASE_URL}/category/${category}"},{"@type":"ListItem","position":3,"name":"${safeHTML(article.title)}","item":"${BASE_URL}/article/${article.slug}"}]}</script>`;
}

function getHistats(){return`<script type="text/javascript">var _Hasync=_Hasync||[];_Hasync.push(['Histats.start','1,5024180,4,5,172,25,00011111']);_Hasync.push(['Histats.fasi','1']);_Hasync.push(['Histats.track_hits','']);(function(){var hs=document.createElement('script');hs.type='text/javascript';hs.async=true;hs.src=('//s10.histats.com/js15_as.js');(document.getElementsByTagName('head')[0]||document.getElementsByTagName('body')[0]).appendChild(hs);})();</script><noscript><img src="//sstatic1.histats.com/0.gif?5024180&101" alt="" width="1" height="1" style="display:none"></noscript>`;}

function getPushNotification(){return`<script src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js" defer></script><script>window.OneSignalDeferred=window.OneSignalDeferred||[];OneSignalDeferred.push(async function(OneSignal){await OneSignal.init({appId:"2bc3dadc-30bc-4d16-be70-17d1b6c20c15",safari_web_id:"web.onesignal.auto.428d294a-5ce2-44bb-bee0-dec3149a5564",notifyButton:{enable:true}});});</script>`;}

function getProgressBarCSS(){return`<style>:root{--progress:0%}#reading-progress-container{position:fixed;top:0;left:0;width:100%;height:3px;z-index:100}#reading-progress-bar{height:100%;width:var(--progress);background:linear-gradient(90deg,#e63946,#ff6b6b,#e63946);background-size:200% 100%;animation:progressGlow 2s ease-in-out infinite;transition:width 0.1s linear}@keyframes progressGlow{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}#reading-percentage{position:fixed;top:8px;right:16px;background:#e63946;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;z-index:100;opacity:0;transition:opacity .3s}#reading-percentage.visible{opacity:1}</style><div id="reading-progress-container"><div id="reading-progress-bar"></div></div><div id="reading-percentage">0%</div>`;}

function getProgressBarScript(){return`<script>(function(){const bar=document.getElementById('reading-progress-bar'),percent=document.getElementById('reading-percentage');let maxScroll=0;function update(){const st=window.scrollY,dh=document.body.scrollHeight-window.innerHeight;if(dh<=0)return;const p=Math.min(100,Math.round((st/dh)*100));document.documentElement.style.setProperty('--progress',p+'%');percent.textContent=p+'%';if(p>maxScroll)maxScroll=p;st>100?percent.classList.add('visible'):percent.classList.remove('visible');if(p>=100){bar.style.background='linear-gradient(90deg,#10b981,#34d399)';percent.textContent='✅ Selesai'}}let ticking=!1;window.addEventListener('scroll',()=>{if(!ticking){window.requestAnimationFrame(()=>{update();ticking=!1});ticking=!0}});update()})();</script>`;}

const CTA_VARIANTS=[{id:'A',text:'⬇️ DOWNLOAD GRATIS',subtext:'Akses langsung tanpa ribet',gradient:'from-[#e63946] to-red-600',shadow:'shadow-red-500/50'},{id:'B',text:'🎬 TONTON SEKARANG',subtext:'Streaming kualitas HD',gradient:'from-green-500 to-emerald-600',shadow:'shadow-green-500/50'},{id:'C',text:'⚡ AKSES CEPAT',subtext:'Langsung ke tujuan',gradient:'from-blue-500 to-blue-600',shadow:'shadow-blue-500/50'},{id:'D',text:'🔓 BUKA LINK ASLI',subtext:'100% aman tanpa virus',gradient:'from-purple-500 to-purple-600',shadow:'shadow-purple-500/50'}];
function simpleHash(str){let h=0;for(let i=0;i<str.length;i++){h=((h<<5)-h)+str.charCodeAt(i);h&=h}return Math.abs(h);}
function getABTestCTA(safelinkId,sessionId){const v=CTA_VARIANTS[simpleHash(sessionId+safelinkId)%CTA_VARIANTS.length];return`<div class="cta-container my-12 text-center" data-variant="${v.id}"><div class="bg-gradient-to-b from-zinc-900 to-zinc-950 border border-zinc-800 rounded-3xl p-8 lg:p-10"><span class="text-[#e63946] text-sm font-medium uppercase">🚀 Akses Cepat</span><h3 class="text-2xl lg:text-3xl font-bold mt-2 mb-2">Siap Nonton?</h3><p class="text-zinc-400 mb-2">${v.subtext}</p><p class="text-xs text-zinc-500 mb-4">✅ Sudah <strong class="text-emerald-400" id="download-count">0</strong> orang mengakses</p><a href="/safelink/${safeHTML(safelinkId)}" class="cta-button download-btn inline-flex items-center gap-x-3 bg-gradient-to-r ${v.gradient} text-white text-xl font-bold px-12 py-5 rounded-2xl shadow-2xl ${v.shadow}" data-variant="${v.id}" onclick="trackCTAClick('${v.id}')">${v.text}</a><p class="text-zinc-500 text-xs mt-4">⏱️ Dialihkan otomatis • 100% Aman</p></div></div>`;}
function getCTATrackingScript(){return`<script>window.trackCTAClick=function(v){if(navigator.sendBeacon)navigator.sendBeacon('/cta-track?variant='+v)};const c=Math.floor(Math.random()*500+100),el=document.getElementById('download-count');if(el){el.textContent=c.toLocaleString();setInterval(()=>{el.textContent=(parseInt(el.textContent.replace(/,/g,''))+Math.floor(Math.random()*3)).toLocaleString()},30000)}</script>`;}

function getMegaFooter(){return`<footer class="bg-zinc-900 border-t border-zinc-800 mt-16"><div class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-12"><div class="grid grid-cols-2 md:grid-cols-4 gap-8"><div><h3 class="text-2xl title-font mb-3">FILM<span class="accent">VIRAL</span></h3><p class="text-xs text-zinc-500 leading-relaxed">Asupan film & video terbaru. Streaming gratis, update setiap hari.</p><div class="flex gap-3 mt-4"><a href="#" class="w-8 h-8 bg-zinc-800 hover:bg-[#e63946] rounded-full flex items-center justify-center text-xs transition">📱</a><a href="#" class="w-8 h-8 bg-zinc-800 hover:bg-[#e63946] rounded-full flex items-center justify-center text-xs transition">✈️</a><a href="#" class="w-8 h-8 bg-zinc-800 hover:bg-[#e63946] rounded-full flex items-center justify-center text-xs transition">𝕏</a></div></div><div><h4 class="text-sm font-semibold mb-3">📂 Kategori</h4><div class="space-y-2 text-xs text-zinc-400"><a href="/category/action" class="block hover:text-[#e63946] transition">🎬 Action</a><a href="/category/drama" class="block hover:text-[#e63946] transition">🎭 Drama</a><a href="/category/horor" class="block hover:text-[#e63946] transition">👻 Horor</a><a href="/category/komedi" class="block hover:text-[#e63946] transition">😂 Komedi</a></div></div><div><h4 class="text-sm font-semibold mb-3">🔗 Navigasi</h4><div class="space-y-2 text-xs text-zinc-400"><a href="/" class="block hover:text-[#e63946] transition">🏠 Beranda</a><a href="/search" class="block hover:text-[#e63946] transition">🔍 Pencarian</a><a href="/sitemap.xml" class="block hover:text-[#e63946] transition">🗺️ Sitemap</a></div></div><div><h4 class="text-sm font-semibold mb-3">⚠️ Disclaimer</h4><p class="text-xs text-zinc-500 leading-relaxed">Kami tidak menyimpan file apapun di server. Semua konten adalah hak cipta pemilik masing-masing.</p></div></div><div class="border-t border-zinc-800 mt-8 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4"><p class="text-xs text-zinc-600">© 2026 FilmViral. All rights reserved.</p><div class="flex gap-4 text-xs text-zinc-600"><a href="#" class="hover:text-zinc-400">Privacy</a><a href="#" class="hover:text-zinc-400">Terms</a><a href="#" class="hover:text-zinc-400">DMCA</a></div></div></div></footer>`;}

function getMicroInteractions(){return`<div class="flex items-center gap-6 py-4 border-t border-zinc-800 mt-8"><button onclick="toggleLike()" class="flex items-center gap-2 text-zinc-500 hover:text-[#e63946] transition group"><span id="likeIcon" class="text-xl">🤍</span><span id="likeCount" class="text-sm">0</span></button><button onclick="toggleBookmark()" class="flex items-center gap-2 text-zinc-500 hover:text-yellow-400 transition"><span id="bookmarkIcon" class="text-xl">🔖</span><span class="text-sm">Simpan</span></button><button onclick="copyPageLink()" class="flex items-center gap-2 text-zinc-500 hover:text-blue-400 transition"><span class="text-xl">🔗</span><span class="text-sm">Share</span></button></div><script>let liked=!1,bookmarked=!1;function toggleLike(){liked=!liked;document.getElementById('likeIcon').textContent=liked?'❤️':'🤍';document.getElementById('likeCount').textContent=liked?'1':'0';if(liked&&navigator.vibrate)navigator.vibrate(30)}function toggleBookmark(){bookmarked=!bookmarked;document.getElementById('bookmarkIcon').textContent=bookmarked?'🔖':'📑'}function copyPageLink(){const u=window.location.href;navigator.clipboard?navigator.clipboard.writeText(u).then(()=>alert('✅ Link disalin!')):prompt('Copy:',u)}</script>`;}

function getGiscusComments(){return`<div class="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 mt-8"><h4 class="text-lg font-semibold mb-4">💬 Komentar</h4><script src="https://giscus.app/client.js" data-repo="ciciesg34/filmviral-comments" data-repo-id="R_kgDOSWVItw" data-category="Announcements" data-category-id="DIC_kwDOSWVIt84C8edx" data-mapping="pathname" data-strict="0" data-reactions-enabled="1" data-emit-metadata="0" data-input-position="bottom" data-theme="preferred_color_scheme" data-lang="id" crossorigin="anonymous" async></script></div>`;}

function getFloatingButtons(){return`<div class="fixed bottom-20 right-4 z-40 flex flex-col gap-2"><button onclick="reportLink()" class="w-12 h-12 bg-yellow-600 hover:bg-yellow-700 rounded-full flex items-center justify-center text-white shadow-lg transition text-lg" title="Laporkan Link Rusak">🚩</button><button onclick="window.scrollTo({top:0,behavior:'smooth'})" class="w-12 h-12 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center text-white shadow-lg transition text-lg">↑</button></div><script>function reportLink(){if(confirm('Apakah link ini rusak/tidak bisa diakses?')){fetch('/report-link',{method:'POST',body:JSON.stringify({url:window.location.href})});alert('✅ Terima kasih!')}}</script>`;}

const getNavbar=(current='')=>`<nav class="bg-zinc-900/80 backdrop-blur-lg border-b border-zinc-800 sticky top-0 z-50"><div class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between"><a href="/" class="flex items-center gap-x-2 text-3xl title-font">FILM<span class="accent">VIRAL</span></a><div class="flex items-center gap-x-8 text-sm font-medium"><a href="/" class="${current==='/'?'accent':'hover:accent'}">Beranda</a><a href="/search" class="${current==='/search'?'accent':'hover:accent'}">Pencarian</a></div><a href="/admin" id="admin-link" class="hidden px-6 py-2.5 bg-[#e63946] hover:bg-red-700 rounded-2xl text-white text-sm font-medium">Admin</a></div></nav><script>const cookies=document.cookie.split(';').reduce((a,c)=>{const[k,v]=c.trim().split('=');a[k]=v;return a},{});if(cookies.admin_session)document.getElementById('admin-link').classList.remove('hidden')</script>`;

// ====================== MAIN FETCH HANDLER ======================
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const method = request.method;
      const cache = caches.default;

      // Sitemap & Robots
      if (pathname === '/sitemap.xml') {
        const cs = await env.MY_KV.get('cache:sitemap');
        if (cs) return new Response(cs, { headers: { 'Content-Type':'application/xml','Cache-Control':'public,max-age=21600' } });
        const ids=await getLatestIds(env,5000), articles=await Promise.all(ids.map(id=>getArticleById(env,id)));
        let xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
        xml+=`  <url>\n    <loc>${BASE_URL}/</loc>\n    <changefreq>hourly</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
        for(const cat of['action','drama','horor','komedi']){xml+=`  <url>\n    <loc>${BASE_URL}/category/${cat}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;}
        for(const a of articles){if(a&&a.status==='published'){xml+=`  <url>\n    <loc>${BASE_URL}/article/${a.slug}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;xml+=`  <url>\n    <loc>${BASE_URL}/amp/article/${a.slug}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;}}
        xml+='</urlset>'; await env.MY_KV.put('cache:sitemap',xml,{expirationTtl:21600});
        return new Response(xml,{headers:{'Content-Type':'application/xml','Cache-Control':'public,max-age=21600'}});
      }
      if(pathname==='/robots.txt'){return new Response(`User-agent:*\nAllow:/\nDisallow:/admin\nDisallow:/safelink\n\nSitemap:${BASE_URL}/sitemap.xml`,{headers:{'Content-Type':'text/plain','Cache-Control':'public,max-age=86400'}});}
      if(pathname==='/cta-track'){try{await env.DB.prepare(`INSERT INTO cta_clicks(variant,clicked_at) VALUES (?,datetime('now'))`).bind(url.searchParams.get('variant')||'unknown').run();}catch(e){}return new Response('OK');}

      // ====================== HOMEPAGE ======================
      if (pathname === '/' || pathname === '') {
        const cached = await cache.match(request); if(cached) return cached;
        const config=await getConfig(env), ads=await getAdsFresh(env), stickyId=await env.MY_KV.get('config:sticky_article');
        let page=parseInt(url.searchParams.get('page')||'1',10); if(page<1)page=1;
        const limit=config.homeLimit, offset=(page-1)*limit;
        const [latestIds,cachedData,popularRaw,totalArticles,stickyArticle]=await Promise.all([getLatestIds(env,100),env.MY_KV.get('cache:homepage_data'),env.MY_KV.get('cache:popular'),getTotalArticles(env),stickyId?getArticleById(env,stickyId):null]);
        let articles=[]; if(cachedData&&page===1)articles=JSON.parse(cachedData); else{const fetched=await Promise.all(latestIds.slice(offset,offset+limit).map(id=>getArticleById(env,id)));articles=fetched.filter(a=>a&&a.status==='published').map(a=>({title:a.title,slug:a.slug,image:a.image,intro:a.intro,category:a.category}));}
        const popularList=popularRaw?JSON.parse(popularRaw):await rebuildPopularCache(env);
        const totalPages=Math.max(1,Math.ceil(latestIds.length/limit));
        
        const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">${getHistats()}${getPushNotification()}${generateSEOHead('FilmViral - Asupan Film Terbaru','Nonton dan download film terbaru gratis. Streaming video viral, film action, drama, horor, komedi HD.','https://picsum.photos/1200/630',BASE_URL)}<script src="https://cdn.tailwindcss.com"></script><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet"><style>body{font-family:'Inter',system_ui,sans-serif}.title-font{font-family:'Poppins',sans-serif}.accent{color:#e63946}.card{transition:all .3s;height:100%;display:flex;flex-direction:column}.card:hover{transform:translateY(-5px);box-shadow:0 20px 40px -15px rgba(230,57,70,.3)}.card .p-5{flex:1}.line-clamp-2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.line-clamp-3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}.skeleton{background:linear-gradient(90deg,#27272a 25%,#3f3f46 50%,#27272a 75%);background-size:200% 100%;animation:shimmer 1.5s infinite}</style></head><body class="bg-zinc-950 text-zinc-100">${getNavbar('/')}<main class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-6 lg:py-8">${stickyArticle?`<div class="relative mb-10 bg-gradient-to-br from-zinc-900 to-zinc-950 border border-[#e63946]/20 rounded-3xl overflow-hidden"><div class="absolute top-4 left-4 z-10"><span class="inline-flex items-center text-xs uppercase bg-[#e63946] text-white px-4 py-1.5 rounded-full font-bold">📌 PINNED</span></div><div class="grid grid-cols-1 lg:grid-cols-5"><div class="col-span-1 lg:col-span-2"><img src="${safeHTML(stickyArticle.image)}" class="w-full h-64 lg:h-full object-cover" alt="${safeHTML(stickyArticle.title)}"></div><div class="col-span-1 lg:col-span-3 p-6 lg:p-8 flex flex-col justify-center"><a href="/article/${safeHTML(stickyArticle.slug)}" class="text-2xl lg:text-4xl title-font leading-tight hover:accent">${safeHTML(stickyArticle.title)}</a><p class="mt-4 text-zinc-400">${safeHTML(stickyArticle.intro)}</p></div></div></div>`:''}<div class="flex flex-wrap justify-center gap-6 sm:gap-10 mb-10 py-4 px-6 bg-zinc-900/50 rounded-3xl border border-zinc-800/50">${[{l:'Artikel',v:totalArticles+'+'},{l:'Kategori',v:'4'},{l:'Update',v:'24/7'},{l:'Gratis',v:'100%'}].map((s,i)=>`<div class="text-center group hover:scale-110 transition"><div class="text-3xl font-bold text-[#e63946] group-hover:text-red-400 transition">${s.v}</div><div class="text-xs text-zinc-500">${s.l}</div></div>${i<3?'<div class="w-px h-8 bg-zinc-800 hidden sm:block"></div>':''}`).join('')}</div><div class="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10"><div class="col-span-1 lg:col-span-8"><div class="flex items-center justify-between mb-6"><div><h1 class="text-3xl lg:text-4xl font-bold">🎬 Asupan Terbaru</h1><p class="text-zinc-500 text-sm mt-1">Update setiap hari</p></div>${totalPages>1?`<span class="text-xs text-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-full">Hal ${page}/${totalPages}</span>`:''}</div><form action="/search" method="GET" class="mb-6 flex gap-2"><input type="text" name="q" placeholder="🔍 Cari judul film..." class="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 text-sm outline-none focus:border-[#e63946]"><button type="submit" class="px-5 py-3 bg-[#e63946] hover:bg-red-700 rounded-2xl text-sm font-medium">Cari</button></form>${renderAd(ads.home_top)}<div class="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-6">${articles.map((article,i)=>`<div class="card bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800/50 hover:border-[#e63946]/30"><div class="relative"><img src="${safeHTML(article.image)}" class="w-full aspect-video object-cover" alt="${safeHTML(article.title)}" loading="${i<4?'eager':'lazy'}"><div class="absolute top-3 left-3"><span class="text-[10px] uppercase bg-zinc-950/80 backdrop-blur text-zinc-300 px-2.5 py-1 rounded-full">${safeHTML(article.category)}</span></div>${i<2?'<div class="absolute top-3 right-3"><span class="text-[10px] uppercase bg-[#e63946] text-white px-2.5 py-1 rounded-full font-bold">🔥 HOT</span></div>':''}</div><div class="p-5"><a href="/article/${safeHTML(article.slug)}" class="block text-lg lg:text-xl title-font leading-snug hover:accent line-clamp-2">${safeHTML(article.title)}</a><p class="mt-2 text-sm text-zinc-400 line-clamp-3">${safeHTML(article.intro)}</p></div></div>`).join('')}</div>${articles.length===0?'<div class="text-center py-20"><div class="text-6xl mb-4">📭</div><h3 class="text-xl text-zinc-400">Belum ada artikel</h3></div>':''}${totalPages>1?`<div class="flex justify-center items-center gap-x-4 mt-10"><a href="?page=${page>1?page-1:1}" class="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 rounded-2xl text-sm ${page<=1?'opacity-40 pointer-events-none':''}">‹ Sebelumnya</a><span class="text-sm text-zinc-500">Halaman ${page} dari ${totalPages}</span><a href="?page=${page<totalPages?page+1:totalPages}" class="px-6 py-3 bg-zinc-900 hover:bg-zinc-800 rounded-2xl text-sm ${page>=totalPages?'opacity-40 pointer-events-none':''}">Berikutnya ›</a></div>`:''}</div><div class="col-span-1 lg:col-span-4"><div class="lg:sticky lg:top-28 space-y-8"><div class="bg-zinc-900 rounded-3xl p-6 border border-zinc-800"><h3 class="text-[#e63946] text-lg font-semibold mb-5">🔥 Terpopuler</h3><div class="space-y-1">${popularList.map((p,i)=>`<a href="/article/${safeHTML(p.slug)}" class="flex items-start gap-3 py-3 border-b border-zinc-800/50 last:border-none hover:bg-zinc-800/30 rounded-xl px-2 -mx-2"><span class="text-2xl font-bold text-zinc-700">${i+1}</span><div><p class="text-sm font-medium line-clamp-2">${safeHTML(p.title)}</p><p class="text-xs text-zinc-500 mt-1">👁️ ${(p.views||0).toLocaleString()}</p></div></a>`).join('')}</div></div>${renderAd(ads.home_popular)}<div class="bg-zinc-900 rounded-3xl p-6 border border-zinc-800"><h3 class="text-lg font-semibold mb-4">📂 Kategori</h3><div class="grid grid-cols-2 gap-2"><a href="/category/action" class="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-3 text-sm text-center">🎬 Action</a><a href="/category/drama" class="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-3 text-sm text-center">🎭 Drama</a><a href="/category/horor" class="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-3 text-sm text-center">👻 Horor</a><a href="/category/komedi" class="bg-zinc-800 hover:bg-zinc-700 rounded-xl px-4 py-3 text-sm text-center">😂 Komedi</a></div></div></div></div></div></main>${renderAd(ads.footer,'max-w-[728px] mx-auto my-8')}${renderStickyAd(ads.sticky)}${getMegaFooter()}</body></html>`;
        
        const response=new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=900,s-maxage=1800','Vary':'Accept-Encoding'}});
        const cookie=request.headers.get('Cookie')||''; if(!cookie.includes('admin_session'))await cache.put(request,response.clone());
        return response;
      }

      // ====================== ARTIKEL DETAIL ======================
      if (pathname.startsWith('/article/')) {
        const cached=await cache.match(request); if(cached)return cached;
        const slug=pathname.slice(9), article=await getArticleBySlug(env,slug);
        if(!article)return new Response('Artikel tidak ditemukan',{status:404});
        const [config,ads,categoryArticles]=await Promise.all([getConfig(env),getAdsFresh(env),getArticlesByCategory(env,article.category)]);
        await incrementView(env,article.id);
        const related=categoryArticles.filter(a=>a.id!==article.id).slice(0,config.relatedLimit);
        
        const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">${getHistats()}${getPushNotification()}${generateArticleSEO(article)}${generateSchemas(article,article.category)}<script src="https://cdn.tailwindcss.com"></script><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" rel="stylesheet"><style>body{font-family:'Inter',system_ui,sans-serif}.title-font{font-family:'Poppins',sans-serif}.accent{color:#e63946}.download-btn{transition:all .3s}.download-btn:hover{transform:translateY(-2px);box-shadow:0 15px 25px -5px rgb(230 57 70/.3)}.line-clamp-2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.article-content h2{font-size:1.5rem;font-weight:700;color:#e63946;margin:1.5rem 0 .75rem;border-bottom:1px solid #27272a;padding-bottom:.5rem}.article-content h3{font-size:1.2rem;font-weight:600;color:#fafafa;margin:1.25rem 0 .5rem}.article-content p{margin-bottom:1rem;line-height:1.8;color:#d1d5db}.article-content ul{list-style:disc;padding-left:1.5rem;margin-bottom:1rem;color:#d1d5db}.article-content ol{list-style:decimal;padding-left:1.5rem;margin-bottom:1rem;color:#d1d5db}.article-content li{margin-bottom:.5rem}.article-content strong{color:#e63946;font-weight:600}</style></head><body class="bg-zinc-950 text-zinc-100">${getProgressBarCSS()}${getNavbar('/article')}<main class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-6 lg:py-10"><div class="flex items-center gap-x-2 text-xs text-zinc-500 mb-6"><a href="/" class="hover:text-zinc-300">🏠 Beranda</a> › <a href="/category/${safeHTML(article.category)}" class="hover:text-zinc-300 capitalize">${safeHTML(article.category)}</a> › <span class="text-zinc-400 truncate">${safeHTML(article.title)}</span></div><h1 class="text-3xl lg:text-5xl title-font leading-tight mb-6">${safeHTML(article.title)}</h1>${renderAd(ads.header)}<img src="${safeHTML(article.image)}" class="w-full rounded-3xl my-6" alt="${safeHTML(article.title)}" loading="eager">${renderAd(ads.safelink_top)}<div class="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8"><div class="col-span-1 lg:col-span-8"><div class="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 mb-8"><p class="text-lg text-zinc-300 leading-relaxed">${safeHTML(article.intro)}</p></div><div class="article-content">${article.content||''}</div>${getMicroInteractions()}${getGiscusComments()}<div class="mt-8 bg-yellow-900/20 border border-yellow-700/50 rounded-2xl p-5"><p class="text-yellow-400 text-xs font-medium mb-1">⚠️ DISCLAIMER</p><p class="text-yellow-500/70 text-xs">Halaman ini hanya menyediakan informasi. Kami tidak menyimpan file apapun.</p></div>${renderAd(ads.article)}${getABTestCTA(article.safelink_id,article.id)}</div><div class="col-span-1 lg:col-span-4"><div class="lg:sticky lg:top-28 space-y-8"><div class="bg-zinc-900 rounded-3xl p-5 border border-zinc-800"><h4 class="text-sm font-semibold mb-4">ℹ️ Info</h4><div class="space-y-3 text-sm text-zinc-400"><div class="flex justify-between"><span>Kategori</span><span class="text-zinc-300 capitalize">${safeHTML(article.category)}</span></div><div class="flex justify-between"><span>Status</span><span class="text-emerald-400">✅ Tersedia</span></div></div></div>${renderAd(ads.home_popular)}${related.length>0?`<div class="bg-zinc-900 rounded-3xl p-5 border border-zinc-800"><h4 class="text-sm font-semibold mb-4">📺 Terkait</h4><div class="space-y-3">${related.map(r=>`<a href="/article/${safeHTML(r.slug)}" class="flex gap-3 hover:bg-zinc-800 rounded-xl p-2 -mx-2"><img src="${safeHTML(r.image||'https://picsum.photos/80/80')}" class="w-14 h-14 rounded-lg object-cover"><div><p class="text-sm font-medium line-clamp-2">${safeHTML(r.title)}</p></div></a>`).join('')}</div></div>`:''}</div></div></div></main>${renderAd(ads.footer,'max-w-[728px] mx-auto my-8')}${renderStickyAd(ads.sticky)}<div class="fixed bottom-16 left-0 right-0 z-40 lg:hidden px-4"><a href="/safelink/${safeHTML(article.safelink_id)}" class="block w-full py-4 bg-gradient-to-r from-[#e63946] to-red-600 text-white text-center text-lg font-bold rounded-2xl">⬇️ DOWNLOAD GRATIS</a></div>${getFloatingButtons()}${getCTATrackingScript()}${getProgressBarScript()}</body></html>`;
        
        const response=new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=1800,s-maxage=3600','Vary':'Accept-Encoding'}});
        const cookie=request.headers.get('Cookie')||''; if(!cookie.includes('admin_session'))await cache.put(request,response.clone());
        return response;
      }

      // ====================== AMP VERSION ======================
      if (pathname.startsWith('/amp/article/')) {
        const slug = pathname.slice(13);
        const article = await getArticleBySlug(env, slug);
        if (!article) return new Response('Article not found', { status: 404 });

        const ampHtml = `<!doctype html><html amp lang="id"><head><meta charset="utf-8"><script async src="https://cdn.ampproject.org/v0.js"></script><title>${safeHTML(article.title)} - FilmViral</title><link rel="canonical" href="${BASE_URL}/article/${article.slug}"><meta name="viewport" content="width=device-width,minimum-scale=1,initial-scale=1"><style amp-boilerplate>body{-webkit-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-moz-animation:-amp-start 8s steps(1,end) 0s 1 normal both;-ms-animation:-amp-start 8s steps(1,end) 0s 1 normal both;animation:-amp-start 8s steps(1,end) 0s 1 normal both}@-webkit-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-moz-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-ms-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@-o-keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}@keyframes -amp-start{from{visibility:hidden}to{visibility:visible}}</style><noscript><style amp-boilerplate>body{-webkit-animation:none;-moz-animation:none;-ms-animation:none;animation:none}</style></noscript><style amp-custom>body{font-family:Arial,sans-serif;background:#18181b;color:#fafafa;padding:16px;max-width:800px;margin:0 auto}h1{color:#e63946;font-size:1.8rem;margin:16px 0}p{line-height:1.6;color:#d1d5db}amp-img{border-radius:16px;margin:16px 0}.cta-btn{display:block;text-align:center;background:#e63946;color:#fff;padding:16px;border-radius:16px;font-weight:bold;text-decoration:none;margin:24px 0;font-size:1.2rem}nav{margin-bottom:16px}nav a{color:#e63946;text-decoration:none}</style></head><body><nav><a href="${BASE_URL}/">🏠 Beranda</a> › ${safeHTML(article.category)}</nav><h1>${safeHTML(article.title)}</h1><amp-img src="${article.image}" width="800" height="450" layout="responsive" alt="${safeHTML(article.title)}"></amp-img><p><em>${safeHTML(article.intro)}</em></p><div>${(article.content||'').replace(/<h[23]>/g,'<p><strong>').replace(/<\/h[23]>/g,'</strong></p>').replace(/<ul>/g,'<div>').replace(/<\/ul>/g,'</div>').replace(/<li>/g,'<p>• ').replace(/<\/li>/g,'</p>')}</div><a href="${BASE_URL}/safelink/${article.safelink_id}" class="cta-btn">⬇️ DOWNLOAD GRATIS</a><p style="font-size:0.8rem;color:#71717a">⚠️ Halaman ini hanya menyediakan informasi. Kami tidak menyimpan file apapun.</p></body></html>`;

        return new Response(ampHtml, { headers: { 'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=3600' } });
      }

      // ====================== CATEGORY PAGE ======================
      if (pathname.startsWith('/category/')) {
        const cached=await cache.match(request); if(cached)return cached;
        const category=pathname.slice(10), articles=await getArticlesByCategory(env,category);
        const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${safeHTML(category)} - FilmViral</title>${getHistats()}${getPushNotification()}<script src="https://cdn.tailwindcss.com"></script><style>body{font-family:'Inter',system_ui,sans-serif}.accent{color:#e63946}</style></head><body class="bg-zinc-950 text-zinc-100">${getNavbar('/category')}<main class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-8"><h1 class="text-4xl font-semibold mb-2 capitalize">${safeHTML(category)}</h1><div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">${articles.map(a=>`<div class="bg-zinc-900 rounded-3xl overflow-hidden"><img src="${safeHTML(a.image)}" class="w-full aspect-video object-cover" alt="${safeHTML(a.title)}" loading="lazy"><div class="p-5"><a href="/article/${safeHTML(a.slug)}" class="block text-xl font-bold hover:accent">${safeHTML(a.title)}</a></div></div>`).join('')}</div></main>${getMegaFooter()}</body></html>`;
        const response=new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=900,s-maxage=1800'}});
        const cookie=request.headers.get('Cookie')||''; if(!cookie.includes('admin_session'))await cache.put(request,response.clone());
        return response;
      }

      // ====================== SAFELINK ======================
      if (pathname.startsWith('/safelink/')) {
        const urlObj=new URL(request.url); let id='',isContinue=false;
        if(pathname.startsWith('/safelink/continue/')){isContinue=true;id=pathname.replace('/safelink/continue/','').split('?')[0];}
        else{id=pathname.replace('/safelink/','').split('?')[0];}
        if(!id)return new Response('Safelink tidak valid',{status:404});
        const targetUrl=await getTargetUrl(env,id); if(!targetUrl)return new Response('Safelink tidak ditemukan',{status:404});
        const config=await getConfig(env), ads=await getAdsFresh(env);
        if(isContinue){const token=urlObj.searchParams.get('token');if(!token)return new Response('Token tidak valid',{status:403});const vt=await env.MY_KV.get(`safelink_token:${id}`);if(!vt||vt!==token)return new Response('Token expired',{status:403});await env.MY_KV.delete(`safelink_token:${id}`);await incrementClick(env,id);return Response.redirect(targetUrl,302);}
        incrementClick(env,id).catch(()=>{});const sfToken=crypto.randomUUID();await env.MY_KV.put(`safelink_token:${id}`,sfToken,{expirationTtl:90});
        const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Mengalihkan... • FilmViral</title><meta name="robots" content="noindex,nofollow">${getHistats()}${getPushNotification()}${ads.popunder||''}<script src="https://cdn.tailwindcss.com"></script><style>body{font-family:system-ui,sans-serif}.progress{transition:width .1s linear}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}.pulse{animation:pulse 1.5s infinite}.bounce{animation:bounce .6s ease-in-out}</style></head><body class="bg-zinc-950 text-white min-h-screen flex items-center justify-center p-4"><div class="w-full max-w-xl"><div class="mb-4">${renderAd(ads.safelink_top)}</div><div class="bg-zinc-900 rounded-3xl border border-zinc-800 shadow-2xl overflow-hidden"><div class="bg-gradient-to-r from-zinc-800 to-zinc-900 px-8 py-5 border-b border-zinc-800"><div class="flex items-center gap-3"><span class="text-2xl">🎬</span><div><h2 class="font-semibold text-lg">FilmViral Safelink</h2><p class="text-xs text-zinc-500">Akses aman & cepat</p></div></div></div><div class="p-8 text-center"><p id="st" class="text-zinc-300 mb-2 pulse text-sm">🔍 Mencari server terbaik...</p><p class="text-emerald-400 text-sm mb-6">🔥 <span id="vc">${Math.floor(Math.random()*50+10)}</span> orang mengakses sekarang</p><div class="mb-8"><div id="count" class="text-8xl font-mono font-bold text-[#e63946] bounce">${config.delay}</div></div><div class="h-2.5 bg-zinc-800 rounded-full mb-6 overflow-hidden"><div id="pb" class="progress h-2.5 bg-gradient-to-r from-[#e63946] to-red-500 rounded-full w-full"></div></div><div id="ca" class="mb-6"><div class="bg-zinc-800/50 rounded-2xl p-4 border border-zinc-700/50"><p class="text-yellow-400 text-sm mb-3">🤖 Verifikasi</p><button onclick="verifyCaptcha()" id="cb" class="px-6 py-3 bg-zinc-700 hover:bg-zinc-600 rounded-xl text-sm font-medium flex items-center gap-2 mx-auto"><span>✅</span> Saya bukan robot</button></div></div><div class="flex justify-center gap-4 text-xs text-zinc-500 mb-4"><span>🔒 SSL</span><span>⚡ CDN</span><span>🛡️ Safe</span></div><div class="mb-6">${renderAd(ads.safelink_bottom)}</div><button id="cbtn" onclick="continueLink()" class="hidden w-full py-5 bg-gradient-to-r from-[#e63946] to-red-600 rounded-2xl text-lg font-bold shadow-xl">⬇️ LANJUTKAN KE LINK</button><div id="expWarn" class="hidden text-yellow-400 text-xs mt-4">⚠️ Link expired dalam <span id="expC">120</span> detik</div><div id="copyArea" class="hidden mt-4"><button onclick="copyLink()" class="w-full py-4 border border-zinc-700 rounded-2xl text-sm">📋 Copy Link</button></div></div></div></div>${renderStickyAd(ads.sticky)}<script>let time=${config.delay},cd=!1,le=!1;const ce=document.getElementById('count'),pe=document.getElementById('pb'),cb=document.getElementById('cbtn'),st=document.getElementById('st');const ss=['🔍 Mencari server...','🔗 Menghubungkan...','📡 Menyiapkan...','✅ Link ditemukan!'];let si=0;setInterval(()=>{if(time>0&&!le){st.textContent=ss[si%ss.length];si++}},1800);const timer=setInterval(()=>{if(le)return;time--;ce.textContent=time;pe.style.width=(time/${config.delay}*100)+'%';if(time<=0){clearInterval(timer);ce.textContent='✓';pe.style.width='0%';st.textContent='✅ Siap!';if(cd){document.getElementById('ca').classList.add('hidden');cb.classList.remove('hidden')}else ce.insertAdjacentHTML('afterend','<p class="text-yellow-400 text-xs mt-2">Selesaikan verifikasi 👆</p>')}},1000);window.verifyCaptcha=function(){if(cd)return;cd=!0;const b=document.getElementById('cb');b.textContent='✅ Terverifikasi!';b.classList.add('bg-emerald-600');b.disabled=!0;if(time<=0&&!le){document.getElementById('ca').classList.add('hidden');cb.classList.remove('hidden')}};window.continueLink=function(){if(le)return;cb.textContent='⏳ Mengarahkan...';setTimeout(()=>{window.location.href="/safelink/continue/${id}?token=${sfToken}"},600)};window.copyLink=function(){const u=${JSON.stringify(targetUrl)};navigator.clipboard?navigator.clipboard.writeText(u).then(()=>alert('✅ Link disalin!')):prompt('Copy:',u)};setTimeout(()=>{if(!le){document.getElementById('expWarn').classList.remove('hidden');let t=120;const et=setInterval(()=>{if(le){clearInterval(et);return}t--;document.getElementById('expC').textContent=t;if(t<=0){clearInterval(et);le=!0;clearInterval(timer);document.body.innerHTML='<div class="min-h-screen flex items-center justify-center p-4"><div class="bg-zinc-900 rounded-3xl p-10 text-center"><div class="text-6xl mb-6">⏰</div><h2 class="text-3xl font-bold text-red-500">Link Expired</h2><a href="/" class="block w-full py-4 bg-[#e63946] rounded-2xl text-white mt-6">🔙 Kembali</a></div></div>'}},1000)}},30000);setTimeout(()=>{if(!le&&cb.classList.contains('hidden'))document.getElementById('copyArea').classList.remove('hidden')},35000);history.pushState(null,'',location.href);window.addEventListener('popstate',()=>{if(!le)history.pushState(null,'',location.href)});</script></body></html>`;
        return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});
      }

      // ====================== SEARCH ======================
      if (pathname === '/search') {
        const q=url.searchParams.get('q')||''; let html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Pencarian - FilmViral</title>${getHistats()}${getPushNotification()}<script src="https://cdn.tailwindcss.com"></script><style>body{font-family:'Inter',system_ui,sans-serif}.accent{color:#e63946}</style></head><body class="bg-zinc-950 text-zinc-100">${getNavbar('/search')}<main class="max-w-screen-2xl mx-auto px-4 sm:px-8 py-10"><form method="GET" action="/search" class="mb-8 flex gap-4"><input type="text" name="q" value="${safeHTML(q)}" placeholder="Cari artikel..." class="flex-1 bg-zinc-800 rounded-2xl px-6 py-4 outline-none"><button type="submit" class="px-8 py-4 bg-[#e63946] rounded-2xl text-white">Cari</button></form>`;
        if(q){const results=await searchArticles(env,q);html+=`<h1 class="text-4xl font-semibold mb-8">Hasil: <span class="accent">${safeHTML(q)}</span></h1>`;if(results.length>0){html+=`<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">${results.map(a=>`<div class="bg-zinc-900 rounded-3xl overflow-hidden"><img src="${safeHTML(a.image)}" class="w-full aspect-video object-cover" alt=""><div class="p-5"><a href="/article/${safeHTML(a.slug)}" class="block text-xl font-bold hover:accent">${safeHTML(a.title)}</a></div></div>`).join('')}</div>`;}else{html+=`<p class="text-zinc-400 text-xl">Tidak ada hasil untuk "${safeHTML(q)}"</p>`;}}
        html+=`</main>${getMegaFooter()}</body></html>`; return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'public,max-age=120'}});
      }

      // ====================== ADMIN PANEL ======================
      if (pathname.startsWith('/admin')) {
        if(pathname==='/admin/login'){
          if(method==='GET'){const html=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Login Admin</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-zinc-950 flex items-center justify-center min-h-screen"><div class="bg-zinc-900 p-10 rounded-3xl w-96"><h1 class="text-4xl title-font text-center mb-8">FilmViral <span class="accent">Admin</span></h1><form method="POST"><input type="password" name="password" placeholder="Password" class="w-full bg-zinc-800 rounded-2xl px-6 py-4 mb-6 outline-none"><button type="submit" class="w-full py-4 bg-[#e63946] rounded-2xl text-white">Masuk</button></form></div></body></html>`;return new Response(html,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});}
          if(method==='POST'){let fd;try{fd=await request.clone().formData();}catch{fd=new FormData();}if(fd.get('password')===await env.MY_KV.get('admin:password')){const token=crypto.randomUUID();await env.MY_KV.put(`admin_session:${token}`,'1',{expirationTtl:86400});return new Response(null,{status:302,headers:{'Set-Cookie':`admin_session=${token};Path=/;HttpOnly;Secure;SameSite=Lax;Max-Age=86400`,'Location':'/admin?tab=dashboard'}});}return new Response('Password salah',{status:401});}
        }
        if(pathname==='/admin/logout'){const cookies=parseCookies(request.headers.get('Cookie')||'');if(cookies['admin_session'])await env.MY_KV.delete(`admin_session:${cookies['admin_session']}`);return new Response(null,{status:302,headers:{'Set-Cookie':'admin_session=;Path=/;Expires=Thu,01 Jan 1970 00:00:00 GMT','Location':'/admin/login'}});}
        if(!(await isAdmin(request,env)))return Response.redirect(new URL('/admin/login',request.url).toString(),302);

        if(method==='POST'){
          let fd;try{fd=await request.clone().formData();}catch{return new Response('Invalid',{status:400});}
          if(!(await validateCSRF(env,fd.get('csrf_token'))))return new Response('CSRF invalid',{status:403});
          
          if(pathname==='/admin/ai-generate'){
            const title=fd.get('title')||'',category=fd.get('category')||'action',image=fd.get('image')||'',targetUrl=fd.get('target_url')||'';
            if(!title)return new Response('Judul wajib diisi',{status:400});
            let generated={title,intro:`Nonton ${title} gratis. Film ${category} terbaru.`,content:`<h2>${title}</h2><p>Film ${category} terbaru yang sedang trending!</p><h3>Kenapa Harus Nonton?</h3><ul><li>Rating tinggi</li><li>Akting keren</li><li>Wajib ditonton</li></ul><h3>Cara Nonton</h3><p>Klik tombol <strong>DOWNLOAD GRATIS</strong> di bawah.</p>`,tags:[category,'film terbaru','nonton gratis']};
            try{const prompt=`Buat artikel film "${title}" kategori ${category}. Return ONLY JSON.`;const c=new AbortController();const t=setTimeout(()=>c.abort(),8000);const r=await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`,{signal:c.signal});clearTimeout(t);const text=await r.text();const m=text.match(/\{[\s\S]*\}/);if(m){const p=JSON.parse(m[0]);if(p.title&&p.content)generated=p;}}catch(e){}
            try{const fd2=new FormData();fd2.set('title',generated.title);fd2.set('intro',generated.intro);fd2.set('content',generated.content);fd2.set('category',category);fd2.set('image',image||'https://picsum.photos/800/600');fd2.set('target_url',targetUrl||'https://example.com/watch/'+Date.now());fd2.set('status','draft');const aid=await saveArticle(env,fd2);await invalidateCaches(env);return Response.redirect(new URL(`/admin?tab=edit&id=${aid}&ai=1`,request.url).toString(),302);}catch(err){return new Response(`Gagal: ${err.message}`,{status:500});}
          }
          if(pathname==='/admin/save'){await saveArticle(env,fd,fd.get('id')||undefined);await invalidateCaches(env);return Response.redirect(new URL('/admin?tab=articles',request.url).toString(),302);}
          if(pathname==='/admin/delete'){await deleteArticle(env,fd.get('id'));await invalidateCaches(env);return Response.redirect(new URL('/admin?tab=articles',request.url).toString(),302);}
          if(pathname==='/admin/config'){await Promise.all([env.MY_KV.put('config:delay',fd.get('delay')||'8'),env.MY_KV.put('config:home_limit',fd.get('home_limit')||'6'),env.MY_KV.put('config:related_limit',fd.get('related_limit')||'4')]);return Response.redirect(new URL('/admin?tab=config',request.url).toString(),302);}
          if(pathname==='/admin/ads'){await Promise.all([env.MY_KV.put('config:ads_home_top',fd.get('home_top')||''),env.MY_KV.put('config:ads_home_popular',fd.get('home_popular')||''),env.MY_KV.put('config:ads_header',fd.get('header')||''),env.MY_KV.put('config:ads_article',fd.get('article')||''),env.MY_KV.put('config:ads_footer',fd.get('footer')||''),env.MY_KV.put('config:ads_safelink_top',fd.get('safelink_top')||''),env.MY_KV.put('config:ads_safelink_bottom',fd.get('safelink_bottom')||''),env.MY_KV.put('config:ads_sticky',fd.get('sticky')||''),env.MY_KV.put('config:ads_popunder',fd.get('popunder')||'')]);return Response.redirect(new URL('/admin?tab=ads',request.url).toString(),302);}
        }

        const tab=url.searchParams.get('tab')||'dashboard';let bodyHTML='';
        if(tab==='dashboard'){const total=await getTotalArticles(env);bodyHTML=`<h1 class="text-4xl mb-6">Dashboard</h1><p class="text-zinc-400">Selamat datang di panel admin FilmViral.</p><div class="mt-8 p-6 bg-zinc-900 rounded-3xl"><p>Total Artikel Published: <strong class="text-white">${total}</strong></p><p class="text-sm text-zinc-500 mt-2">Database: D1 • AI: Pollinations • Giscus: ✅ • OneSignal: ✅ • AMP: ✅</p><a href="/admin?tab=articles" class="text-[#e63946] text-sm">Lihat Semua Artikel →</a></div>`;}
        else if(tab==='articles'){const csrf=await generateCSRF(env);const ids=await getLatestIds(env,200,true);const all=await Promise.all(ids.map(id=>getArticleById(env,id)));let list='';all.forEach(a=>{if(a)list+=`<div class="flex justify-between items-center py-4 border-b border-zinc-800"><div><span class="font-medium">${safeHTML(a.title)}</span> <span class="text-xs ${a.status==='draft'?'text-yellow-400':'text-zinc-500'}">(${a.status==='draft'?'📝 Draft':'✅ Published'})</span></div><div class="flex gap-4"><a href="/admin?tab=edit&id=${a.id}" class="text-[#e63946] hover:underline">Edit</a><form method="POST" action="/admin/delete" class="inline" onsubmit="return confirm('Yakin?')"><input type="hidden" name="csrf_token" value="${csrf}"><input type="hidden" name="id" value="${a.id}"><button class="text-red-500 hover:underline">Hapus</button></form></div></div>`;});bodyHTML=`<h2 class="text-3xl mb-8">Daftar Artikel</h2><div class="flex gap-4 mb-8"><a href="/admin?tab=new" class="px-6 py-3 bg-[#e63946] rounded-2xl text-white">+ Manual</a><a href="/admin?tab=ai" class="px-6 py-3 bg-emerald-600 rounded-2xl text-white">🤖 AI Generator</a></div><div class="space-y-2">${list||'<p class="text-zinc-400">Belum ada</p>'}</div>`;}
        else if(tab==='new'||tab==='edit'){const id=url.searchParams.get('id')||'';const article=id?await getArticleById(env,id):null;const csrf=await generateCSRF(env);const targetUrl=article?await getTargetUrl(env,article.safelink_id)||'':'';const aiGenerated=url.searchParams.get('ai')==='1';bodyHTML=`<form method="POST" action="/admin/save"><input type="hidden" name="csrf_token" value="${csrf}"><input type="hidden" name="id" value="${id}">${aiGenerated?'<div class="bg-emerald-900/30 border border-emerald-600 p-4 rounded-2xl mb-6"><p class="text-emerald-400">🤖 Artikel di-generate AI. Edit lalu publish!</p></div>':''}<input type="text" name="title" value="${article?safeHTML(article.title):''}" placeholder="Judul" class="block w-full mb-4 bg-zinc-800 p-5 rounded-2xl text-lg"><input type="text" name="image" value="${article?safeHTML(article.image):''}" placeholder="URL Gambar" class="block w-full mb-4 bg-zinc-800 p-5 rounded-2xl"><textarea name="intro" class="block w-full h-24 mb-4 bg-zinc-800 p-5 rounded-2xl">${article?safeHTML(article.intro):''}</textarea><textarea name="content" class="block w-full h-96 mb-6 bg-zinc-800 p-5 rounded-2xl">${article?safeHTML(article.content):''}</textarea><select name="category" class="block w-full mb-4 bg-zinc-800 p-5 rounded-2xl"><option value="action" ${article?.category==='action'?'selected':''}>Action</option><option value="drama" ${article?.category==='drama'?'selected':''}>Drama</option><option value="horor" ${article?.category==='horor'?'selected':''}>Horor</option><option value="komedi" ${article?.category==='komedi'?'selected':''}>Komedi</option></select><input type="text" name="safelink_id" value="${article?safeHTML(article.safelink_id):''}" placeholder="Safelink ID" class="block w-full mb-4 bg-zinc-800 p-5 rounded-2xl"><input type="text" name="target_url" value="${safeHTML(targetUrl)}" placeholder="URL Tujuan" class="block w-full mb-6 bg-zinc-800 p-5 rounded-2xl"><select name="status" class="block w-full mb-6 bg-zinc-800 p-5 rounded-2xl"><option value="published" ${article?.status==='published'?'selected':''}>✅ Published</option><option value="draft" ${article?.status==='draft'?'selected':''}>📝 Draft</option></select><button type="submit" class="px-10 py-4 bg-[#e63946] text-white rounded-2xl">Simpan</button></form>`;}
        else if(tab==='ai'){const csrf=await generateCSRF(env);bodyHTML=`<div class="max-w-4xl"><h2 class="text-3xl mb-2">🤖 AI Article Generator</h2><p class="text-zinc-400 mb-6">Generate artikel otomatis. Disimpan sebagai draft.</p><div class="bg-zinc-900 rounded-3xl p-6 mb-8"><form method="POST" action="/admin/ai-generate"><input type="hidden" name="csrf_token" value="${csrf}"><div class="mb-4"><label class="block text-zinc-400 mb-2">🎬 Judul Film</label><input type="text" name="title" placeholder="Contoh: Film Horor Thailand 2024" class="block w-full bg-zinc-800 p-5 rounded-2xl text-lg" required></div><div class="mb-4"><label class="block text-zinc-400 mb-2">📂 Kategori</label><select name="category" class="block w-full bg-zinc-800 p-5 rounded-2xl"><option value="action">🎬 Action</option><option value="drama">🎭 Drama</option><option value="horor">👻 Horor</option><option value="komedi">😂 Komedi</option></select></div><div class="mb-4"><label class="block text-zinc-400 mb-2">🖼️ URL Gambar (opsional)</label><input type="text" name="image" placeholder="https://..." class="block w-full bg-zinc-800 p-5 rounded-2xl"></div><div class="mb-4"><label class="block text-zinc-400 mb-2">🔗 URL Tujuan (opsional)</label><input type="text" name="target_url" placeholder="https://..." class="block w-full bg-zinc-800 p-5 rounded-2xl"></div><button type="submit" class="px-8 py-4 bg-gradient-to-r from-[#e63946] to-red-600 text-white rounded-2xl font-medium text-lg">🤖 Generate Artikel</button></form></div></div>`;}
        else if(tab==='config'){const config=await getConfig(env);const csrf=await generateCSRF(env);bodyHTML=`<form method="POST" action="/admin/config"><input type="hidden" name="csrf_token" value="${csrf}"><label class="block mb-1 text-zinc-400">Delay Safelink (detik)</label><input type="number" name="delay" value="${config.delay}" class="block w-full mb-6 bg-zinc-800 p-5 rounded-2xl"><label class="block mb-1 text-zinc-400">Artikel per Halaman</label><input type="number" name="home_limit" value="${config.homeLimit}" class="block w-full mb-6 bg-zinc-800 p-5 rounded-2xl"><label class="block mb-1 text-zinc-400">Artikel Terkait</label><input type="number" name="related_limit" value="${config.relatedLimit}" class="block w-full mb-6 bg-zinc-800 p-5 rounded-2xl"><button type="submit" class="px-10 py-4 bg-[#e63946] text-white rounded-2xl">Simpan</button></form>`;}
        else if(tab==='ads'){const adsData=await getAdsFresh(env);const csrf=await generateCSRF(env);bodyHTML=`<form method="POST" action="/admin/ads"><input type="hidden" name="csrf_token" value="${csrf}"><h2 class="text-2xl mb-6 accent">Kelola Iklan</h2><div class="bg-yellow-900/30 border border-yellow-600 p-5 rounded-2xl mb-8"><h3 class="text-yellow-400 text-lg">🔥 Popunder Ad</h3><p class="text-yellow-500 text-xs mb-3">Halaman: Safelink • Sebelum &lt;/head&gt;</p><textarea name="popunder" class="block w-full h-32 bg-zinc-800 p-5 rounded-2xl text-sm">${safeHTML(adsData.popunder||'')}</textarea></div><label class="block mb-1 text-zinc-400">🏠 Home Top (728×90)</label><textarea name="home_top" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.home_top)}</textarea><label class="block mb-1 text-zinc-400">📊 Home Sidebar (300×250)</label><textarea name="home_popular" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.home_popular)}</textarea><label class="block mb-1 text-zinc-400">📄 Artikel Header (728×90)</label><textarea name="header" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.header)}</textarea><label class="block mb-1 text-zinc-400">📝 Artikel In-Content (300×250)</label><textarea name="article" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.article)}</textarea><label class="block mb-1 text-zinc-400">🔚 Footer (728×90)</label><textarea name="footer" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.footer)}</textarea><label class="block mb-1 text-zinc-400">🔗 Safelink Top (320×50)</label><textarea name="safelink_top" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.safelink_top)}</textarea><label class="block mb-1 text-zinc-400">🔗 Safelink Bottom (300×250)</label><textarea name="safelink_bottom" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.safelink_bottom)}</textarea><label class="block mb-1 text-zinc-400">📱 Sticky Mobile (320×50)</label><textarea name="sticky" class="block w-full h-32 mb-6 bg-zinc-800 p-5 rounded-2xl">${safeHTML(adsData.sticky)}</textarea><button type="submit" class="px-10 py-4 bg-[#e63946] text-white rounded-2xl">Simpan</button></form>`;}
        
        const sidebar=`<div class="w-64 bg-zinc-900 p-6 min-h-screen"><div class="mb-8"><h2 class="text-2xl title-font">Film<span class="accent">Viral</span></h2><p class="text-xs text-zinc-500 mt-1">Admin Panel</p></div><a href="/admin?tab=dashboard" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='dashboard'?'bg-zinc-800':''}">📊 Dashboard</a><a href="/admin?tab=ai" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='ai'?'bg-zinc-800':''}">🤖 AI Generator</a><a href="/admin?tab=articles" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='articles'?'bg-zinc-800':''}">📝 Daftar Artikel</a><a href="/admin?tab=new" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='new'?'bg-zinc-800':''}">➕ Artikel Manual</a><a href="/admin?tab=config" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='config'?'bg-zinc-800':''}">⚙️ Konfigurasi</a><a href="/admin?tab=ads" class="block py-3 px-4 hover:bg-zinc-800 rounded-2xl mb-1 ${tab==='ads'?'bg-zinc-800':''}">💰 Kelola Iklan</a><hr class="my-4 border-zinc-800"><a href="/admin/logout" class="block py-3 px-4 text-red-500 hover:bg-zinc-800 rounded-2xl">🚪 Logout</a></div>`;
        const fullHTML=`<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Admin FilmViral</title><meta name="robots" content="noindex,nofollow"><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-zinc-950 text-zinc-100 flex">${sidebar}<div class="flex-1 p-10">${bodyHTML}</div></body></html>`;
        return new Response(fullHTML,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}});
      }

      return new Response('404 Not Found',{status:404});
    } catch(err){console.error(err);return new Response('Internal Server Error',{status:500});}
  }
};