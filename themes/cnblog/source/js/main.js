(function () {
  'use strict';

  // 诗句：按来源取（内置 / 一言 API / 仓库 motto.txt）
  var mottoEl = document.querySelector('.site-motto');
  var fromEl = document.querySelector('.site-from');
  if (mottoEl) {
    var source = mottoEl.dataset.source || 'builtin';

    var applyMotto = function (text, from) {
      if (!text) return;
      mottoEl.textContent = text;
      if (fromEl && from) fromEl.textContent = from;
    };

    if (source === 'api') {
      var api = mottoEl.dataset.api;
      if (api) {
        fetch(api, { mode: 'cors' })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var text = d.hitokoto || d.text || d.motto || '';
            var from = d.from || d.from_who || d.source || '';
            applyMotto(text, from);
          })
          .catch(function () { /* 接口挂了就保留首屏那句 */ });
      }
    } else if (source === 'txt') {
      fetch(mottoEl.dataset.txt || '/motto.txt')
        .then(function (r) { return r.text(); })
        .then(function (txt) {
          var lines = txt.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
          if (!lines.length) return;
          var pick = lines[Math.floor(Math.random() * lines.length)];
          // 格式：句子 —— 出处（破折号后可省，-- 与单个 — 也认）
          var m = pick.match(/^(.*?)\s*(?:——|—|--)\s*(.+)$/);
          if (m) applyMotto(m[1].trim(), m[2].trim());
          else applyMotto(pick, '');
        })
        .catch(function () { /* 文件缺失保留首屏那句 */ });
    } else {
      var list = [];
      try {
        list = JSON.parse(decodeURIComponent(mottoEl.dataset.mottos || '[]'));
      } catch (e) { list = []; }
      if (list.length > 1) {
        var pick = list[Math.floor(Math.random() * list.length)];
        applyMotto(pick.text, pick.from);
      }
    }
  }

  // 滚动后导航栏由透明变实底
  var navbar = document.getElementById('navbar');
  if (navbar) {
    var onScroll = function () {
      navbar.classList.toggle('scrolled', window.scrollY > 60);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // MENU：桌面收起/展开侧栏，移动端滑出抽屉
  var menuBtn = document.getElementById('menuBtn');
  var sidebarMask = document.getElementById('sidebarMask');
  function toggleSidebar() {
    if (window.innerWidth <= 960) {
      document.body.classList.toggle('sidebar-open');
    } else {
      document.body.classList.toggle('sidebar-collapsed');
    }
  }
  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }
  if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
  if (sidebarMask) sidebarMask.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSidebar();
  });

  // 深色模式
  var themeBtn = document.getElementById('themeBtn');
  var STORAGE_KEY = 'cnblog-theme';

  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    if (themeBtn) themeBtn.textContent = dark ? '☀' : '☾';
  }

  var saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'dark') applyTheme(true);
  else if (saved === 'light') applyTheme(false);
  else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme(true);

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var dark = !document.body.classList.contains('dark');
      applyTheme(dark);
      localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
    });
  }

  // 目录滚动高亮
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc-wrap .toc-link'));
  if (tocLinks.length) {
    var headingMap = {};
    tocLinks.forEach(function (link) {
      var id = decodeURIComponent((link.getAttribute('href') || '').replace(/^#/, ''));
      var el = document.getElementById(id);
      if (el) headingMap[id] = link;
    });

    var current = null;
    function updateActive() {
      var passed = null;
      Object.keys(headingMap).forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) passed = id;
      });
      var next = passed ? headingMap[passed] : null;
      if (next === current) return;
      if (current) current.classList.remove('active');
      if (next) {
        next.classList.add('active');
        // 让高亮项在目录里保持可见
        var wrap = next.closest('.toc-wrap');
        if (wrap) {
          var top = next.offsetTop - wrap.clientHeight / 2;
          if (Math.abs(wrap.scrollTop - top) > wrap.clientHeight / 2) wrap.scrollTop = Math.max(0, top);
        }
      }
      current = next;
    }

    window.addEventListener('scroll', updateActive, { passive: true });
    updateActive();

    // 点击平滑滚动，抵消固定导航栏的高度
    tocLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        var id = decodeURIComponent((link.getAttribute('href') || '').replace(/^#/, ''));
        var el = document.getElementById(id);
        if (!el) return;
        e.preventDefault();
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
        history.replaceState(null, '', '#' + id);
      });
    });
  }
})();
