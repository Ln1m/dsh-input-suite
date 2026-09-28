// dsh-skill-sets —— Client 半端（Web GUI）
//
// 两处 UI：
//   1) 输入框上方一枚紧凑 pill（官方 conversation.input.dock，order 5）
//      收起：[图标] 技能档 [N 档] [⌄] —— 只报个数，绝不把开启的档位逐个铺开（悬停 title 列全名）
//      展开：档位卡（选中打勾），右下角一行「可见 x / y」
//      悬停不弹任何浮动内容（只用原生 title，刻意不做浮层）
//   2) 设置面板「技能档」分区（settings.section）：完整分类配置 —— 每个档的简介、
//      包含的技能（可搜索、可整档全开/全关）、每条技能独立开关，外加两项可选高级项：
//      该档禁用的工具（tools.restrict 拒绝名单，默认空=不裁）与该档绑定的 agent preset
//      （默认空=不改），顶部还有全档共用的漏遮蔽巡检间隔（秒，0=关）。
//
// 数据通道：宿主 ctx.webServer.register 的同源路由（自写插件无法注册 api.* RPC）：
//   GET  /skill-sets/api/state?session=<id>      本会话当前档位 + 可见/隐藏
//   POST /skill-sets/api/set   {session, sets}   启停档位
//   GET  /skill-sets/api/library                 全部分类定义（名称/简介/技能 + 该档选项）
//   GET  /skill-sets/api/presets                 可绑定的 agent preset 列表
//   POST /skill-sets/api/set-skills {set,skill,on} | {set,skills:[...]}
//                                   | {set,denyTools:[...]} | {set,preset:"id"}
//                                   | {auditSeconds:n}
//                                                设置面板：按档保存各项配置
// 状态由宿主按会话持久化在 ~/.dsh/skill-sets.json，刷新页面后保持不变。
//
// 铁律：图标一律内联 SVG（stroke=currentColor），禁 emoji；颜色全走主题 token，
// 深浅色通吃；点外面 / Esc 关闭；折叠用 grid-template-rows 对称过渡，不跳变。

window.__ModuleLoader__.load({
  id: 'dsh-skill-sets',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    var React = require('react');
    const h = React.createElement;

    const ROUTE_STATE = '/skill-sets/api/state';
    const ROUTE_SET = '/skill-sets/api/set';
    const ROUTE_LIBRARY = '/skill-sets/api/library';
    const ROUTE_SET_SKILLS = '/skill-sets/api/set-skills';
    const ROUTE_PRESETS = '/skill-sets/api/presets';

    // —— 档位定义（id / 短名 / 图标必须与 lib/skill-sets.js 的 SET_ORDER 对齐）——
    // label 与 count 只作首帧兜底；接口一回来就用宿主的真实数据覆盖。
    // count 口径 = SKILL_SETS[id].skills.length（2026-09-21 整定后实测值）。
    const SET_DEFS = [
      { id: 'base', label: '基础底座', hint: '脚本·软件手册·技能·排查', short: '底座', count: 8, icon: 'mark' },
      { id: 'sim', label: '仿真与计算', hint: 'PLECS 批跑·MATLAB·符号·统计', short: '仿真计算', count: 9, icon: 'wave' },
      { id: 'math', label: 'MATLAB 与 Simulink', hint: 'MATLAB·Simulink·Simscape 流程', short: 'MATLAB', count: 31, icon: 'sigma' },
      { id: 'hardware', label: '硬件与嵌入式', hint: '原理图/PCB·MCU 固件·审查', short: '硬件嵌入式', count: 7, icon: 'chip' },
      { id: 'figure', label: '科研出图与制图', hint: '数据图·框图·复习导图', short: '出图制图', count: 15, icon: 'chart' },
      { id: 'doc', label: '论文与文档', hint: '写作·文献·投稿返修·格式互转', short: '论文文档', count: 31, icon: 'doc' },
      { id: 'dev', label: '写代码与工程', hint: '代码·测试·CI·排查·计划规格', short: '代码工程', count: 61, icon: 'terminal' },
      { id: 'design', label: '设计视觉', hint: '网页 UI·组件·图标·品牌·配图', short: '设计视觉', count: 28, icon: 'pen' },
      { id: 'ops', label: '改 DSH 运维', hint: '插件·配置·token·升级', short: '运维', count: 5, icon: 'terminal' },
      { id: 'life', label: '陪伴与生活', hint: '情绪·哲学对话·追问复盘·跑腿', short: '陪伴生活', count: 39, icon: 'heart' },
    ];
    const TOTAL_FALLBACK = 100;
    const ALWAYS_FALLBACK = ['default-settings', 'genui'];

    function insertStyles(css) {
      try {
        // 先摘掉本插件此前注入的样式表再插新的：否则插件热重载后旧 CSS 会留着，改动看不到。
        for (const old of document.querySelectorAll('style[data-dsh-skill-sets]')) { try { old.remove() } catch { /* ignore */ } }
        const style = document.createElement('style');
        style.setAttribute('data-dsh-skill-sets', '');
        style.textContent = css;
        document.head.appendChild(style);
        return () => { try { style.remove() } catch { /* ignore */ } };
      } catch {
        return () => {};
      }
    }

    const CSS = `
.dss-dock{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,780px);margin:0 auto 8px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;position:relative;z-index:20;container-type:inline-size;}
@container (width<=420px){.dss-pill-count{display:none;}}
@container (width<=320px){.dss-pill-title{display:none;}}
.dss-pill{box-sizing:border-box;max-width:100%;height:28px;display:inline-flex;align-items:center;gap:7px;padding:0 8px 0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-specific-tip,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:12px;line-height:1;transition:background .15s ease,color .15s ease,border-color .15s ease;}
.dss-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dss-pill.dss-on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);color:var(--dsw-alias-label-primary);}
.dss-mark{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);}
.dss-pill.dss-on .dss-mark{color:var(--dsw-alias-state-business-primary);}
.dss-pill-title{flex:none;font-weight:500;}
.dss-pill-count{flex:none;display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-caption);font-size:11px;line-height:1;font-variant-numeric:tabular-nums;}
.dss-pill-count.dss-pill-countOn{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 13%,transparent);color:var(--dsw-alias-state-business-primary);}
.dss-pill-chev{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .18s ease;}
.dss-pill.dss-open .dss-pill-chev{transform:rotate(180deg);}
.dss-err{flex:none;margin-left:8px;font-size:11px;color:var(--dsw-alias-state-error-primary);white-space:nowrap;}
.dss-drawer{width:100%;display:grid;grid-template-rows:0fr;transition:grid-template-rows .2s ease;}
.dss-drawer.dss-open{grid-template-rows:1fr;}
.dss-drawer-inner{overflow:hidden;min-height:0;opacity:0;transition:opacity .18s ease;}
.dss-drawer.dss-open .dss-drawer-inner{opacity:1;}
.dss-panel{margin-bottom:6px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-2));}
.dss-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:6px;}
.dss-card{position:relative;box-sizing:border-box;width:100%;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px 4px 7px;border:1px solid transparent;border-radius:9px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;text-align:center;transition:background .15s ease,color .15s ease,border-color .15s ease;}
.dss-card:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dss-card.dss-on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-label-primary);}
/* 自动路由建议加开：虚线边框提示，点了才算开启（中途切档要重算整段前缀）。 */
.dss-card.dss-suggested{border-style:dashed;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary)) 55%,transparent);}
.dss-suggest-hint{margin-left:8px;color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary));}
.dss-card:disabled{cursor:default;opacity:.55;}
.dss-card-glyph{display:inline-flex;color:currentColor;}
.dss-card.dss-on .dss-card-glyph{color:var(--dsw-alias-state-business-primary);}
.dss-card-label{max-width:100%;font-size:12px;font-weight:500;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dss-card-hint{max-width:100%;font-size:10px;line-height:13px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dss-card-count{font-size:10px;line-height:12px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap;}
.dss-card.dss-on .dss-card-count{color:var(--dsw-alias-state-business-primary);}
.dss-check{position:absolute;top:5px;right:5px;display:inline-flex;color:var(--dsw-alias-state-business-primary);}
.dss-count{display:flex;justify-content:flex-end;margin-top:8px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap;}
.dss-count b{font-weight:600;color:var(--dsw-alias-label-secondary);margin:0 3px;}
/* —— 设置面板（settings.section）—— */
.dsss-root{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:760px;}
.dsss-head{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-l1);container-type:inline-size;}
@container (width<=560px){.dsss-head-hint{display:none;}.dsss-search{width:130px;}}
@container (width<=440px){.dsss-total{display:none;}.dsss-search{width:100px;}}
.dsss-head-text{min-width:0;display:flex;flex-direction:column;gap:2px;}
.dsss-head-title{font-size:14px;font-weight:600;}
.dsss-head-hint{font-size:12px;color:var(--dsw-alias-label-secondary);}
.dsss-total{flex:none;margin-left:auto;padding-left:10px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap;}
.dsss-list{display:flex;flex-direction:column;gap:8px;}
.dsss-card{box-sizing:border-box;width:100%;display:grid;grid-template-columns:26px 1fr;gap:10px;align-items:start;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-3,transparent);font-family:inherit;text-align:left;color:inherit;}
.dsss-glyph{display:inline-flex;padding-top:1px;color:var(--dsw-alias-label-tertiary);}
.dsss-body{min-width:0;display:flex;flex-direction:column;gap:6px;}
.dsss-name{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;font-weight:600;}
.dsss-name em{font-style:normal;font-size:11px;font-weight:500;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;}
.dsss-desc{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dsss-skills{display:flex;flex-wrap:wrap;gap:6px;}
.dsss-skill{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;max-width:100%;height:26px;padding:0 9px 0 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-caption);font-family:inherit;font-size:11px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease;}
.dsss-skill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}
.dsss-skill.dsss-skill-on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);color:var(--dsw-alias-label-primary);}
.dsss-skill.dsss-skill-on .dsss-sw{color:var(--dsw-alias-state-business-primary);}
.dsss-skill:disabled{cursor:default;opacity:.55;}
.dsss-sw{flex:none;display:inline-flex;}
.dsss-sw svg{display:block;}
.dsss-skill-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dsss-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-caption);}
.dsss-err{font-size:12px;color:var(--dsw-alias-state-error-primary);}
/* —— 搜索 / 批量 / 高级选项 —— */
.dsss-search{flex:none;width:170px;height:26px;box-sizing:border-box;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;}
.dsss-search:focus{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);}
.dsss-setops{margin-left:auto;display:inline-flex;align-items:center;gap:5px;}
.dsss-mini{flex:none;height:21px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-caption);font-family:inherit;font-size:11px;line-height:1;cursor:pointer;transition:background .15s ease,color .15s ease;}
.dsss-mini:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dsss-mini:disabled{cursor:default;opacity:.5;}
.dsss-ops{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-top:2px;}
.dsss-field{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-caption);}
.dsss-input{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11px;}
.dsss-input:focus{outline:none;border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);}
.dsss-input.dsss-tools{width:190px;}
.dsss-audit{width:56px;text-align:center;font-variant-numeric:tabular-nums;}
.dsss-empty{font-size:11px;color:var(--dsw-alias-label-caption);}

`;

    // —— 内联 SVG 图标（统一 viewBox 0 0 24 24 / stroke=currentColor）——
    function svg(inner, size) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size || 14,
        height: size || 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        dangerouslySetInnerHTML: { __html: inner },
      });
    }

    const P = {
      mark: '<rect x="3" y="3" width="18" height="13" rx="3"/><path d="M6.5 19.6h11"/><path d="M9 21.6h6"/>',
      wave: '<path d="M3 12c2.5-6 4.5-6 7 0s4.5 6 7 0"/>',
      sigma: '<path d="M17 4H7l5 8-5 8h10"/>',
      chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
      cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2.6v3.4M15 2.6v3.4M9 18v3.4M15 18v3.4M2.6 9H6M2.6 15H6M18 9h3.4M18 15h3.4"/>',
      chart: '<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V7"/><path d="M17 20v-9"/>',
      doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
      folder: '<path d="M3 7.5A2 2 0 0 1 5 5.5h3.6l2 2.4H19a2 2 0 0 1 2 2v8.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
      pen: '<path d="M12 3 19 10l-7 11L5 10z"/><path d="M12 3v7M5 10h14"/>',
      terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 9.5 10 12l-2.5 2.5"/><path d="M13 15h4"/>',
      bug: '<path d="M8 7V5.5a4 4 0 0 1 8 0V7"/><rect x="7" y="7" width="10" height="11" rx="5"/><path d="M3 11h4M17 11h4M3 16h4M17 16h4M12 18v3"/>',
      compass: '<circle cx="12" cy="12" r="9"/><path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z"/>',
      heart: '<path d="M12 20.2s-7-4.35-7-9.3A4.4 4.4 0 0 1 12 8.2a4.4 4.4 0 0 1 7 2.7c0 4.95-7 9.3-7 9.3z"/>',
      box: '<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5 12 13l9-4.5M12 13v7"/>',
      chevron: '<path d="M6 9l6 6 6-6"/>',
      check: '<circle cx="12" cy="12" r="9" fill="currentColor" stroke="none"/><path d="M8.4 12.2l2.5 2.5 4.7-5.2" stroke="var(--dsw-alias-bg-layer-2)" stroke-width="2"/>',
      swOn: '<rect x="2.5" y="7" width="19" height="10" rx="5" fill="currentColor" stroke="none"/><circle cx="16.6" cy="12" r="3.4" fill="var(--dsw-alias-bg-layer-2)" stroke="none"/>',
      swOff: '<rect x="2.5" y="7" width="19" height="10" rx="5" fill="none"/><circle cx="7.4" cy="12" r="3.2" fill="currentColor" stroke="none"/>',
    };
    const iconOf = (key, size) => svg(P[key] || P.mark, size);
    const defOf = (id) => SET_DEFS.find((s) => s.id === id);

    async function apiGet(path) {
      const res = await fetch(path);
      return await res.json();
    }

    // ====================================================================== dock ==
    // 输入框上方那枚 pill。悬停不弹任何内容（不注册 title、不做浮层）。
    function SkillSetsDock(props) {
      const sessionId = props.sessionId;
      const [open, setOpen] = React.useState(false);
      const [view, setView] = React.useState(null);
      const [err, setErr] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        if (!sessionId) return undefined;
        let alive = true;
        apiGet(ROUTE_STATE + '?session=' + encodeURIComponent(sessionId))
          .then((v) => { if (alive && v) { setView(v); setErr(''); } })
          .catch(() => { if (alive) setErr('读取失败'); });
        return () => { alive = false; };
      }, [sessionId]);

      React.useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => {
          const root = rootRef.current;
          if (root && !root.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('pointerdown', onDown, true);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      const active = (view && Array.isArray(view.active)) ? view.active : [];
      // 自动路由在中途轮次只给建议（切档要重算整段前缀，见 host 的 autoroute）。
      const suggested = (view && Array.isArray(view.suggested)) ? view.suggested : [];
      const sets = (view && Array.isArray(view.sets) && view.sets.length) ? view.sets : SET_DEFS;
      const labelOf = (id) => {
        const dyn = sets.find((s) => s && s.id === id);
        return (dyn && dyn.label) || (defOf(id) ? defOf(id).label : id);
      };
      const total = Math.max(1, (view && Number(view.total)) || TOTAL_FALLBACK);
      const visible = Math.max(1, (view && Number(view.visible)) || total);

      const submit = (next) => {
        if (busy || !sessionId) return;
        setBusy(true);
        setErr('');
        fetch(ROUTE_SET, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: sessionId, sets: next }),
        })
          .then((r) => r.json())
          .then((v) => {
            if (v && v.ok) setView(v);
            else setErr('切换失败');
          })
          .catch(() => setErr('切换失败'))
          .then(() => setBusy(false));
      };

      const toggle = (id) => {
        submit(active.includes(id) ? active.filter((x) => x !== id) : active.concat([id]));
      };

      const shown = SET_DEFS.map((def) => {
        const dyn = sets.find((s) => s && s.id === def.id);
        return dyn ? { ...def, ...dyn } : def;
      });
      const countOf = (s) => (Number.isFinite(s.skills) ? s.skills : (defOf(s.id) ? defOf(s.id).count : 0));

      return h('div', { className: 'dss-dock', ref: rootRef },
        h('button', {
          type: 'button',
          className: 'dss-pill' + (active.length ? ' dss-on' : '') + (open ? ' dss-open' : ''),
          onClick: () => setOpen(!open),
          // 收起态只报个数（原来把开启的档位逐个铺成 chip，7 档就很占地方）：全部档名放 title，展开抽屉里也看得到。
          title: active.length
            ? '本会话技能档（' + active.length + '）：' + active.map((id) => labelOf(id)).join(' + ')
            : '本会话未开启技能档',
          'aria-expanded': open,
          'aria-label': open ? '收起技能档' : '展开技能档',
        },
          h('span', { className: 'dss-mark' }, iconOf('mark', 15)),
          h('span', { className: 'dss-pill-title' }, '技能档'),
          h('span', { className: 'dss-pill-count' + (active.length ? ' dss-pill-countOn' : '') },
            active.length ? String(active.length) + ' 档' : '未开启',
          ),
          err ? h('span', { className: 'dss-err' }, err) : null,
          h('span', { className: 'dss-pill-chev' }, iconOf('chevron', 13)),
        ),
        h('div', { className: 'dss-drawer' + (open ? ' dss-open' : '') },
          h('div', { className: 'dss-drawer-inner' },
            h('div', { className: 'dss-panel' },
              h('div', { className: 'dss-grid' },
                shown.map((s) => {
                  const on = active.includes(s.id);
                  const hinted = !on && suggested.includes(s.id);
                  return h('button', {
                    key: s.id,
                    type: 'button',
                    className: 'dss-card' + (on ? ' dss-on' : '') + (hinted ? ' dss-suggested' : ''),
                    title: hinted ? '自动路由建议加开本档（点了才算开启）' : undefined,
                    onClick: () => toggle(s.id),
                    disabled: busy || !sessionId,
                    'aria-pressed': on,
                  },
                    on ? h('span', { className: 'dss-check' }, iconOf('check', 11)) : null,
                    h('span', { className: 'dss-card-glyph' }, iconOf(s.icon, 19)),
                    h('span', { className: 'dss-card-label', title: s.label || s.id }, s.label || s.id),
                    s.hint ? h('span', { className: 'dss-card-hint', title: s.hint }, s.hint) : null,
                    h('span', { className: 'dss-card-count' }, countOf(s) + ' 技能'),
                  );
                }),
              ),
              h('div', { className: 'dss-count' },
                '本档可见', h('b', null, String(visible)), '/', String(total),
                suggested.length
                  ? h('span', { className: 'dss-suggest-hint' },
                      '· 路由建议加开 ' + suggested.map((id) => labelOf(id)).join(' + '))
                  : null,
              ),
            ),
          ),
        ),
      );
    }

    // ============================================================== settings ==
    // 设置面板「技能档」分区：完整分类配置（名称 / 简介 / 技能清单 / 启停）。
    // 设置面板：只按「档位」管技能 —— 每条技能一个开关，关掉只从它所属的档位剔除。
    function SkillSetsSettings() {
      const [lib, setLib] = React.useState(null);
      const [off, setOff] = React.useState({});
      const [opts, setOpts] = React.useState({});
      const [presets, setPresets] = React.useState([]);
      const [audit, setAudit] = React.useState('20');
      const [q, setQ] = React.useState('');
      const [err, setErr] = React.useState('');
      const [busy, setBusy] = React.useState('');

      const absorb = (v) => {
        const map = {};
        const o = {};
        for (const s of (v && Array.isArray(v.sets) ? v.sets : [])) {
          map[s.id] = new Set(Array.isArray(s.disabled) ? s.disabled : []);
          o[s.id] = {
            denyTools: Array.isArray(s.denyTools) ? s.denyTools.join(', ') : '',
            preset: typeof s.preset === 'string' ? s.preset : '',
          };
        }
        setOff(map);
        setOpts(o);
        if (v && Number.isFinite(Number(v.auditSeconds))) setAudit(String(v.auditSeconds));
      };

      React.useEffect(() => {
        let alive = true;
        apiGet(ROUTE_LIBRARY)
          .then((v) => { if (!alive || !v) return; setLib(v); absorb(v); })
          .catch(() => { if (alive) setErr('技能档定义读取失败'); });
        apiGet(ROUTE_PRESETS)
          .then((v) => { if (alive && v && Array.isArray(v.presets)) setPresets(v.presets); })
          .catch(() => { /* 预设是可选项：取不到就只留手填 */ });
        return () => { alive = false; };
      }, []);

      const sets = (lib && Array.isArray(lib.sets) && lib.sets.length) ? lib.sets : SET_DEFS;
      const offOf = (id) => off[id] || new Set();
      const optOf = (id) => opts[id] || { denyTools: '', preset: '' };

      const post = (body) => fetch(ROUTE_SET_SKILLS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());

      const toggle = (setId, skill) => {
        const key = setId + '/' + skill;
        if (busy) return;
        const before = offOf(setId);
        const on = before.has(skill); // it is off right now -> this click turns it back on
        const next = new Set(before);
        if (on) next.delete(skill); else next.add(skill);
        setBusy(key);
        setErr('');
        setOff((prev) => ({ ...prev, [setId]: next })); // optimistic: no flicker while saving
        fetch(ROUTE_SET_SKILLS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set: setId, skill, on }),
        })
          .then((r) => r.json())
          .then((v) => {
            if (v && v.ok) {
              setOff((prev) => ({ ...prev, [setId]: new Set(Array.isArray(v.disabled) ? v.disabled : []) }));
            } else {
              setOff((prev) => ({ ...prev, [setId]: before }));
              setErr('保存失败');
            }
          })
          .catch(() => {
            setOff((prev) => ({ ...prev, [setId]: before }));
            setErr('保存失败');
          })
          .then(() => setBusy(''));
      };

      // 整档全开 / 全关：一次替换该档的关闭清单。
      const bulk = (setId, all, on) => {
        if (busy) return;
        const before = offOf(setId);
        setBusy(setId + '/*');
        setErr('');
        setOff((prev) => ({ ...prev, [setId]: on ? new Set() : new Set(all) }));
        fetch(ROUTE_SET_SKILLS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set: setId, skills: all, on }),
        })
          .then((r) => r.json())
          .then((v) => {
            if (v && v.ok) setOff((prev) => ({ ...prev, [setId]: new Set(Array.isArray(v.disabled) ? v.disabled : []) }));
            else { setOff((prev) => ({ ...prev, [setId]: before })); setErr('保存失败'); }
          })
          .catch(() => { setOff((prev) => ({ ...prev, [setId]: before })); setErr('保存失败'); })
          .then(() => setBusy(''));
      };

      const editOpt = (setId, field, value) => {
        setOpts((prev) => ({
          ...prev,
          [setId]: { ...(prev[setId] || { denyTools: '', preset: '' }), [field]: value },
        }));
      };

      // 保存一项高级配置（失焦或回车触发）：禁工具名单 / 绑定的 agent preset。
      const saveOpt = (setId, field) => {
        if (busy) return;
        const cur = optOf(setId);
        const body = field === 'denyTools'
          ? {
              set: setId,
              denyTools: String(cur.denyTools || '').split(/[\s,，]+/).map((t) => t.trim()).filter(Boolean),
            }
          : { set: setId, preset: String(cur.preset || '').trim() };
        setBusy(setId + '/' + field);
        setErr('');
        post(body)
          .then((v) => {
            if (!v || !v.ok) { setErr('保存失败'); return; }
            setOff((prev) => ({ ...prev, [setId]: new Set(Array.isArray(v.disabled) ? v.disabled : []) }));
            setOpts((prev) => ({
              ...prev,
              [setId]: { denyTools: (v.denyTools || []).join(', '), preset: v.preset || '' },
            }));
          })
          .catch(() => setErr('保存失败'))
          .then(() => setBusy(''));
      };

      // 全局漏遮蔽巡检间隔（秒，0 = 关）：只有激活了档位的会话才走这条巡检。
      const saveAudit = () => {
        const seconds = Number(audit);
        if (!Number.isFinite(seconds) || seconds < 0) {
          setAudit(String((lib && lib.auditSeconds) || 20));
          return;
        }
        post({ auditSeconds: seconds })
          .then((v) => { if (v && v.ok) setAudit(String(v.auditSeconds)); else setErr('保存失败'); })
          .catch(() => setErr('保存失败'));
      };

      const total = sets.reduce((n, s) => n + ((Array.isArray(s.skills) ? s.skills.length : 0)), 0);
      const offCount = sets.reduce((n, s) => n + offOf(s.id).size, 0);
      const query = q.trim().toLowerCase();

      return h('div', { className: 'dsss-root' },
        h('div', { className: 'dsss-head' },
          h('span', { className: 'dsss-glyph' }, iconOf('mark', 22)),
          h('div', { className: 'dsss-head-text', title: '这里只定「每个档位装了哪些技能」：关掉某条只从它所属的档位里剔除，其他档位不受影响。某个会话激活哪些档，仍在输入框上方的「技能档」里切换。' },
            h('span', { className: 'dsss-head-title' }, '技能档分类'),
          ),
          h('input', {
            className: 'dsss-search',
            type: 'search',
            value: q,
            placeholder: '搜索技能名…',
            'aria-label': '搜索技能名',
            onChange: (e) => setQ(e.target.value),
          }),
          lib ? h('span', { className: 'dsss-total' }, (total - offCount) + ' / ' + total + ' 条启用') : null,
        ),
        h('div', { className: 'dsss-ops' },
          h('span', { className: 'dsss-field', title: '单位：秒；0 = 关闭。会话未激活任何档位时不巡检，零开销' }, '漏遮蔽巡检',
            h('input', {
              className: 'dsss-input dsss-audit',
              type: 'text',
              inputMode: 'numeric',
              value: audit,
              'aria-label': '漏遮蔽巡检间隔（秒）',
              onChange: (e) => setAudit(e.target.value),
              onBlur: saveAudit,
              onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveAudit(); } },
            }),
            '秒',
          ),
        ),
        err ? h('div', { className: 'dsss-err' }, err) : null,
        h('div', { className: 'dsss-list' },
          sets.map((s) => {
            const def = defOf(s.id) || {};
            const names = Array.isArray(s.skills) ? s.skills : [];
            const cur = offOf(s.id);
            const shown = query ? names.filter((n) => n.toLowerCase().includes(query)) : names;
            const opt = optOf(s.id);
            return h('div', { key: s.id, className: 'dsss-card' },
              h('span', { className: 'dsss-glyph' }, iconOf(def.icon, 18)),
              h('div', { className: 'dsss-body' },
                h('div', { className: 'dsss-name' },
                  s.label || s.id,
                  h('em', null, s.id + ' · ' + (names.length - cur.size) + '/' + names.length),
                  h('span', { className: 'dsss-setops' },
                    h('button', {
                      type: 'button', className: 'dsss-mini', disabled: !!busy || !names.length,
                      onClick: () => bulk(s.id, names, true),
                    }, '全开'),
                    h('button', {
                      type: 'button', className: 'dsss-mini', disabled: !!busy || !names.length,
                      onClick: () => bulk(s.id, names, false),
                    }, '全关'),
                  ),
                ),
                h('div', { className: 'dsss-desc', title: s.brief || '' }, s.brief || '（该档暂无简介）'),
                h('div', { className: 'dsss-skills' },
                  shown.map((name) => {
                    const on = !cur.has(name);
                    const key = s.id + '/' + name;
                    return h('button', {
                      key,
                      type: 'button',
                      className: 'dsss-skill' + (on ? ' dsss-skill-on' : ''),
                      disabled: busy === key,
                      'aria-pressed': on,
                      onClick: () => toggle(s.id, name),
                    },
                      h('span', { className: 'dsss-sw' }, iconOf(on ? 'swOn' : 'swOff', 18)),
                      h('span', { className: 'dsss-skill-name' }, name),
                    );
                  }),
                ),
                query && !shown.length
                  ? h('div', { className: 'dsss-empty', title: '该档没有匹配「' + q.trim() + '」的技能' }, '无匹配')
                  : null,
                h('div', { className: 'dsss-ops' },
                  h('span', { className: 'dsss-field' }, '禁工具',
                    h('input', {
                      className: 'dsss-input dsss-tools',
                      type: 'text',
                      value: opt.denyTools,
                      placeholder: '如 bash, jobs（空 = 不裁）',
                      'aria-label': '该档禁用的工具名，逗号分隔',
                      onChange: (e) => editOpt(s.id, 'denyTools', e.target.value),
                      onBlur: () => saveOpt(s.id, 'denyTools'),
                      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveOpt(s.id, 'denyTools'); } },
                    }),
                  ),
                  h('span', { className: 'dsss-field' }, 'agent preset',
                    h('input', {
                      className: 'dsss-input',
                      type: 'text',
                      list: 'dsss-presets',
                      value: opt.preset,
                      placeholder: presets.length ? '选择或留空' : '（无可用预设）',
                      'aria-label': '该档绑定的 agent preset id',
                      onChange: (e) => editOpt(s.id, 'preset', e.target.value),
                      onBlur: () => saveOpt(s.id, 'preset'),
                      onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); saveOpt(s.id, 'preset'); } },
                    }),
                  ),
                ),
              ),
            );
          }),
        ),
        h('datalist', { id: 'dsss-presets' },
          presets.map((p) => h('option', { key: p.id, value: p.id }, p.name || p.id)),
        ),
        h('div', { className: 'dsss-hint', title: '常驻技能在任何档位下都可见，不参与开关；档外技能在本会话既不出现在技能清单里，也无法被 skill 工具加载。两项高级项按档生效、默认全空：禁工具走 tools.restrict 的拒绝名单，agent preset 只在该档被激活时才把会话切到该预设。' },
          '常驻：' + ((lib && Array.isArray(lib.alwaysOn) ? lib.alwaysOn : ALWAYS_FALLBACK).join(' · ')),
        ),
      );
    }

    const inject = ['slots'];

    function apply(ctx) {
      insertStyles(CSS);
      const slots = ctx.get('slots');
      if (slots === undefined) return;
      // 直接调用 slots.inject，绝不包 ctx.effect（否则 client bundle 报
      // "loaded without registering"）；register 自带 dispose。
      slots.inject('vk.input.right', () => slots.register({
        name: 'vk.input.right',
        id: 'dsh-skill-sets',
        order: 5,
        label: '技能档',
        inject: (sessionId) => ({ sessionId }),
      }, SkillSetsDock));
      slots.inject('vk.settings.extra', () => slots.register({
        name: 'vk.settings.extra',
        id: 'skill-sets',
        order: 4,
        label: '技能档',
      }, SkillSetsSettings));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
