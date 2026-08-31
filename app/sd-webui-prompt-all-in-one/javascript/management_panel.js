/*
 * 自定义提示词库管理面板 v2 + 收藏移除修复（注入 sd-webui-prompt-all-in-one）
 * 功能：多文件管理 / 分类折叠 / 关键字复制到其他分类 / 免费翻译 / 颜色选择器
 */
(function () {
  'use strict';

  var API_BASE = '/physton_prompt/manage/group_tags';
  var DATA = [];
  var FILE_LIST = [];
  var CURRENT_FILE = 'prepend.yaml';
  var panelEl = null;
  var collapsed = {};
  var pendingCopyTo = null;
  var groupCollapsed = {};
  var pendingFocus = null;
  var ignoredDups = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function httpGet(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }
  function httpPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); });
  }
  function normalizeTags(t) {
    var arr = [];
    if (Array.isArray(t)) { t.forEach(function (x) { arr.push({ k: x.k, v: x.v }); }); }
    else if (t && typeof t === 'object') { Object.keys(t).forEach(function (k) { arr.push({ k: k, v: t[k] }); }); }
    return arr;
  }
  function normalizeData(data) {
    return (data || []).map(function (cat) {
      var groups = (cat.groups || []).map(function (g) {
        var o = { name: g.name, tags: normalizeTags(g.tags) };
        if (g.color) o.color = g.color;
        return o;
      });
      return { name: cat.name, groups: groups };
    });
  }
  function counts() {
    var cats = DATA.length, groups = 0, tags = 0;
    DATA.forEach(function (c) { groups += (c.groups || []).length; (c.groups || []).forEach(function (g) { tags += (g.tags || []).length; }); });
    return { cats: cats, groups: groups, tags: tags };
  }
  function collapseAll() {
    collapsed = {};
    DATA.forEach(function (_, i) { collapsed[i] = true; });
  }
  function moveItem(arr, from, dir) {
    var to = from + dir;
    if (to < 0 || to >= arr.length) return;
    var t = arr[from]; arr[from] = arr[to]; arr[to] = t;
  }
  function copyItem(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'aio-toast';
    t.textContent = msg;
    if (isErr) t.style.background = '#7f1d1d';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function colorToHex(c) {
    if (!c) return '#000000';
    var m;
    if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return c.toLowerCase();
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return '#' + m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2];
    if ((m = /rgba?\(([^)]+)\)/i.exec(c))) {
      var p = m[1].split(',').map(function (s) { return s.trim(); });
      var r = parseInt(p[0], 10), g = parseInt(p[1], 10), b = parseInt(p[2], 10);
      if (isNaN(r) || isNaN(g) || isNaN(b)) return '#000000';
      return '#' + [r, g, b].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    }
    return '#000000';
  }
  function alphaFromText(t) {
    var m = /rgba?\(([^)]+)\)/i.exec(t || '');
    if (m) {
      var parts = m[1].split(',').map(function (s) { return s.trim(); });
      if (parts.length === 4) {
        var a = parseFloat(parts[3]);
        if (!isNaN(a)) return a;
      }
    }
    return 0.4;
  }
  function pickerToRgba(hex, prev) {
    hex = String(hex || '').replace('#', '');
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
    var a = alphaFromText(prev);
    var aStr = (a === Math.round(a)) ? String(a) : String(a).replace(/^0\./, '.');
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + aStr + ')';
  }
  function injectCSS() {
    var id = 'aio-manage-css';
    if (document.getElementById(id)) return;
    var css = [
      '#aioManageBtn{position:fixed;right:18px;bottom:18px;z-index:99999;background:#6c5ce7;color:#fff;border:none;border-radius:24px;padding:10px 18px;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(108,92,231,.5);font-family:inherit;}',
      '#aioManageBtn:hover{background:#5a4bd1;}',


      '#aioThemeToggle{position:fixed;top:12px;right:14px;z-index:99999;width:40px;height:40px;border-radius:20px;border:1px solid var(--aio-border);background:var(--aio-panel);color:var(--aio-text);font-size:18px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.15);display:flex;align-items:center;justify-content:center;font-family:inherit;}',
      '#aioThemeToggle:hover{border-color:#6c5ce7;}',
      ':root{--aio-bg:#ffffff;--aio-panel:#ffffff;--aio-text:#1f2329;--aio-mut:#5f6672;--aio-border:#e2e5ea;--aio-input:#ffffff;--aio-cat:#f7f8fa;--aio-cathead:#eef0f3;--aio-group:#fafbfc;--aio-danger:#e5484d;--aio-trans:#0b7ac4;--aio-mask:rgba(15,23,42,.35);--aio-shadow:0 10px 40px rgba(0,0,0,.18);}',
      'body.dark{--aio-bg:#1e1f24;--aio-panel:#1e1f24;--aio-text:#e8e8ea;--aio-mut:#9aa0ab;--aio-border:#3a3d45;--aio-input:#191b20;--aio-cat:#24262c;--aio-cathead:#2b2e35;--aio-group:#202228;--aio-danger:#ff6b6b;--aio-trans:#38bdf8;--aio-mask:rgba(0,0,0,.55);--aio-shadow:0 10px 40px rgba(0,0,0,.5);}',
      'body.dark.physton-gradio-container{background:#171717 !important;background-image:none !important;}',
      '#aioManageMask{position:fixed;inset:0;background:var(--aio-mask);z-index:100000;display:none;align-items:flex-start;justify-content:center;padding:30px 10px;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '#aioManageMask.open{display:flex;}',
      '#aioManagePanel{width:960px;max-width:96vw;background:var(--aio-panel);border:1px solid var(--aio-border);border-radius:12px;box-shadow:var(--aio-shadow);color:var(--aio-text);font-size:14px;line-height:1.5;}',
      '#aioManageHead{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--aio-border);}',
      '#aioManageHead h3{margin:0;font-size:16px;color:var(--aio-text);display:flex;align-items:center;gap:8px;}',
      '#aioManageHead .aio-stat{font-size:12px;color:var(--aio-mut);font-weight:normal;margin-left:8px;}',
      '#aioManageHead .aio-close{background:none;border:none;color:var(--aio-mut);font-size:20px;cursor:pointer;line-height:1;}',
      '#aioManageHead .aio-close:hover{color:var(--aio-text);}',
      '#aioManageBar{padding:10px 18px;border-bottom:1px solid var(--aio-border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '#aioManageBar .aio-filesel{width:210px;}',
      '.aio-btn{background:var(--aio-input);color:var(--aio-text);border:1px solid var(--aio-border);border-radius:6px;padding:5px 12px;font-size:13px;cursor:pointer;font-family:inherit;}',
      '.aio-btn:hover{border-color:#6c5ce7;color:var(--aio-text);}',
      '.aio-btn.primary{background:#6c5ce7;border-color:#6c5ce7;color:#fff;}',
      '.aio-btn.primary:hover{background:#5a4bd1;}',
      '.aio-btn.danger{color:var(--aio-danger);}',
      '.aio-btn.danger:hover{border-color:var(--aio-danger);}',
      '.aio-btn.sm{padding:2px 8px;font-size:12px;}',
      '.aio-btn.trans{color:var(--aio-trans);border-color:var(--aio-trans);}',
      '.aio-btn.trans:hover{border-color:var(--aio-trans);}',
      '#aioManagePanel select{background:var(--aio-input);color:var(--aio-text);border:1px solid var(--aio-border);border-radius:5px;padding:4px 8px;font-size:13px;font-family:inherit;}',
      '#aioManagePanel select option{background:var(--aio-input);color:var(--aio-text);}',
      '.aio-addtag-bottom{width:100%;margin-top:8px;padding:7px 12px;font-size:13px;border-style:dashed;}',
      '.aio-addtag-bottom:hover{border-color:#6c5ce7;color:var(--aio-text);}',
      '.aio-copyto label{display:flex;align-items:center;gap:4px;color:var(--aio-mut);font-size:12px;cursor:pointer;user-select:none;}',
      '#aioManageBody{padding:14px 18px;max-height:62vh;overflow:auto;background:var(--aio-panel);}',
      '.aio-group.collapsed .aio-group-body{display:none;}',
      '.aio-group-toggle{background:none;border:none;color:var(--aio-mut);cursor:pointer;font-size:12px;padding:2px 4px;line-height:1;flex:0 0 auto;}',
      '.aio-group-toggle:hover{color:var(--aio-text);}',
      '.aio-empty{color:var(--aio-mut);text-align:center;padding:30px 0;}',
      '.aio-jump-wrap{margin-bottom:10px;}',
      '.aio-jump{width:240px;}',
      '.aio-cat{background:var(--aio-cat);border:1px solid var(--aio-border);border-radius:8px;margin-bottom:12px;overflow:hidden;}',
      '.aio-cat-head{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--aio-cathead);flex-wrap:wrap;}',
      '.aio-cat-head .aio-name{flex:1;min-width:120px;}',
      '.aio-toggle{background:none;border:none;color:var(--aio-mut);cursor:pointer;font-size:12px;padding:2px 4px;line-height:1;}',
      '.aio-toggle:hover{color:var(--aio-text);}',
      '.aio-cat.collapsed .aio-cat-body{display:none;}',
      '.aio-input{background:var(--aio-input);border:1px solid var(--aio-border);color:var(--aio-text);border-radius:5px;padding:4px 8px;font-size:13px;font-family:inherit;width:100%;}',
      '.aio-input:focus{outline:none;border-color:#6c5ce7;}',
      '.aio-cat-body{padding:8px 12px;}',
      '.aio-group{border:1px dashed var(--aio-border);border-radius:6px;margin-bottom:8px;background:var(--aio-group);padding:6px 10px;}',
      '.aio-group-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;}',
      '.aio-group-head .aio-name{flex:1;min-width:110px;}',
      '.aio-color{width:84px;flex:0 0 84px;}',
      '.aio-color-pick{width:36px;height:30px;flex:0 0 36px;padding:0;border:1px solid var(--aio-border);border-radius:5px;background:var(--aio-input);cursor:pointer;}',
      '.aio-tag-row{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap;}',
      '.aio-tag-row .aio-key{flex:1 1 22%;min-width:90px;}',
      '.aio-tag-row .aio-val{flex:1 1 22%;min-width:90px;}',
      '.aio-trans-inline{flex:0 0 auto;margin:0 2px;padding:3px 5px;font-size:11px;white-space:nowrap;}',
      '.aio-tags-scroll{max-height:340px;overflow-y:auto;overflow-x:hidden;}',
      '.aio-tags-scroll::-webkit-scrollbar{width:6px;}',
      '.aio-tags-scroll::-webkit-scrollbar-thumb{background:var(--aio-border);border-radius:3px;}',
      '.aio-tags-scroll::-webkit-scrollbar-track{background:transparent;}',
      '.aio-tag-row .aio-ops{display:flex;gap:4px;flex:0 0 auto;}',
      '.aio-copyto{background:var(--aio-input);border:1px solid var(--aio-border);border-radius:6px;padding:6px 10px;margin:4px 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.aio-copyto .aio-copyto-sel{width:280px;}',
      '.aio-tag-label{font-size:12px;color:var(--aio-mut);margin:6px 0 2px;}',
      '#aioManageFoot{padding:12px 18px;border-top:1px solid var(--aio-border);display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:var(--aio-panel);border-radius:0 0 12px 12px;}',
      '.aio-toast{position:fixed;top:60px;left:50%;transform:translateX(-50%);background:var(--aio-panel);color:var(--aio-text);border:1px solid var(--aio-border);padding:8px 18px;border-radius:6px;z-index:100001;box-shadow:var(--aio-shadow);font-size:13px;}',
      '/* 主页面二级分组区域限制高度，约5行，响应式滚动 */',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-body{max-height:180px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-body::-webkit-scrollbar{width:5px;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-body::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.4);border-radius:3px;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-body::-webkit-scrollbar-track{background:transparent;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-body .sub-group-main .group-tags{max-height:none;}',
      '@media (max-width:768px){.physton-prompt .group-tabs .group-body .group-main .sub-group-body{max-height:150px;}}',
      '@media (min-width:1600px){.physton-prompt .group-tabs .group-body .group-main .sub-group-body{max-height:210px;}}',
      '/* 二级分组标签：一行横滚，不换行 */',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-header{display:flex;flex-wrap:nowrap !important;overflow-x:auto !important;overflow-y:hidden;scrollbar-width:thin;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-header .sub-group-tab{flex:0 0 auto;white-space:nowrap !important;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-header::-webkit-scrollbar{height:4px;}',
      '.physton-prompt .group-tabs .group-body .group-main .sub-group-header::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.4);border-radius:2px;}',
      '/* 小屏幕：关键词输入框自适应缩短，不溢出 */',
      '.physton-prompt .extend-content{min-width:0;flex:1 1 auto !important;display:flex !important;flex-direction:row !important;align-items:center;gap:4px;}',
      '.physton-prompt .extend-content .input-tag-append{flex:1 1 auto !important;min-width:0 !important;max-width:none !important;width:auto !important;box-sizing:border-box;}',
      '@media (max-width:600px){.physton-prompt .extend-content .input-tag-append{font-size:12px;padding:4px 8px;}}',
      '/* 统一所有滚动条样式 */',
      '.physton-prompt::-webkit-scrollbar,.physton-prompt *::-webkit-scrollbar{width:6px;height:6px;}',
      '.physton-prompt::-webkit-scrollbar-thumb,.physton-prompt *::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.45);border-radius:3px;}',
      '.physton-prompt::-webkit-scrollbar-track,.physton-prompt *::-webkit-scrollbar-track{background:transparent;}',
      '.physton-prompt,.physton-prompt *{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,0.45) transparent;}',
      '/* 亮主题：激活标签对比度修复 */',
      'body:not(.dark) .physton-prompt .group-tab.active{background:#6c5ce7 !important;color:#fff !important;}',
      'body:not(.dark) .physton-prompt .sub-group-tab.active{background:#6c5ce7 !important;color:#fff !important;}',
      'body:not(.dark) .physton-prompt .group-tab{color:#1f2329 !important;}',
      'body:not(.dark) .physton-prompt .sub-group-tab{color:#1f2329 !important;}',
      '/* 小屏幕：fold 状态防溢出，输入框进一步缩短 */',
      '@media (max-width:600px){',
      '.physton-prompt .prompt-main.fold{max-height:110px !important;overflow:hidden !important;}',
      '.physton-prompt .prompt-main.fold .prompt-tags{max-height:60px;overflow-y:auto;}',
      '}',
      '/* 头部控制按钮：图标+文字左右结构 */',
      '.physton-prompt .prompt-header-extend{display:flex !important;flex-direction:row !important;align-items:center;gap:4px;flex:0 0 auto;}',
      '.physton-prompt .extend-btn-group{display:flex;flex-direction:row;align-items:center;gap:2px;}',
      '.physton-prompt .extend-content .gradio-checkbox{flex:0 0 auto !important;white-space:nowrap;}',
      '.physton-prompt .extend-btn-item{display:flex;flex-direction:row;align-items:center;gap:4px;white-space:nowrap;}',
      '.physton-prompt .extend-btn-item .icon-svg{flex:0 0 auto;}',
      '@media (max-width:600px){',
      '.physton-prompt .prompt-header-extend{gap:2px;margin-right:4px !important;}',
      '.physton-prompt .prompt-header-extend .extend-btn-group{max-width:48px;}',
      '.physton-prompt .prompt-header-extend .extend-btn-group .extend-btn-item{font-size:11px;max-width:48px;overflow:hidden;text-overflow:ellipsis;}',
      '.physton-prompt .prompt-header-title{margin-right:4px !important;}',
      '}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = id;
    st.textContent = css;
    document.head.appendChild(st);
  }
  function updateStat() {
    var c = counts();
    var s = panelEl && panelEl.querySelector('.aio-stat');
    if (s) s.textContent = '共 ' + c.cats + ' 分类 / ' + c.groups + ' 分组 / ' + c.tags + ' 关键词';
  }

  function renderFileSel() {
    var sel = panelEl && panelEl.querySelector('#aioFileSel');
    if (!sel) return;
    var cur = CURRENT_FILE;
    sel.innerHTML = FILE_LIST.map(function (f) {
      return '<option value="' + esc(f) + '"' + (f === cur ? ' selected' : '') + '>' + esc(f) + '</option>';
    }).join('');
  }

  function render() {
    if (!panelEl) return;
    var body = panelEl.querySelector('#aioManageBody');
    if (!body) return;
    if (!DATA.length) {
      body.innerHTML = '<div class="aio-empty">暂无分类。点击左上角「添加分类」开始创建。</div>';
      updateStat();
      return;
    }
    var html = '';
    html += '<div class="aio-jump-wrap">';
    html += '<select class="aio-input aio-jump" id="aioJump"><option value="">⇣ 跳转到分类…</option>';
    DATA.forEach(function (cat, ci) { html += '<option value="' + ci + '">' + esc(cat.name || ('分类 ' + (ci + 1))) + '</option>'; });
    html += '</select></div>';

    DATA.forEach(function (cat, ci) {
      var isCollapsed = !!collapsed[ci];
      html += '<div class="aio-cat' + (isCollapsed ? ' collapsed' : '') + '" data-ci="' + ci + '">';
      html += '<div class="aio-cat-head">';
      html += '<button class="aio-toggle" data-act="cat-toggle" data-cat="' + ci + '" title="折叠/展开">' + (isCollapsed ? '▶' : '▼') + '</button>';
      html += '<span style="color:#6c5ce7;font-weight:bold;">分类 ' + (ci + 1) + '</span>';
      html += '<input class="aio-input aio-name" data-cat="' + ci + '" value="' + esc(cat.name) + '" placeholder="分类名称">';
      html += '<button class="aio-btn sm" data-act="cat-up" data-cat="' + ci + '">↑上移</button>';
      html += '<button class="aio-btn sm" data-act="cat-down" data-cat="' + ci + '">↓下移</button>';
      html += '<button class="aio-btn sm danger" data-act="cat-del" data-cat="' + ci + '">✕删除</button>';
      html += '<button class="aio-btn sm primary" data-act="grp-add" data-cat="' + ci + '">+ 添加分组</button>';
      html += '</div><div class="aio-cat-body">';

      (cat.groups || []).forEach(function (g, gi) {
        var gk = ci + ':' + gi;
        var gColl = !!groupCollapsed[gk];
        html += '<div class="aio-group' + (gColl ? ' collapsed' : '') + '" data-ci="' + ci + '" data-gi="' + gi + '">';
        html += '<div class="aio-group-head">';
        html += '<button class="aio-toggle aio-group-toggle" data-act="grp-toggle" data-cat="' + ci + '" data-grp="' + gi + '" title="折叠/展开分组">' + (gColl ? '▶' : '▼') + '</button>';
        html += '<input class="aio-input aio-name" data-cat="' + ci + '" data-grp="' + gi + '" data-fld="name" value="' + esc(g.name) + '" placeholder="分组名称">';
        html += '<input type="color" class="aio-color-pick" data-cat="' + ci + '" data-grp="' + gi + '" data-fld="color-pick" value="' + colorToHex(g.color) + '" title="取色器">';
        html += '<input class="aio-input aio-color" data-cat="' + ci + '" data-grp="' + gi + '" data-fld="color" value="' + esc(g.color || '') + '" placeholder="颜色">';
        html += '<button class="aio-btn sm" data-act="grp-up" data-cat="' + ci + '" data-grp="' + gi + '">↑</button>';
        html += '<button class="aio-btn sm" data-act="grp-down" data-cat="' + ci + '" data-grp="' + gi + '">↓</button>';
        html += '<button class="aio-btn sm danger" data-act="grp-del" data-cat="' + ci + '" data-grp="' + gi + '">✕</button>';
        html += '<button class="aio-btn sm" data-act="tag-add" data-cat="' + ci + '" data-grp="' + gi + '">+ 关键词</button>';
        html += '</div>';

        html += '<div class="aio-group-body">';
        var tags = g.tags || [];
        if (tags.length) {
          html += '<div class="aio-tag-label">关键词（英文 → 中文）</div>';
        }
        html += '<div class="aio-tags-scroll">';
        tags.forEach(function (t, ti) {
          html += '<div class="aio-tag-row" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '">';
          html += '<input class="aio-input aio-key" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" data-fld="k" value="' + esc(t.k) + '" placeholder="英文关键词">';
          html += '<button class="aio-btn sm trans aio-trans-inline" data-act="tag-trans" data-dir="en2zh" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" title="英文→中文（覆盖中文）">→中</button>';
          html += '<input class="aio-input aio-val" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" data-fld="v" value="' + esc(t.v) + '" placeholder="中文翻译">';
          html += '<button class="aio-btn sm trans aio-trans-inline" data-act="tag-trans" data-dir="zh2en" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" title="中文→英文（覆盖英文）">←英</button>';
          html += '<span class="aio-ops">';
          html += '<button class="aio-btn sm" data-act="tag-copyto" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" title="复制到其他分类">⧉复制到</button>';
          html += '<button class="aio-btn sm" data-act="tag-up" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '">↑</button>';
          html += '<button class="aio-btn sm" data-act="tag-down" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '">↓</button>';
          html += '<button class="aio-btn sm danger" data-act="tag-del" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '">✕</button>';
          html += '</span></div>';
        });
        html += '</div>';
        html += '<button class="aio-btn aio-addtag-bottom" data-act="tag-add" data-cat="' + ci + '" data-grp="' + gi + '">＋ 添加词组</button>';
        html += '</div></div>';
      });
      html += '</div></div>';
    });
    body.innerHTML = html;
    insertCopyToBox();
    updateStat();
  }
  function bindEvents() {
    if (!panelEl) return;

    panelEl.addEventListener('input', function (e) {
      var el = e.target;
      if (!el.classList || (!el.classList.contains('aio-input') && el.type !== 'color')) return;
      var ci = el.getAttribute('data-cat');
      if (ci === null) return;
      ci = parseInt(ci, 10);
      var cat = DATA[ci]; if (!cat) return;
      var gi = el.getAttribute('data-grp');
      if (gi === null) { cat.name = el.value; return; }
      gi = parseInt(gi, 10);
      var g = cat.groups[gi]; if (!g) return;
      var fld = el.getAttribute('data-fld');
      if (fld === 'name') { g.name = el.value; return; }
      if (fld === 'color') {
        g.color = el.value;
        var pick = panelEl.querySelector('.aio-color-pick[data-cat="' + ci + '"][data-grp="' + gi + '"]');
        if (pick) pick.value = colorToHex(el.value);
        return;
      }
      if (fld === 'color-pick') {
        var txtEl = panelEl.querySelector('.aio-color[data-cat="' + ci + '"][data-grp="' + gi + '"]');
        g.color = pickerToRgba(el.value, txtEl ? txtEl.value : g.color);
        if (txtEl) txtEl.value = g.color;
        return;
      }
      var ti = el.getAttribute('data-tag');
      if (ti === null) return;
      ti = parseInt(ti, 10);
      var t = g.tags[ti]; if (!t) return;
      if (fld === 'k') t.k = el.value;
      if (fld === 'v') t.v = el.value;
    });

    panelEl.addEventListener('change', function (e) {
      var el = e.target;
      if (el && el.id === 'aioFileSel') {
        CURRENT_FILE = el.value;
        collapsed = {};
        loadData();
        return;
      }
      if (el && el.id === 'aioJump') {
        var ci = parseInt(el.value, 10);
        var catEl = panelEl.querySelector('.aio-cat[data-ci="' + ci + '"]');
        if (catEl) {
          if (collapsed[ci]) { collapsed[ci] = false; render(); }
          catEl = panelEl.querySelector('.aio-cat[data-ci="' + ci + '"]');
          if (catEl) catEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        el.value = '';
        return;
      }
    });

    panelEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.aio-btn, .aio-toggle');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var ci = btn.hasAttribute('data-cat') ? parseInt(btn.getAttribute('data-cat'), 10) : null;
      var gi = btn.hasAttribute('data-grp') ? parseInt(btn.getAttribute('data-grp'), 10) : null;
      var ti = btn.hasAttribute('data-tag') ? parseInt(btn.getAttribute('data-tag'), 10) : null;
      var cat = (ci !== null && DATA[ci]) ? DATA[ci] : null;
      var grp = (cat && gi !== null && cat.groups[gi]) ? cat.groups[gi] : null;

      switch (act) {
        case 'cat-toggle': {
          if (ci !== null) { collapsed[ci] = !collapsed[ci]; }
          break;
        }
        case 'grp-toggle': {
          if (ci !== null && gi !== null) {
            var gk = ci + ':' + gi;
            groupCollapsed[gk] = !groupCollapsed[gk];
          }
          break;
        }
        case 'cat-up': if (ci !== null) { moveItem(DATA, ci, -1); collapseAll(); } break;
        case 'cat-down': if (ci !== null) { moveItem(DATA, ci, 1); collapseAll(); } break;
        case 'cat-del': {
          if (cat && confirm('确定删除分类「' + (cat.name || '') + '」及其全部分组/关键词？')) { DATA.splice(ci, 1); collapseAll(); }
          break;
        }
        case 'grp-add': {
          if (cat) { cat.groups = cat.groups || []; cat.groups.push({ name: '新分组', tags: [] }); }
          break;
        }
        case 'grp-up': if (cat && gi !== null) moveItem(cat.groups, gi, -1); break;
        case 'grp-down': if (cat && gi !== null) moveItem(cat.groups, gi, 1); break;
        case 'grp-del': {
          if (grp && confirm('确定删除分组「' + (grp.name || '') + '」及其全部关键词？')) cat.groups.splice(gi, 1);
          break;
        }
        case 'tag-add': {
          if (grp) { grp.tags = grp.tags || []; grp.tags.unshift({ k: '', v: '' }); pendingFocus = { ci: ci, gi: gi }; }
          break;
        }
        case 'tag-up': if (grp && ti !== null) moveItem(grp.tags, ti, -1); break;
        case 'tag-down': if (grp && ti !== null) moveItem(grp.tags, ti, 1); break;
        case 'tag-del': {
          if (grp && ti !== null && confirm('确定删除关键词「' + (grp.tags[ti].k || '') + '」？')) grp.tags.splice(ti, 1);
          break;
        }
        case 'tag-trans': {
          if (grp && ti !== null) doTranslate(ci, gi, ti, btn.getAttribute('data-dir') || 'en2zh');
          break;
        }
        case 'tag-copyto': {
          if (cat && grp && ti !== null) { pendingCopyTo = { ci: ci, gi: gi, ti: ti }; }
          break;
        }
        case 'copyto-ok': {
          if (cat && grp && ti !== null) doCopyTo(ci, gi, ti, btn.getAttribute('data-target'));
          break;
        }
        case 'copyto-cancel': {
          closeCopyTo();
          break;
        }
      }
      render();
      if (pendingFocus) {
        var pf = pendingFocus; pendingFocus = null;
        var fsel = '.aio-tag-row[data-cat="' + pf.ci + '"][data-grp="' + pf.gi + '"] .aio-key';
        var fel = panelEl.querySelector(fsel);
        if (fel) setTimeout(function () { fel.focus(); }, 50);
      }
    });
  }

  /* ---------- 翻译缓存 ---------- */
  var TRANSLATE_CACHE_KEY = "aio_translate_cache";
  function getTranslateCache() {
    try { return JSON.parse(localStorage.getItem(TRANSLATE_CACHE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function setTranslateCache(direction, text, translated) {
    try {
      var cache = getTranslateCache();
      cache[direction + ":" + text] = translated;
      localStorage.setItem(TRANSLATE_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }
  function clearTranslateCache() {
    try { localStorage.removeItem(TRANSLATE_CACHE_KEY); toast("翻译缓存已清除"); }
    catch (e) { toast("清除失败：" + e.message, true); }
  }
  function getTranslateCacheSize() {
    try { return Object.keys(JSON.parse(localStorage.getItem(TRANSLATE_CACHE_KEY) || "{}")).length; }
    catch (e) { return 0; }
  }

  /* ---------- 翻译（中文<->英文 自动补全） ---------- */
  function doTranslate(ci, gi, ti, direction) {
    var g = DATA[ci].groups[gi];
    var t = g.tags[ti];
    var k = (t.k || "").trim();
    var v = (t.v || "").trim();
    var text, target;
    if (direction === "zh2en") {
      if (!v) { toast("请先填写中文", true); return; }
      text = v; target = "k";
    } else {
      if (!k) { toast("请先填写英文", true); return; }
      text = k; target = "v";
    }
    var cache = getTranslateCache();
    var cacheKey = direction + ":" + text;
    if (cache[cacheKey]) {
      t[target] = cache[cacheKey];
      render();
      toast("已使用缓存翻译");
      return;
    }
    toast("翻译中...");
    httpPost("/physton_prompt/manage/translate", { text: text }).then(function (j) {
      if (j && j.success && j.translated_text) {
        t[target] = j.translated_text;
        setTranslateCache(direction, text, j.translated_text);
        render();
        toast("已翻译（已缓存）");
      } else {
        toast("翻译失败：" + ((j && j.message) || "未知错误"), true);
      }
    }).catch(function (e) { toast("翻译失败：" + e.message, true); });
  }

  /* ---------- 复制到其他分类 ---------- */
  function insertCopyToBox() {
    if (!pendingCopyTo) return;
    var ci = pendingCopyTo.ci, gi = pendingCopyTo.gi, ti = pendingCopyTo.ti;
    var cat = DATA[ci], grp = cat && cat.groups[gi], t = grp && grp.tags[ti];
    if (!grp || !t) { pendingCopyTo = null; return; }
    var html = '<div class="aio-copyto" data-copyto="1">';
    html += '<span style="color:#9aa0ab;font-size:12px;">复制「' + esc((t.k || '') + ' / ' + (t.v || '')) + '」到：</span>';
    html += '<select class="aio-input aio-copyto-sel">';
    DATA.forEach(function (cat2, ci2) {
      (cat2.groups || []).forEach(function (g2, gi2) {
        if (ci2 === ci && gi2 === gi) return;
        html += '<option value="' + ci2 + ':' + gi2 + '">' + esc(cat2.name + ' / ' + g2.name) + '</option>';
      });
    });
    html += '</select>';
    html += '<label><input type="checkbox" class="aio-copyto-move"> 复制后删除原项</label>';
    html += '<button class="aio-btn sm primary" data-act="copyto-ok" data-cat="' + ci + '" data-grp="' + gi + '" data-tag="' + ti + '" data-target="">确定</button>';
    html += '<button class="aio-btn sm" data-act="copyto-cancel">取消</button>';
    html += '</div>';
    var row = panelEl.querySelector('.aio-tag-row[data-cat="' + ci + '"][data-grp="' + gi + '"][data-tag="' + ti + '"]');
    if (row) row.insertAdjacentHTML('afterend', html);
    var okBtn = panelEl.querySelector('.aio-copyto [data-act="copyto-ok"]');
    var sel = panelEl.querySelector('.aio-copyto .aio-copyto-sel');
    if (okBtn && sel) okBtn.setAttribute('data-target', sel.value);
    if (sel) sel.addEventListener('change', function () {
      okBtn.setAttribute('data-target', sel.value);
    });
    pendingCopyTo = null;
  }
  function doCopyTo(ci, gi, ti, target) {
    if (!target) { toast('请选择目标分组', true); return; }
    var parts = target.split(':');
    var ci2 = parseInt(parts[0], 10), gi2 = parseInt(parts[1], 10);
    if (isNaN(ci2) || isNaN(gi2) || !DATA[ci2] || !DATA[ci2].groups[gi2]) { toast('目标分组不存在', true); return; }
    var src = DATA[ci].groups[gi].tags[ti];
    var cp = copyItem(src);
    DATA[ci2].groups[gi2].tags = DATA[ci2].groups[gi2].tags || [];
    var exists = DATA[ci2].groups[gi2].tags.some(function (x) { return x.k === cp.k && cp.k; });
    if (exists) { toast('目标分组已存在该关键词', true); return; }
    var moveBox = panelEl.querySelector('.aio-copyto-move');
    var doMove = moveBox && moveBox.checked;
    DATA[ci2].groups[gi2].tags.push(cp);
    if (doMove) {
      DATA[ci].groups[gi].tags.splice(ti, 1);
      toast('已移动到目标分类');
    } else {
      toast('已复制到目标分类');
    }
    closeCopyTo();
  }
  function closeCopyTo() {
    var box = panelEl && panelEl.querySelector('.aio-copyto[data-copyto="1"]');
    if (box) box.remove();
  }

  function buildPayload() {
    return DATA.map(function (cat) {
      var groups = (cat.groups || []).map(function (g) {
        var o = { name: g.name || '' };
        if (g.color && String(g.color).trim()) o.color = String(g.color).trim();
        var tags = {};
        (g.tags || []).forEach(function (t) {
          var k = String(t.k || '').trim();
          if (k) tags[k] = String(t.v || '');
        });
        o.tags = tags;
        return o;
      });
      return { name: cat.name || '', groups: groups };
    });
  }

  function loadData() {
    return httpGet(API_BASE + '?file=' + encodeURIComponent(CURRENT_FILE)).then(function (j) {
      if (j && Array.isArray(j.files)) FILE_LIST = j.files;
      DATA = normalizeData(j && j.data);
      collapseAll();
      groupCollapsed = {};
      renderFileSel();
      render();
      updateStat();
      if (j && j.error) toast('读取失败：' + j.error, true);
    }).catch(function (e) { toast('读取失败：' + e.message, true); });
  }

  function doSave() {
    httpPost(API_BASE + '/save', { data: buildPayload(), file: CURRENT_FILE }).then(function (j) {
      if (j && j.success) {
        toast('已保存到 ' + j.file + '，正在刷新页面生效…');
        setTimeout(function () { location.reload(); }, 600);
      } else {
        toast('保存失败：' + ((j && j.message) || '未知错误'), true);
      }
    }).catch(function (e) { toast('保存失败：' + e.message, true); });
  }
  function closePanel() {
    var m = document.getElementById('aioManageMask');
    if (m) m.classList.remove('open');
  }

  function openPanel() {
    var mask = document.getElementById('aioManageMask');
    if (!mask) buildPanel();
    mask = document.getElementById('aioManageMask');
    mask.classList.add('open');
    loadData();
  }

  function findDuplicates() {
    var map = {};
    DATA.forEach(function (cat, ci) {
      (cat.groups || []).forEach(function (g, gi) {
        (g.tags || []).forEach(function (t, ti) {
          var k = (t.k || '').trim();
          if (!k) return;
          var norm = k.toLowerCase();
          if (!map[norm]) map[norm] = [];
          map[norm].push({ ci: ci, gi: gi, ti: ti, k: t.k, v: t.v, catName: cat.name, groupName: g.name });
        });
      });
    });
    var dups = [];
    for (var key in map) {
      if (ignoredDups[key]) continue;
      if (map[key].length > 1) dups.push({ key: key, items: map[key] });
    }
    return dups;
  }

  function renderDuplicates() {
    var dups = findDuplicates();
    var html = '<div style="padding:14px 18px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">';
    html += '<h3 style="margin:0;font-size:16px;color:var(--aio-text);">🔍 重复关键词 <span style="font-size:12px;color:var(--aio-mut);font-weight:normal;">' + dups.length + ' 组重复</span></h3>';
    html += '<button class="aio-btn" data-act="dup-back">← 返回管理</button>';
    html += '</div>';
    if (dups.length === 0) {
      html += '<div style="padding:50px 20px;text-align:center;color:var(--aio-mut);font-size:14px;">没有发现重复关键词</div>';
    } else {
      dups.forEach(function (d) {
        html += '<div style="border:1px solid var(--aio-border);border-radius:8px;padding:10px 14px;margin-bottom:10px;background:var(--aio-input);">';
        html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">';
        html += '<div><strong style="color:var(--aio-text);font-size:14px;">' + esc(d.items[0].k) + '</strong> <span style="color:var(--aio-mut);font-size:12px;margin-left:6px;">' + esc(d.items[0].v || '') + '</span></div>';
        html += '<button class="aio-btn sm" data-act="dup-ignore" data-key="' + esc(d.key) + '" title="本次忽略此重复">忽略</button>';
        html += '</div>';
        html += '<div style="font-size:12px;color:var(--aio-mut);margin-bottom:4px;">出现在 ' + d.items.length + ' 个分组：</div>';
        d.items.forEach(function (item) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-top:1px solid var(--aio-border);">';
          html += '<span style="font-size:13px;color:var(--aio-text);">📁 ' + esc(item.catName) + ' <span style="color:var(--aio-mut);">/</span> ' + esc(item.groupName) + '</span>';
          html += '<button class="aio-btn sm danger" data-act="dup-del" data-ci="' + item.ci + '" data-gi="' + item.gi + '" data-ti="' + item.ti + '">删除此项</button>';
          html += '</div>';
        });
        html += '</div>';
      });
    }
    html += '</div>';
    var dv = panelEl.querySelector('#aioDupView');
    dv.innerHTML = html;
    dv.style.display = 'block';
    panelEl.querySelector('#aioManageBody').style.display = 'none';
    panelEl.querySelector('#aioManageFoot').style.display = 'none';
  }

  function buildPanel() {
    var mask = document.createElement('div');
    mask.id = 'aioManageMask';
    mask.innerHTML =
      '<div id="aioManagePanel">' +
      '  <div id="aioManageHead">' +
      '    <h3>⚙ 提示词库管理 <span class="aio-stat"></span></h3>' +
      '    <button class="aio-close" title="关闭">✕</button>' +
      '  </div>' +
      '  <div id="aioManageBar">' +
      '    <button class="aio-btn primary" data-act="cat-add">+ 添加分类</button>' +
      '    <button class="aio-btn" data-act="reload">↻ 重新加载</button>' +
      '    <span style="color:#9aa0ab;font-size:12px;">管理文件：</span>' +
      '    <select class="aio-input aio-filesel" id="aioFileSel"></select>' +
      '    <span style="color:#9aa0ab;font-size:12px;">（保存后自动刷新页面生效）</span>' +
      '    <button class="aio-btn" data-act="dup-check">🔍 检查重复</button>' +
      '    <button class="aio-btn" data-act="export" title="导出当前 YAML 文件">⬇ 导出</button>' +
      '    <button class="aio-btn" data-act="import" title="导入 YAML 文件替换当前">⬆ 导入</button>' +
      '    <button class="aio-btn" data-act="clear-cache" title="清除本地翻译缓存">🗑 清除翻译缓存</button>' +
      '<button class="aio-btn" data-act="remote-setting" title="配置远程YAML API">🌐 远程设置</button>' +
      '    <input type="file" id="aioImportInput" accept=".yaml,.yml" style="display:none;">' +
      '  </div>' +
      '  <div id="aioRemoteSetting" style="display:none;padding:10px 16px;background:rgba(108,92,231,0.08);border-bottom:1px solid rgba(128,128,128,0.2);">' +
      '    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
      '      <span style="color:#9aa0ab;font-size:12px;white-space:nowrap;">远程API地址：</span>' +
      '      <input type="text" id="aioRemoteUrlInput" class="aio-input" placeholder="例如：http://192.168.1.100:7860" style="flex:1;min-width:200px;">' +
      '      <button class="aio-btn sm" id="aioRemoteTestBtn" title="测试连接">🔍 测试</button>' +
      '      <button class="aio-btn sm primary" id="aioRemoteSaveBtn" title="保存远程地址">💾 保存</button>' +
      '      <button class="aio-btn sm" id="aioRemoteClearBtn" title="清除远程地址，使用本地">✕ 清除</button>' +
      '      <span id="aioRemoteStatus" style="font-size:12px;color:#9aa0ab;"></span>' +
      '    </div>' +
      '    <div style="margin-top:6px;font-size:11px;color:#888;">配置后将从远程获取 prepend.yaml / default.yaml / zh_CN.yaml，保存后需刷新页面生效。远程端需安装本插件并开启服务。</div>' +
      '  </div>' +
      '  <div id="aioManageBody"></div>' +
      '  <div id="aioDupView" style="display:none;"></div>' +
      '  <div id="aioManageFoot">' +
      '    <button class="aio-btn" data-act="reload">↻ 放弃修改</button>' +
      '    <button class="aio-btn primary" data-act="save">💾 保存</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(mask);
    panelEl = mask;

    mask.querySelector('.aio-close').addEventListener('click', closePanel);

    panelEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.aio-btn, .aio-toggle');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cat-add') { DATA.push({ name: '新分类', groups: [] }); render(); }
      if (act === 'reload') { if (confirm('放弃未保存的修改并重新加载？')) loadData(); }
      if (act === 'save') { doSave(); }
      if (act === 'dup-check') { renderDuplicates(); }
      if (act === 'dup-back') {
        panelEl.querySelector('#aioDupView').style.display = 'none';
        panelEl.querySelector('#aioManageBody').style.display = 'block';
        panelEl.querySelector('#aioManageFoot').style.display = 'flex';
      }
      if (act === 'dup-ignore') { ignoredDups[btn.getAttribute('data-key')] = true; renderDuplicates(); }
      if (act === 'dup-del') {
        var dci = parseInt(btn.getAttribute('data-ci'), 10), dgi = parseInt(btn.getAttribute('data-gi'), 10), dti = parseInt(btn.getAttribute('data-ti'), 10);
        if (!isNaN(dci) && !isNaN(dgi) && !isNaN(dti) && DATA[dci] && DATA[dci].groups[dgi] && DATA[dci].groups[dgi].tags[dti]) {
          DATA[dci].groups[dgi].tags.splice(dti, 1);
          renderDuplicates();
        }
      }
      if (act === 'export') {
        var sel = panelEl.querySelector('#aioFileSel'); var f = (sel && sel.value) || 'prepend.yaml';
        fetch('/physton_prompt/manage/group_tags/download?file=' + encodeURIComponent(f))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.success) { toast('导出失败：' + (d.message || '未知错误'), true); return; }
            var blob = new Blob([d.content], { type: 'text/yaml;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = d.file || f;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            toast('已导出 ' + (d.file || f));
          })
          .catch(function (e) { toast('导出失败：' + e.message, true); });
      }
      if (act === 'import') {
        var inp = panelEl.querySelector('#aioImportInput');
        if (inp) inp.click();
      }
      if (act === "remote-setting") {
        var rs = panelEl.querySelector("#aioRemoteSetting");
        if (rs) {
          var isHidden = rs.style.display === "none" || !rs.style.display;
          rs.style.display = isHidden ? "block" : "none";
          if (isHidden) loadRemoteUrl();
        }
      }
      if (act === "clear-cache") {
        if (confirm("确定清除全部翻译缓存？（共 " + getTranslateCacheSize() + " 条）")) {
          clearTranslateCache();
        }
      }
    });

    // 远程 YAML 设置功能
    function loadRemoteUrl() {
      var inp = panelEl.querySelector('#aioRemoteUrlInput');
      var status = panelEl.querySelector('#aioRemoteStatus');
      if (!inp) return;
      fetch('/physton_prompt/get_data?key=remote_yaml_url')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.data) {
            inp.value = d.data;
            if (status) status.textContent = '已配置：' + d.data;
          } else {
            inp.value = '';
            if (status) status.textContent = '未配置（使用本地YAML）';
          }
        })
        .catch(function() { if (status) status.textContent = '读取配置失败'; });
    }

    function saveRemoteUrl() {
      var inp = panelEl.querySelector('#aioRemoteUrlInput');
      var status = panelEl.querySelector('#aioRemoteStatus');
      if (!inp) return;
      var url = inp.value.trim();
      fetch('/physton_prompt/set_data', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: 'remote_yaml_url', data: url})
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.success) {
            if (status) status.textContent = '已保存，刷新页面后生效';
            toast('远程地址已保存，刷新页面后生效');
          } else {
            if (status) status.textContent = '保存失败';
          }
        })
        .catch(function() { if (status) status.textContent = '保存失败'; });
    }

    function testRemoteUrl() {
      var inp = panelEl.querySelector('#aioRemoteUrlInput');
      var status = panelEl.querySelector('#aioRemoteStatus');
      if (!inp || !inp.value.trim()) { if (status) status.textContent = '请先填写地址'; return; }
      var base = inp.value.trim();
      while (base.endsWith('/')) base = base.slice(0, -1);
      var url = base + '/physton_prompt/remote_yaml?file=prepend.yaml';
      if (status) status.textContent = '测试中...';
      // Use server-side proxy to bypass browser CORS
      fetch('/physton_prompt/proxy_yaml?url=' + encodeURIComponent(url))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.success) {
            var text = d.content || '';
            if (text.length > 10) {
              if (status) status.textContent = '连接成功，prepend.yaml 大小：' + text.length + ' 字节';
            } else {
              if (status) status.textContent = '连接成功但内容为空';
            }
          } else {
            if (status) status.textContent = '连接失败：' + (d && d.message ? d.message : '未知错误');
          }
        })
        .catch(function(e) { if (status) status.textContent = '连接失败：' + e.message; });
    }

    function clearRemoteUrl() {
      var inp = panelEl.querySelector('#aioRemoteUrlInput');
      var status = panelEl.querySelector('#aioRemoteStatus');
      if (!confirm('确定清除远程地址？清除后使用本地YAML。')) return;
      fetch('/physton_prompt/set_data', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key: 'remote_yaml_url', data: ''})
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d && d.success) {
            if (inp) inp.value = '';
            if (status) status.textContent = '已清除，刷新页面后生效';
            toast('远程地址已清除，刷新页面后生效');
          }
        })
        .catch(function() {});
    }

    var remoteSaveBtn = panelEl.querySelector('#aioRemoteSaveBtn');
    if (remoteSaveBtn) remoteSaveBtn.addEventListener('click', saveRemoteUrl);
    var remoteTestBtn = panelEl.querySelector('#aioRemoteTestBtn');
    if (remoteTestBtn) remoteTestBtn.addEventListener('click', testRemoteUrl);
    var remoteClearBtn = panelEl.querySelector('#aioRemoteClearBtn');
    if (remoteClearBtn) remoteClearBtn.addEventListener('click', clearRemoteUrl);

    var importInput = panelEl.querySelector('#aioImportInput');
    if (importInput) {
      importInput.addEventListener('change', function () {
        var file = importInput.files[0];
        if (!file) return;
        var sel2 = panelEl.querySelector('#aioFileSel'); var curFile = (sel2 && sel2.value) || 'prepend.yaml'; if (!confirm('导入将替换当前文件「' + curFile + '」的全部内容，确定继续？')) {
          importInput.value = ''; return;
        }
        var fd = new FormData();
        fd.append('file', curFile);
        fd.append('upload', file);
        toast('导入中…');
        fetch('/physton_prompt/manage/group_tags/import', { method: 'POST', body: fd })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.success) {
              toast('导入成功，正在重新加载…');
              importInput.value = '';
              setTimeout(function () { loadData(); }, 800);
            } else {
              toast('导入失败：' + (d.message || '未知错误'), true);
              importInput.value = '';
            }
          })
          .catch(function (e) { toast('导入失败：' + e.message, true); importInput.value = ''; });
      });
    }

    bindEvents();
  }

  /* ================= 修复「从收藏中移除」按钮无效 ================= */
  function installFavoriteFix() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.physton-prompt-favorite .header-btn-favorite') : null;
      if (!btn) return;
      if (getComputedStyle(btn).display === 'none') return;
      var icon = btn.querySelector('.icon-svg-favorite-yes, .icon-svg[data-name="favorite-yes"]');
      if (!icon) return;
      e.preventDefault();
      e.stopPropagation();

      var item = btn.closest('.content-item');
      var popup = btn.closest('.physton-prompt-favorite');
      if (!item || !popup) return;

      var promptEl = item.querySelector('.item-prompt');
      var prompt = promptEl ? (promptEl.textContent || '').trim() : '';
      var nameInput = item.querySelector('.header-name-input');
      var name = nameInput ? (nameInput.value || '').trim() : '';

      var keys = ['txt2img', 'txt2img_neg', 'img2img', 'img2img_neg'];
      var tabs = popup.querySelectorAll('.popup-tab');
      var key = 'txt2img';
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].className && tabs[i].className.indexOf('active') >= 0) { key = keys[i] || key; break; }
      }

      toast('正在移除收藏…');
      httpGet('/physton_prompt/get_favorites?type=' + key).then(function (d) {
        var favs = (d && d.favorites) || [];
        var target = favs.find(function (f) { return f.prompt === prompt; });
        if (!target && name) target = favs.find(function (f) { return f.name === name; });
        if (!target && favs.length) target = favs[0];
        if (!target) { toast('未找到该收藏', true); return null; }
        return httpPost('/physton_prompt/unfavorite', { type: key, id: target.id });
      }).then(function (res) {
        if (res === null) return;
        if (res && res.success) {
          toast('已移除收藏');
          if (item && item.parentNode) item.parentNode.removeChild(item);
        } else {
          toast('移除失败：' + ((res && res.message) || '未知错误'), true);
        }
      }).catch(function (err) { toast('移除失败：' + err.message, true); });
    }, true);
  }


  /* ================= 明暗主题切换（无需刷新页面） ================= */
  function themeToggleIcon(isDark) {
    return isDark ? '☀️' : '🌙';
  }
  function createThemeToggle() {
    var t = document.getElementById('aioThemeToggle');
    if (t) return t;
    t = document.createElement('button');
    t.id = 'aioThemeToggle';
    t.title = '切换明暗主题';
    function syncThemeIcon() {
      t.textContent = themeToggleIcon(document.body.classList.contains('dark'));
    }
    syncThemeIcon();
    t.addEventListener('click', function () {
      var isDark = document.body.classList.toggle('dark');
      syncThemeIcon();
      var u = new URL(location.href);
      u.searchParams.set('__theme', isDark ? 'dark' : 'light');
      history.replaceState(null, '', u.toString());
    });
    document.body.appendChild(t);
    try {
      new MutationObserver(syncThemeIcon).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    } catch (e) {}
    return t;
  }

  /* ================= 初始化 ================= */
  function tryPlaceManageBtn() {
    if (document.getElementById('aioManageHeaderItem')) return true;
    var chatgptIcon = document.querySelector('.icon-svg-chatgpt');
    if (!chatgptIcon) return false;
    var extendItem = chatgptIcon.closest('.prompt-header-extend');
    if (!extendItem) return false;
    var header = extendItem.parentElement;
    if (!header) return false;
    var gearSVG = '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"currentColor\" width=\"18\" height=\"18\"><path d=\"M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z\"/></svg>';
    var item = document.createElement('div');
    item.id = 'aioManageHeaderItem';
    item.className = 'extend-btn-item';
    item.setAttribute('data-tippy-content', '提示词管理');
    item.title = '提示词管理';
    item.style.cursor = 'pointer';
    var iconDiv = document.createElement('div');
    iconDiv.className = 'icon-svg aio-manage-icon hover-scale-120';
    iconDiv.innerHTML = gearSVG;
    item.appendChild(iconDiv);
    item.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });
    var group = document.createElement('div');
    group.className = 'extend-btn-group';
    group.appendChild(item);
    var content = document.createElement('div');
    content.className = 'extend-content';
    content.appendChild(group);
    var wrap = document.createElement('div');
    wrap.className = 'prompt-header-extend';
    wrap.appendChild(content);
    header.insertBefore(wrap, extendItem.nextSibling);
    return true;
  }
  function createFloatingFallback() {
    if (document.getElementById('aioManageBtn')) return;
    var btn = document.createElement('button');
    btn.id = 'aioManageBtn';
    btn.textContent = '⚙ 提示词管理';
    btn.title = '打开提示词库管理面板（添加/删除/移动/复制、翻译、颜色、多文件）';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });
    document.body.appendChild(btn);
  }

  /* ================= 无刷新主题切换 ================= */
  function getCurrentTheme() {
    // Check URL param first
    var urlParams = new URLSearchParams(window.location.search);
    var urlTheme = urlParams.get('__theme');
    if (urlTheme === 'dark' || urlTheme === 'light') return urlTheme;
    // Check body class
    if (document.body.classList.contains('dark') || document.body.classList.contains('gradio-dark') || document.documentElement.classList.contains('dark')) return 'dark';
    // Check localStorage
    var saved = localStorage.getItem('aio_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    // Default
    return 'dark';
  }

  function applyTheme(theme) {
    var isDark = theme === 'dark';
    // Toggle Gradio dark class on body and html
    document.body.classList.toggle('dark', isDark);
    document.body.classList.toggle('gradio-dark', isDark);
    document.documentElement.classList.toggle('dark', isDark);
    // Set data-theme attribute if used
    document.documentElement.setAttribute('data-theme', theme);
    // Update URL without refresh
    var url = new URL(window.location);
    url.searchParams.set('__theme', theme);
    window.history.replaceState({}, '', url);
    // Save to localStorage
    localStorage.setItem('aio_theme', theme);
    // Update toggle button icon
    var btn = document.getElementById('aioThemeToggleBtn');
    if (btn) {
      btn.setAttribute('data-tippy-content', isDark ? '切换到浅色主题' : '切换到深色主题');
      btn.title = isDark ? '切换到浅色主题' : '切换到深色主题';
      var icon = btn.querySelector('.aio-theme-icon');
      if (icon) {
        icon.innerHTML = isDark ? getSunSVG() : getMoonSVG();
      }
    }
  }

  function toggleTheme() {
    var current = getCurrentTheme();
    var next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  function getSunSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112.01 112.01" width="18" height="18" fill="currentColor"><path d="m56,80c6.83-.17,12.5-2.5,17-7s6.83-10.16,7-17c-.17-6.83-2.5-12.5-7-17s-10.16-6.83-17-7c-6.83.17-12.5,2.5-17,7s-6.83,10.16-7,17c.17,6.83,2.5,12.5,7,17s10.16,6.83,17,7Zm0,8c-9.08-.25-16.62-3.38-22.62-9.38s-9.12-13.54-9.38-22.62c.25-9.08,3.38-16.62,9.38-22.62s13.54-9.12,22.62-9.38c9.08.25,16.62,3.38,22.62,9.38s9.12,13.54,9.38,22.62c-.25,9.08-3.38,16.62-9.38,22.62s-13.54,9.12-22.62,9.38ZM56,0c1.17,0,2.13.38,2.88,1.12.74.75,1.12,1.71,1.12,2.88v8c.04,1.07-.37,2.12-1.12,2.88-.76.75-1.81,1.16-2.88,1.12-1.07.04-2.12-.37-2.88-1.12-.75-.76-1.16-1.81-1.12-2.88V4c0-1.17.38-2.13,1.12-2.88.76-.75,1.81-1.16,2.88-1.12Zm0,96c1.17,0,2.13.38,2.88,1.12.74.75,1.12,1.71,1.12,2.88v8c.04,1.07-.37,2.12-1.12,2.88-.76.75-1.81,1.16-2.88,1.12-1.07.04-2.12-.37-2.88-1.12-.75-.76-1.16-1.81-1.12-2.88v-8c0-1.17.38-2.13,1.12-2.88.76-.75,1.81-1.16,2.88-1.12ZM16.38,16.38c.78-.73,1.81-1.13,2.88-1.12,1.08,0,2,.37,2.75,1.12l5.75,5.62c1,1.17,1.3,2.48.94,3.94-.3,1.38-1.38,2.46-2.76,2.75-1.38.39-2.87.04-3.93-.94l-5.63-5.75c-.74-.72-1.14-1.72-1.12-2.75,0-1.09.38-2.05,1.12-2.88,0,0,0,0,0,0Zm67.87,67.87c.78-.73,1.81-1.13,2.88-1.12,1.08,0,2.04.38,2.88,1.12l5.62,5.76c.74.74,1.12,1.66,1.12,2.75,0,1.06-.42,2.08-1.19,2.81-.73.77-1.75,1.2-2.81,1.19-1.03.02-2.03-.39-2.75-1.13l-5.75-5.62c-.73-.78-1.13-1.81-1.12-2.88,0-1.08.37-2.04,1.12-2.87h0ZM0,56c0-1.17.38-2.13,1.12-2.88.76-.75,1.81-1.16,2.88-1.12h8c1.17,0,2.13.38,2.88,1.12.74.75,1.12,1.71,1.12,2.88.04,1.07-.37,2.12-1.12,2.88-.76.75-1.81,1.16-2.88,1.12H4c-1.07.04-2.12-.37-2.88-1.12-.75-.76-1.16-1.81-1.12-2.88Zm96,0c0-1.17.38-2.13,1.12-2.88.76-.75,1.81-1.16,2.88-1.12h8c1.17,0,2.13.38,2.88,1.12.74.75,1.12,1.71,1.12,2.88.04,1.07-.37,2.12-1.12,2.88-.76.75-1.81,1.16-2.88,1.12h-8c-1.07.04-2.12-.37-2.88-1.12-.75-.76-1.16-1.81-1.12-2.88ZM16.38,95.63c-.73-.78-1.13-1.81-1.12-2.88,0-1.08.37-2,1.12-2.75l5.62-5.75c.78-.73,1.81-1.13,2.88-1.12,1.06,0,2.08.42,2.81,1.19.77.73,1.19,1.75,1.18,2.81,0,1.07-.39,2.1-1.12,2.88l-5.75,5.62c-.72.74-1.72,1.14-2.75,1.12-1.07,0-2.1-.39-2.88-1.12,0,0,0,0,0,0ZM84.25,27.75c-.73-.78-1.13-1.81-1.12-2.88,0-1.08.38-2.04,1.12-2.87l5.76-5.62c.72-.74,1.72-1.14,2.75-1.12,1.06,0,2.08.42,2.81,1.18.77.73,1.2,1.75,1.19,2.81,0,1.09-.38,2-1.13,2.76l-5.62,5.75c-.78.73-1.81,1.13-2.88,1.12-1.07,0-2.09-.39-2.87-1.12h0s0,0,0,0Z"/></svg>';
  }

  function getMoonSVG() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  function addThemeToggleBtn() {
    if (document.getElementById('aioThemeToggleBtn')) return;
    // Find the header extend area (same place as manage button)
    var chatgptIcon = document.querySelector('.icon-svg-chatgpt');
    if (!chatgptIcon) return;
    var extendItem = chatgptIcon.closest('.prompt-header-extend');
    if (!extendItem) return;
    var header = extendItem.parentElement;
    if (!header) return;

    var isDark = getCurrentTheme() === 'dark';
    var item = document.createElement('div');
    item.id = 'aioThemeToggleBtn';
    item.className = 'extend-btn-item';
    item.setAttribute('data-tippy-content', isDark ? '切换到浅色主题' : '切换到深色主题');
    item.title = isDark ? '切换到浅色主题' : '切换到深色主题';
    item.style.cursor = 'pointer';
    var iconDiv = document.createElement('div');
    iconDiv.className = 'icon-svg aio-theme-icon hover-scale-120';
    iconDiv.innerHTML = isDark ? getSunSVG() : getMoonSVG();
    item.appendChild(iconDiv);
    item.addEventListener('click', function(e) {
      e.stopPropagation();
      toggleTheme();
    });
    // Insert after the manage button if exists, or after extendItem
    var manageBtn = document.getElementById('aioManageHeaderItem');
    if (manageBtn && manageBtn.parentElement === header) {
      header.insertBefore(item, manageBtn.nextSibling);
    } else {
      header.insertBefore(item, extendItem.nextSibling);
    }
  }

  function init() {
    injectCSS();
    var placed = tryPlaceManageBtn();
    addThemeToggleBtn();
    if (!placed) {
      var observer = new MutationObserver(function () {
        if (tryPlaceManageBtn()) { observer.disconnect(); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () {
        observer.disconnect();
        if (!document.getElementById('aioManageHeaderItem')) createFloatingFallback();
      }, 5000);
    }
    installFavoriteFix();
    // Apply saved theme on load (no refresh)
    var savedTheme = localStorage.getItem('aio_theme');
    if (savedTheme && savedTheme !== getCurrentTheme()) {
      applyTheme(savedTheme);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
