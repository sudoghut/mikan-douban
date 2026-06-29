// ==UserScript==
// @name         蜜柑计划 → 豆瓣 链接
// @namespace    https://github.com/sudoghut/mikan-douban
// @version      0.2.3
// @description  在蜜柑计划首页为每部番剧优雅地附上一个跳转到豆瓣的链接（解析为 subject 直链，失败回退搜索）
// @author       sudoghut
// @license      MIT
// @homepageURL  https://github.com/sudoghut/mikan-douban
// @supportURL   https://github.com/sudoghut/mikan-douban/issues
// @match        https://mikanani.me/
// @icon         https://www.douban.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      movie.douban.com
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // ---------- 配置 ----------
    const PROCESSED_FLAG = 'mikanDoubanDone';
    const CACHE_PREFIX = 'mikan-douban:v1:';   // 缓存键前缀（含版本，便于将来失效）
    const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 缓存有效期：30 天
    const REQUEST_GAP = 400;                     // 相邻豆瓣请求的最小间隔（ms），节流防封
    const REQUEST_TIMEOUT = 12000;               // 单次请求超时（ms）

    // ---------- GM 兼容 ----------
    const gmGet = (typeof GM_getValue === 'function')
        ? GM_getValue
        : (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
    const gmSet = (typeof GM_setValue === 'function')
        ? GM_setValue
        : (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
    const gmXhr = (typeof GM_xmlhttpRequest === 'function')
        ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);

    // ---------- URL 构造 ----------
    function searchUrl(title) {
        return 'https://search.douban.com/movie/subject_search?search_text=' +
            encodeURIComponent(title) + '&cat=1002';
    }
    function subjectUrl(id) {
        return 'https://movie.douban.com/subject/' + id + '/';
    }
    function parseBangumiId(href) {
        const m = /\/Home\/Bangumi\/(\d+)/i.exec(href || '');
        return m ? m[1] : '';
    }

    // ---------- 缓存 ----------
    function cacheKey(title) {
        return CACHE_PREFIX + title;
    }
    function readCache(title) {
        const rec = gmGet(cacheKey(title), null);
        if (!rec || typeof rec !== 'object') return null;
        if (typeof rec.ts !== 'number' || (Date.now() - rec.ts) > CACHE_TTL) return null;
        return rec; // { id: string|null, dtitle, year }
    }
    function writeCache(title, rec) {
        rec.ts = Date.now();
        gmSet(cacheKey(title), rec);
    }

    // ---------- 标题归一化 & 匹配 ----------
    // 去掉常见季度/特典后缀的干扰词，便于做精确匹配判断（不改变送给豆瓣的原始查询）
    function normalize(s) {
        return (s || '')
            .toLowerCase()
            .replace(/[\s　:：!！?？.。、，,~～\-—_（）()【】\[\]「」『』]/g, '')
            .trim();
    }

    // 从豆瓣 suggest 结果里挑最佳：精确同名优先，其次包含关系，再次第一条
    function pickBest(list, title) {
        if (!Array.isArray(list) || list.length === 0) return null;
        const items = list.filter(x => x && x.id && /^\d+$/.test(String(x.id)));
        if (items.length === 0) return null;

        const nt = normalize(title);
        let hit = items.find(x => normalize(x.title) === nt);
        if (!hit) hit = items.find(x => { const n = normalize(x.title); return n && (n.startsWith(nt) || nt.startsWith(n)); });
        if (!hit) hit = items[0];
        return { id: String(hit.id), dtitle: hit.title || '', year: hit.year || '' };
    }

    // ---------- 豆瓣 suggest 请求（带串行节流队列） ----------
    let lastRequestAt = 0;
    const queue = [];
    let draining = false;

    function enqueue(task) {
        queue.push(task);
        drain();
    }
    function drain() {
        if (draining) return;
        draining = true;
        const step = () => {
            const task = queue.shift();
            if (!task) { draining = false; return; }
            const wait = Math.max(0, REQUEST_GAP - (Date.now() - lastRequestAt));
            setTimeout(() => {
                lastRequestAt = Date.now();
                // done 去重 + 看门狗：即使任务回调丢失也不会卡死队列
                let called = false;
                const done = () => { if (called) return; called = true; clearTimeout(watchdog); step(); };
                const watchdog = setTimeout(done, REQUEST_TIMEOUT + 2000);
                try { task(done); } catch (e) { done(); }
            }, wait);
        };
        step();
    }

    // 回调返回结构化结果：{ kind: 'hit', rec } | { kind: 'miss' } | { kind: 'error' }
    // 只有 miss（真·无结果）才允许负缓存；error（超时/HTTP错/反爬/解析失败）不缓存，下次可重试
    function fetchSuggest(title, cb) {
        if (!gmXhr) { cb({ kind: 'error' }); return; }
        const url = 'https://movie.douban.com/j/subject_suggest?q=' + encodeURIComponent(title);
        gmXhr({
            method: 'GET',
            url: url,
            timeout: REQUEST_TIMEOUT,
            headers: { 'Referer': 'https://movie.douban.com/' },
            onload: (res) => {
                if (!res || res.status < 200 || res.status >= 300) { cb({ kind: 'error' }); return; }
                let data = null;
                try { data = JSON.parse(res.responseText); } catch (e) { cb({ kind: 'error' }); return; }
                if (!Array.isArray(data)) { cb({ kind: 'error' }); return; } // 非数组多为反爬/异常页
                if (data.length === 0) { cb({ kind: 'miss' }); return; }     // 空数组=真·无结果
                const rec = pickBest(data, title);
                // 非空数组却挑不出合法条目，多半是 schema 变了，按错误处理（不负缓存）
                cb(rec ? { kind: 'hit', rec } : { kind: 'error' });
            },
            onerror: () => cb({ kind: 'error' }),
            ontimeout: () => cb({ kind: 'error' }),
        });
    }

    // ---------- 视图层 ----------
    function applyDirect(badge, rec) {
        badge.href = subjectUrl(rec.id);
        badge.classList.add('mikan-douban-direct');
        const label = rec.dtitle ? (rec.dtitle + (rec.year ? ' (' + rec.year + ')' : '')) : '';
        badge.title = '豆瓣' + (label ? '：' + label : '条目');
    }

    function resolve(badge, title) {
        // 1) 命中缓存
        const cached = readCache(title);
        if (cached) {
            if (cached.id) applyDirect(badge, cached);
            return; // 负缓存则保持搜索兜底
        }
        // 2) 没有 IntersectionObserver 时直接发起请求
        if (!intersect) { request(badge, title); return; }
        // 3) 进入可视区后再请求（避免重复 observe）
        if (pending.has(badge)) return;
        pending.set(badge, title);
        intersect.observe(badge);
    }

    // 按标题合并请求：同名的多个徽标只发一次，结果分发给所有等待者
    const inflight = new Map(); // title -> badge[]
    function request(badge, title) {
        const cached = readCache(title); // 可能已被同名兄弟填充
        if (cached) {
            if (cached.id) applyDirect(badge, cached);
            return;
        }
        if (inflight.has(title)) { inflight.get(title).push(badge); return; }
        inflight.set(title, [badge]);
        enqueue((done) => fetchSuggest(title, (result) => {
            const waiters = inflight.get(title) || [badge];
            inflight.delete(title);
            handleResult(title, result, waiters);
            done();
        }));
    }

    function handleResult(title, result, badges) {
        if (result.kind === 'hit') {
            const rec = result.rec;
            writeCache(title, { id: rec.id, dtitle: rec.dtitle, year: rec.year });
            badges.forEach((b) => { if (b.isConnected) applyDirect(b, rec); });
        } else if (result.kind === 'miss') {
            writeCache(title, { id: null }); // 真·无结果才负缓存
        }
        // error：不缓存，保留搜索兜底，下次仍可重试
    }

    const pending = new Map(); // badge -> title
    const intersect = ('IntersectionObserver' in window)
        ? new IntersectionObserver((entries) => {
            for (const e of entries) {
                if (!e.isIntersecting) continue;
                const badge = e.target;
                intersect.unobserve(badge);
                const title = pending.get(badge);
                pending.delete(badge);
                if (!title) continue;
                request(badge, title);
            }
        }, { rootMargin: '200px' })
        : null;

    // ---------- 样式 ----------
    function injectStyle() {
        if (document.getElementById('mikan-douban-style')) return;
        const style = document.createElement('style');
        style.id = 'mikan-douban-style';
        style.textContent = `
            .mikan-douban-badge {
                box-sizing: border-box;
                /* 绝对定位钉在订阅图标左侧：图标宽30 + 右距10 + 间距6 = 距右 46px。
                   .an-info 自身是 position:absolute，作为定位容器；不受标题长度/浮动影响 */
                position: absolute;
                top: 7px;                     /* 与 30px 高的订阅图标垂直居中对齐（中心均为 18px） */
                right: 46px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 5px;           /* 与订阅图标一致的圆角 */
                background: #9aa0a6;
                color: #fff !important;
                font-size: 12px;
                line-height: 1;
                font-weight: 700;
                text-decoration: none !important;
                cursor: pointer;
                transition: opacity .15s ease, background .15s ease;
            }
            .mikan-douban-badge:hover { opacity: .85; }
            .mikan-douban-badge.mikan-douban-direct { background: #007722; }
            /* 给豆瓣徽标腾出空间：标题宽度收窄，更早省略号截断，避免文字顶到徽标 */
            .an-ul li .an-info .an-text { width: 88px !important; }
        `;
        document.head.appendChild(style);
    }

    // ---------- 卡片装饰 ----------
    function decorate(anText) {
        const info = anText.closest('.an-info');
        if (!info || info.dataset[PROCESSED_FLAG]) return;
        info.dataset[PROCESSED_FLAG] = '1';

        const title = (anText.getAttribute('title') || anText.textContent || '').trim();
        if (!title) return;

        const badge = document.createElement('a');
        badge.className = 'mikan-douban-badge';
        badge.textContent = '豆';
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.href = searchUrl(title);                 // 先给搜索兜底，保证随时可点
        badge.title = '豆瓣搜索：' + title;
        badge.dataset.bangumiid = parseBangumiId(anText.getAttribute('href'));

        const icon = info.querySelector('.an-info-icon');
        if (icon) {
            icon.insertAdjacentElement('afterend', badge);
        } else {
            const group = anText.closest('.an-info-group') || info;
            group.appendChild(badge);
        }

        resolve(badge, title); // 尝试升级为直链
    }

    function scan(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('a.an-text').forEach(decorate);
    }

    function observe() {
        const target = document.getElementById('an-list') || document.body;
        if (!target) return;
        const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.matches && node.matches('a.an-text')) {
                        decorate(node);
                    } else if (node.querySelectorAll) {
                        scan(node);
                    }
                }
            }
        });
        mo.observe(target, { childList: true, subtree: true });
    }

    function init() {
        injectStyle();
        scan(document);
        observe();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
