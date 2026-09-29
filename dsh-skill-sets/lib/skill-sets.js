/**
 * Skill-set definitions for the DSH skill-sets plugin.
 *
 * Naming (deliberate): a "skill set" (技能档) only controls WHICH SKILLS are visible and adds a
 * short brief of working rules for the active set - it never restates identity.
 *
 * Model
 *   - `alwaysOn` skills are ALWAYS visible, whatever sets are active.
 *   - Every other skill belongs to exactly ONE set (no overlap by design).
 *   - Active sets are additive: visible = alwaysOn + union(skills of active sets).
 *   - With NO active set the plugin shows ONLY the always-on skills and hides every
 *     other skill (clean-desk default), while injecting a one-line hint listing the
 *     set menu so a set can still be opened on demand.
 *   - 可见性只看策展名单：a skill is visible iff it is in `ALWAYS_ON_SKILLS` or in the
 *     `skills` array of an ACTIVE set. Nothing else feeds visibility — the frontmatter
 *     `skill-set:` field and the keyword fallback are diagnostics only, so a keyword
 *     hit can no longer hide a skill and a frontmatter line can no longer look like it
 *     filed one.
 *   - 未归档技能收敛到 `unclassified`（`planVisibility` 的返回值里点名，维护工具
 *     `tools/classify-report.mjs` 报出来），既不进目录也不被关键词藏起来；新增技能
 *     必须显式写进目标档的 `skills` 数组。
 *
 * 改版历史
 * ---------------------------------------------------------------------------
 * 2026-09-20 第二次改版（用户：加一个默认底座档、首轮自动判断开档、档名要一眼看懂）：
 *   - 新增 `base` 基础底座档，作为新会话的唯一默认档（defaultSets = ["base"]）。
 *   - 所有 label 改为口语化动宾短语，并加 `hint` 一行短说明给 GUI 画卡片。
 *   - 2026-09-19 那次「整定」只砍了本文件的 skills 列表，既没退役技能文件也没重启
 *     验证：磁盘上 44 个技能落 unclassified 常驻可见。之后按运行时注册表重新归档。
 *
 * 2026-09-20 第三次改版（用户：只有 1 个技能的档并入其他档）：退役 `delivery` 档，
 *   mt-paotui-for-client 并入 companion（档名改「陪伴与生活」）。
 *
 * 2026-09-20 第四次改版（用户：19 档分得太细，同类型整定到一起，不要杂乱）：
 *   19 档 → 9 档，按「同一类活儿」重排，不再是每种小产出各占一格：
 *     base      基础底座        （不变，5 个通用技能）
 *     sim       仿真与计算       ← 旧 sim + sci（PLECS 批跑 & MATLAB/符号/统计/优化）
 *     hardware  硬件与嵌入式     ← 旧 hardware + mcu（原理图/PCB & MCU 固件）
 *     figure    科研出图与制图   ← 旧 data + diagram + mindmap（数据图/框图/导图）
 *     doc       论文与文档       ← 旧 write + acad + convert（写作/投稿/格式互转/转录）
 *     dev       写代码与工程     ← 旧 se + debug + plan（开发/排查/计划规格）
 *     design    设计视觉         （保留独立，27 个纯视觉技能）
 *     ops       改 DSH 运维      （不变，4 个）
 *     life      陪伴与生活       ← 旧 companion + cognitive（追问/复盘并入生活）
 *   - 迁移原则：把一个技能放回它「被真正调用时所在的那件事」，而不是它产出的文件后缀。
 *     PPT 归 doc（汇报也是交付文档）、排查归 dev（排查对象就是代码/工程）、
 *     统计与绘图分开（sci 的计算进 sim，纯画图进 figure）。
 *   - 旧档 id 一律进 `SET_ALIASES` 静默映射到新档：老会话存下的档位照常生效，
 *     不会因为改版丢失技能面（`loadConfig` / `applySets` 都过一遍别名）。
 *   - `lib/client.js` 的 SET_DEFS 是客户端首帧兜底表，id 必须与 SET_ORDER 对齐
 *     —— 增删档位时两处都要改，改完需重启 DSH 重新打包客户端。
 *
 * **编号对照（2026-09-22）**：以下改版历史里的 `rule N` 是当时 AGENTS.md 的编号；AGENTS.md 已改用稳定 slug 作引用 ID（写法 `AGENTS.md › slug`），对照：rule 15 = `skill-set-first-turn`、rule 24 = `copy-voice`。历史叙述保留原编号。
 *
 * 2026-09-20 第五次改版（用户：写网页/文案很人机，要一个去人机感的技能）：
 *   - 新增 `human-copy`（中文界面与产品文案的写法与改稿），归 `design` 档，
 *     与 `human-writing` 分工：长帖创作走 human-writing，界面/产品文案走 human-copy。
 *     技能在 `~/.dsh/skills/human-copy/`；常驻约束见 `~/.dsh/AGENTS.md` rule 24。
 *   - **新技能必须显式写进目标档的 `skills` 数组**。`planVisibility` 只拿
 *     `SKILL_SETS[id].skills` 构造可见集，`resolveSkill` 的关键词 fallback 只影响
 *     unclassified 统计、不参与可见性判定——指望关键词自动归档会让技能永远被隐藏。
 *
 * 2026-09-21 第六次改版（用户：重新整定技能档分类 + 首轮之外只许建议不许自行切档）：
 *   A. 分类整定（按磁盘实际技能正文复核，共 5 个错置归位，SET_ORDER/label 不变）：
 *      - `scientific-visualization` sim → figure。正文是「matplotlib/seaborn/plotly
 *        出可发表图 + 多面板 + 不确定度绘制 + 配色对比 + 期刊导出」，纯出图；
 *        且 figure 的 mustLead 一直点它的名，归档与口径自相矛盾。
 *      - `ask-matt`、`using-agent-skills` dev → base。两者都是「该用哪个技能/该走哪条
 *        流程」的路由元技能，与 skill-creator / context-engineering 同类，属技能面本身。
 *      - 复核后确认归位正确的（不动）：`algorithmic-art` / `canvas-design`（visual art，
 *        design）、`experiment` / `probe` / `brainstorm` / `frame-problem`（Cynefin 决策
 *        探针，life 的 cognitive-toolkit 族）、`research`（高信任源调研，dev）、
 *        `grilling` / `wayfinder` / `wizard` / `handoff`（工程规划与交接，dev）。
 *      - 卫生：删掉重复的 `full-output-enforcement`（磁盘上已无该技能，仅清单残留）。
 *   B. 首轮闸门（用户：「必须执行只有首轮可以自主切换档位，其余对话只能建议开启」）：
 *      - `lib/index.js` 新增 `firstTurnSeen`（按 sessionId），`agent/pre-step` 首次触发时
 *        打标；`skill_set` 的 set/add/remove 在第 2 轮起直接拒绝（返回建议文案而非报错），
 *        与 autoroute「首轮应用、之后只建议」的成本口径保持一致。
 *      - 同轮的多个 step 都算首轮；install/重启会清空标记，行为与会话一致。
 *   C. 口径同步：`~/.dsh/AGENTS.md` rule 15「首轮定档一次」升级为强制条款；
 *      `lib/client.js` SET_DEFS 的 count / mustLead 口径跟着改（客户端首帧兜底表）。
 *
 * 2026-09-21 第七次改版（用户：切档会弹那个对话框、首轮又没触发，「不要写脚本了，
 *   写到 AGENTS.md 里面」）：**脚本路由整体退役** —— 本文件删掉 `ROUTE_STRONG` /
 *   `routeStrongKeys` / `autoroutePlan`（关键词评分与元讨论抑制一并消失），
 *   `lib/index.js` 删掉 `autoroute` / `injectSetPicker` 两种气泡注入与首轮静默开档。
 *   首轮定档改由模型读 `~/.dsh/AGENTS.md` rule 15 后自己调 `skill_set`；「只有首轮
 *   可切档」的硬闸门（工具侧拒绝）保留。备份：`backups\skill-sets-drop-autoroute-20260921-104555\`。
 *
 * 2026-09-29 第八次改版（可见性判据收敛，用户：未归档技能不许漏进目录）：
 *   - `planVisibility` 不再读 `skill-set:` frontmatter、也不再走关键词兜底：可见 = 常驻
 *     名单 ∪「正在生效的档」的策展名单。改前那条兜底方向是反的——关键词命中会把技能
 *     归进某档并隐藏，未命中反而常驻可见；frontmatter 更只可能把技能藏起来（它从不会
 *     让它可见），所以那两处等于死代码。
 *   - 未归档技能一律进 `unclassified`（既不进目录、也不被关键词藏起来），维护工具
 *     `tools/classify-report.mjs` 新增 `not-curated` 指标报出来；当前磁盘 236 个技能
 *     为 0，规则收紧不会隐藏任何在册技能。
 */

export const ALWAYS_ON_SKILLS = ["default-settings", "genui"];

/**
 * Injected when NO set is active. Deliberately ONE line: it is the only always-carrying
 * notice of the set menu, and an empty catalog means the model cannot discover the sets
 * by itself. Built lazily so it never depends on declaration order.
 */
export const EMPTY_SETS_BRIEF_PREFIX =
  "技能档：默认未开启（技能清单仅留常驻项）。按任务类型用 skill_set 开档即可解锁对应技能：";

/** One-line set menu, e.g. "base 基础底座｜sim 仿真与计算｜…". Safe at any time. */
export function setMenuLine() {
  return SET_ORDER.map((id) => id + " " + (SKILL_SETS[id] ? SKILL_SETS[id].label : "")).join("｜");
}

/** Kept for compatibility: the full one-line brief shown while no set is active. */
export function emptySetsBrief() {
  return EMPTY_SETS_BRIEF_PREFIX + setMenuLine();
}

/**
 * Set ids in menu order. Order also breaks keyword-score ties.
 * `base` first: it is the default set and the reference point for first-turn routing.
 * Left to right is deliberately "每天用 → 偶尔用": 硬件/仿真/论文/出图在前，
 * 纯视觉与生活类在后，模型挑档时先撞见高频档。
 */
export const SET_ORDER = [
  "base",
  "sim", "math", "hardware", "figure", "doc", "dev",
  "design", "ops", "life",
];

/**
 * Retired set ids -> the set that absorbed them (2026-09-20 第四次改版).
 * Resolution happens on READ (config load / skill_set set|add / visibility plan), so an
 * old session keeps working and its stored op log never silently drops a set.
 * Do NOT add an alias for an id that is still a live set - a live set always wins.
 */
export const SET_ALIASES = {
  // sim + sci
  sci: "sim",
  // math + matlab
  matlab: "math",
  // hardware + mcu
  mcu: "hardware",
  // data + diagram + mindmap
  data: "figure",
  diagram: "figure",
  mindmap: "figure",
  // write + acad + convert
  write: "doc",
  acad: "doc",
  convert: "doc",
  slide: "doc",
  // se + debug + plan
  se: "dev",
  debug: "dev",
  plan: "dev",
  // companion + cognitive (+ the long-gone delivery)
  cognitive: "life",
  companion: "life",
  delivery: "life",
};

/**
 * Resolve one set id through the alias table (one hop, idempotent). Unknown ids and
 * still-live ids come back unchanged, so callers can keep their existing `SKILL_SETS[id]`
 * guard as the single validity check.
 */
export function resolveSetId(id) {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  if (SKILL_SETS[raw]) return raw;
  const target = SET_ALIASES[raw.toLowerCase()] || SET_ALIASES[raw];
  return target && SKILL_SETS[target] ? target : raw;
}

export const SKILL_SETS = {
  base: {
    label: "基础底座",
    hint: "脚本·软件手册·技能·排查",
    keywords: [
      "powershell", "shell", "script", "handbook", "manual", "skill", "context",
      "bootstrap", "troubleshoot", "dataset", "datasheet", "kaggle", "zenodo",
      "脚本", "手册", "技能", "上下文", "排查", "底座", "数据集", "找数据",
      "查参数", "参考设计", "行业数据",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "基础=首轮判断任务域后立刻开对应档（仅首轮可自主开档，此后只建议不代切）；命令静默执行、只给真实结果",
    brief: [
      "当前技能档：基础底座（默认档，只保通用能力）。",
      "- 本档只放跨任务通用的技能：Windows 脚本守则、软件官方手册、技能增改、上下文配置、系统化排查、技能路由元技能。",
      "- **首轮必做**：读完用户第一句需求后，立刻用 skill_set 打开对应档（一次到位，不要逐步试探），并一句话说明开了哪档；跨域任务最多同时开 2 档。换任务时先关旧档再开新档。",
      "- **仅首轮可自主开档**：从第 2 轮起 skill_set 的 set/add/remove 会被工具拒绝，只返回建议——这是用户定的硬规矩（中途切档会作废整段 prompt 缓存前缀，实测 ¥0.2-0.4/次）。此时正确做法是把「建议开 X 档」写在回复里让用户确认，不要反复重试工具。",
      "- 档位菜单：base 基础底座｜sim 仿真与计算｜math MATLAB与Simulink｜hardware 硬件与嵌入式｜figure 科研出图与制图｜doc 论文与文档｜dev 写代码与工程｜design 设计视觉｜ops 改 DSH 运维｜life 陪伴与生活",
    ].join("\n"),
    skills: [
      "windows-powershell-scripting", "software-handbook", "skill-creator",
      "context-engineering", "debugging-process", "data-retrieval",
      // 元技能：路由「该用哪个技能/该走哪条流程」不产出交付物，是技能面本身的活，
      // 归底座（与 skill-creator / context-engineering 同类），不跟某个工程会话走。
      "ask-matt", "using-agent-skills",
    ],
    /** 本档主力技能：briefFor 在档位激活时把这行注入系统提示，强制先加载。 */
    mustLead: ["windows-powershell-scripting", "software-handbook", "debugging-process"],
  },

  sim: {
    label: "仿真与计算",
    hint: "PLECS 批跑与波形·符号·统计·优化",
    keywords: [
      "plecs", "simulation", "simulate", "job.json", "sweep", "thd", "harmonics",
      "converter", "buck", "boost", "inverter", "power electronics", "npz",
      "octave", "sympy", "symbolic", "uncertainty", "pint", "units",
      "statistics", "anova", "pymoo", "nsga", "pareto", "optimization",
      "仿真", "批跑", "参数扫描", "谐波", "交调", "开关管", "功率", "归档",
      "数值", "符号计算", "不确定度", "单位", "统计", "优化", "实验设计",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "仿真=跑满全窗口取全部求解点、禁截段/抽稀/只报局部，入库前过 verify_npz.py",
    brief: [
      "当前技能档：仿真与数值计算。",
      "- 覆盖：PLECS 建模/批跑与波形判读、仿真数据归档校验（npz/channels）；Octave 数值流程、SymPy 符号推导、单位与测量不确定度传播、统计检验、多目标优化。",
      "- 铁律：跑满完整窗口并取全部求解点，禁截段/抽稀/只报局部；入库前过 `verify_npz.py` 闸门；点数只取自 run.log / summary.csv 实测。",
      "- 物理量单位与不确定度必须带全；符号推导结果必须可核验；统计先查假设再选检验。依赖外部库先确认本机可用，不可用就明说，不臆造结果。",
    ].join("\n"),
    skills: [
      "plecs-simulation", "plecs-automation", "plecs-expert",
      "matlab-power-electronics-sim", "sympy", "uncertainty-and-units",
      "statistical-analysis", "experimental-design", "pymoo",
    ],
    mustLead: ["plecs-expert", "plecs-simulation", "uncertainty-and-units"],
  },

  math: {
    label: "MATLAB 与 Simulink",
    hint: "MATLAB·Simulink·Simscape 工具箱流程",
    keywords: [
      "matlab", "simulink", "simscape", "stateflow", "toolbox", "octave",
      "live script", "plant model", "solver", "embedded coder",
      "科学计算", "工具箱", "模型线性化", "生成代码",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "MATLAB/Simulink=函数与参数先查本机文档再写代码、模型参数与单位写全、生成代码前先确认模型能跑通",
    brief: [
      "当前技能档：MATLAB 与 Simulink。",
      "- 覆盖：MATLAB 数值/信号/统计/图窗流程、Live Script、按官方文档查函数用法、Simulink 建模与仿真、Simscape 物理建模、模型线性化与频响、生成嵌入式代码。",
      "- 铁律：函数与参数用法先查本机文档（matlab-read-documentation）再写代码，不凭记忆；模型参数、求解器设置与物理量单位写全；生成代码或部署前先确认模型能跑通。",
    ].join("\n"),
    skills: [
      "matlab", "matlab-read-documentation", "matlab-analyze-data", "matlab-analyze-spectrum",
      "matlab-analyze-time-frequency-content", "matlab-build-chart", "matlab-call-python",
      "matlab-create-live-script", "matlab-debug-code", "matlab-deploy-embedded-code",
      "matlab-design-digital-filter", "matlab-extract-signal-features", "matlab-generate-code",
      "matlab-identify-linear-system", "matlab-import-export-data", "matlab-prepare-signal-data",
      "matlab-review-code", "matlab-solve-optimization", "matlab-use-symbolic-math",
      "building-simulink-models", "simulating-simulink-models", "testing-simulink-models",
      "authoring-simulink-inputs", "specifying-plant-models", "simulink-use-c-function-block",
      "simulink-linearize", "simulink-frequency-response", "simulink-control-motors",
      "simulink-generate-embedded-code", "simscape-write-ssc", "finding-simulink-examples",
    ],
    mustLead: ["matlab", "matlab-read-documentation"],
  },

  hardware: {
    label: "硬件与嵌入式",
    hint: "原理图/PCB·MCU 固件·审查",
    keywords: [
      "easyeda", "eda", "altium", "pcb", "schematic", "footprint", "gerber", "drc",
      "stm32", "c2000", "mcu", "keil", "ccs", "firmware", "register", "interrupt",
      "embedded", "hal", "adc", "pwm",
      "原理图", "封装", "画板", "嘉立创", "立创", "布线", "硬件", "单片机",
      "固件", "寄存器", "中断", "嵌入式",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "硬件=封装名与引脚号写全、缺参数先问不编造；单片机寄存器名与位域写全（型号+手册章节）",
    brief: [
      "当前技能档：硬件与嵌入式。",
      "- 覆盖：嘉立创EDA / Altium 原理图与 PCB、封装、布局布线、DFM 与网表审查；STM32(Keil) / TI C2000(CCS) 固件、寄存器与外设、工程烧录。",
      "- 铁律：封装名与引脚号写全，缺参数先问不编造；电源/去耦/地回流一次到位。寄存器名与位域写全（型号 + 手册章节），中断/时序先看时钟树与优先级。",
      "- 审查输出「位置 + 严重度」清单，只报实质问题，不改写、不空谈风格。",
    ].join("\n"),
    skills: [
      "easyeda-api", "schematic-pcb-drawing", "pcb-hardware-review",
      "precision-afe-review", "embedded-mcu", "stm32-embedded-dev",
      "code-review-checklist",
    ],
    mustLead: ["stm32-embedded-dev", "easyeda-api", "precision-afe-review"],
  },

  figure: {
    label: "科研出图与制图",
    hint: "数据图·框图·复习导图",
    keywords: [
      "plot", "plotting", "chart", "matplotlib", "origin", "echarts", "tikz",
      "spectrum", "waveform", "fft", "data visualization", "mermaid", "drawio",
      "flowchart", "sequence", "state machine", "erd", "gantt", "swimlane",
      "mindmap", "review outline", "flashcard", "quiz",
      "绘图", "波形", "频谱", "图表", "曲线", "数据可视化", "架构图", "流程图",
      "时序图", "状态机", "泳道", "框图", "思维导图", "复习", "大纲", "知识点",
      "动画", "动图", "gif", "manim", "animation", "animated",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "出图=分析基于全量数据、禁截段抽稀；先定图型与用途再动手，坐标轴单位/图题/真实命名一次到位；版式三禁：文字禁压曲线与互遮、禁长引线长箭头（只准朝轴作水平或垂直短线、贴近轴标注、线在文字处断开留空缺）、任何元素禁越出框线",
    brief: [
      "当前技能档：科研出图与制图。",
      "- 覆盖：matplotlib / Origin 科研图与波形频谱、LaTeX/TikZ 论文插图；架构/流程/时序/状态机/ER/泳道等结构图（mermaid / drawio / SVG）；课件→复习导图。",
      "- 铁律：分析一律基于全量数据，禁截段、禁抽稀、禁只报局部；先确认图的用途（论文/汇报/演示）与图型再动手；坐标轴单位、图题编号、字号配色一次到位。",
      "- 版式三条禁则（2026-09-21 整定，违反即返工）：① **禁文字遮挡曲线或文字互相遮挡**——标注先落在数据空隙，遮挡只准用于引线在文字处的断口，绝不准盖住曲线数据；② **禁长引线/长斜箭头**——引线只能朝横轴或纵轴作水平或垂直的短线，标注贴近它引的那条轴，线穿过文字中心时必须在文字处断开、给文字留出空缺；③ **禁任何元素越出框线（文字尤甚）**——标题、图例、刻度标签、注释文字与箭头都必须落在图框/画布内，导出后逐项核对。",
      "- 节点与连线标签用材料里的真实命名（信号名/模块名），禁自造术语；重绘既有 .drawio / .mmd 保留原拓扑，只改版式不删节点。",
      "- 复习导图以课件与电子书共同重点为准，保留原文细节，严禁概括过简与篡改；每页必须放得下。",
    ].join("\n"),
    skills: [
      // scientific-visualization 原误挂 sim：它的正文是「matplotlib/seaborn/plotly
      // 出可发表图 + 多面板/不确定度/配色对比/导出规划」，纯出图活；figure 的
      // mustLead 早已点它的名（此前口径与实际归档自相矛盾）。
      "scientific-visualization",
      "scientific-plotting", "multi-chart-draw", "scipilot-figure-skill",
      // Origin 自动化出图：originpro 驱动本机 Origin，交可编辑 .opju（本机 Origin 2024 实测）
      "origin-plotting",
      "diagram-design", "archify", "thesis-figure-skill", "tikz-figure-code",
      "tikz-scientific-figures", "inline-svg-selfcheck",
      "mindmap-builder", "examprep-ai",
      // 动画：数据动画（真实波形）+ Manim 原理动画（走独立 venv）
      "animated-figures", "manim-animation",
    ],
    mustLead: ["scientific-visualization", "tikz-figure-code", "mindmap-builder"],
  },

  doc: {
    label: "论文与文档",
    hint: "写作·文献·投稿返修·格式互转",
    keywords: [
      "academic", "paper", "thesis", "literature", "citation", "reference",
      "imrad", "abstract", "latex", "survey", "deep research", "manuscript",
      "journal", "submission", "peer review", "reviewer", "revise", "dissertation",
      "convert", "docx", "pdf", "pptx", "xlsx", "epub", "transcribe", "markdown",
      "import", "ocr", "presentation", "slide", "deck",
      "论文", "学术", "文献", "综述", "参考文献", "摘要", "写作", "投稿", "审稿",
      "返修", "学位论文", "转换", "文档", "格式", "排版", "提取", "转录", "演示",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "论文=正文只写可追溯事实、禁编造，缺数据缺图用占位符并维护 supplement-list.md；审稿只报实质问题",
    brief: [
      "当前技能档：论文与文档。",
      "- 覆盖：期刊/学位论文结构与摘要引言、文献检索与综述、深度调研、中文改稿；投稿流水线与同行评审、返修逐条回应；Word/PDF/PPT/Excel/EPUB/Markdown 互转、文本提取与转录；汇报型 PPT 与讲稿。",
      "- 铁律：正文只写能追溯到材料的事实，禁编造数据/现象/结论/文献；缺数据缺图一律占位符并维护 supplement-list.md；公式推导严格核验。",
      "- 审查≠改写，等价表达不算错；审稿只报实质问题（事实/数据/逻辑/缺内容），给位置 + 简洁修法。",
      "- 格式转换只做无损搬运，不顺手动原文内容；转换后逐项核对页码/公式/图注/表格是否走形，有损项逐条说明。",
    ].join("\n"),
    skills: [
      "academic-writing", "scientific-writing", "human-writing",
      "literature-search", "deep-research", "mathematical-enhancer",
      "scientific-simplifier", "writing-commenter",
      "academic-paper", "academic-paper-reviewer", "academic-pipeline",
      "doc-coauthoring", "inline-paper-critic", "manuscript-review",
      "doc-convert-tools", "document-conventions", "docx", "pdf", "pptx", "xlsx",
      "convert-docx", "convert-pdf", "convert-md-to-pdf", "convert-pptx",
      "convert-epub", "import-gdoc", "transcribe", "math-ocr",
      "ppt-master", "slides", "scientific-presenter",
    ],
    mustLead: ["academic-paper", "scientific-writing", "convert-docx"],
  },

  dev: {
    label: "写代码与工程",
    hint: "代码·测试·CI·排查·计划规格",
    keywords: [
      "refactor", "code review", "api design", "tdd", "ci", "git", "test",
      "debug", "diagnose", "root cause", "regression", "repro", "triage",
      "postmortem", "plan", "spec", "workflow", "gtd", "todo", "openspec",
      "roadmap",
      "重构", "接口设计", "测试", "版本控制", "报错", "异常", "根因", "回归",
      "编码", "计划", "规格", "流程", "任务拆解", "实施", "里程碑",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "工程=先规格后实现、小步可回退；排查先复现再动手、根因未定位前不改代码；审查只报实质问题不改写",
    brief: [
      "当前技能档：写代码与工程。",
      "- 覆盖：自研代码/脚本的接口与重构、测试与持续集成、Git 工作流；排查（复现→隔离→根因→修复→回归）；计划与规格（含 openSpec 流水线、任务拆解、交接文档）。",
      "- 铁律：先规格后实现，一次只推进一小步且可回退；排查先复现再动手、不猜，根因未定位前不改代码；每步给命令 + 真实结果。",
      "- 审查只报实质问题（内存/中断/错误处理/逻辑），不改写、不做风格建议；结论落到可执行的下一步。",
    ].join("\n"),
    skills: [
      "api-and-interface-design", "browser-testing-with-devtools", "ci-cd-and-automation",
      "code-review", "code-review-and-quality", "code-simplification", "codebase-design",
      "constraint-driven-development", "deprecation-and-migration",
      "documentation-and-adrs", "domain-modeling", "doubt-driven-development",
      "git-guardrails-claude-code", "git-workflow-and-versioning",
      "improve-codebase-architecture", "incremental-implementation",
      "migrate-to-shoehorn", "observability-and-instrumentation",
      "performance-optimization", "prototype", "resolving-merge-conflicts",
      "scaffold-exercises", "security-and-hardening", "setup-pre-commit",
      "shipping-and-launch", "source-driven-development", "test-driven-development",
      "tdd", "webapp-testing", "web-artifacts-builder",
      "troubleshoot", "diagnosing-bugs", "debugging-and-error-recovery", "triage",
      "openspec-design", "openspec-plan", "openspec-init",
      "openspec-develop", "openspec-test", "openspec-review", "openspec-reflect",
      "openspec-replan", "openspec-sync", "to-spec", "to-tickets",
      "planning-and-task-breakdown", "spec-driven-development", "writing-for-agents",
      "handoff",
      // 通用对话类小工具（提问/澄清/评审/教学），跟着工程会话走
      "grill-me", "grill-with-docs", "grilling", "idea-refine", "implement",
      "interview-me", "research", "teach", "to-questionnaire",
      "wait-what", "wayfinder", "wizard",
    ],
    mustLead: ["spec-driven-development", "code-review", "test-driven-development"],
  },

  design: {
    label: "设计视觉",
    hint: "网页 UI·组件·图标·品牌·配图",
    keywords: [
      "ui", "frontend", "design", "taste", "css", "layout", "icon", "svg",
      "visual", "palette", "typography", "brand", "banner", "imagegen",
      "redesign", "theme", "shadcn", "artifact",
      "前端", "设计", "视觉", "配色", "排版", "图标", "美化", "插画", "品牌",
      "落地页", "组件",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "设计=深浅色都适配、图标禁 emoji 用内联 SVG、图形化优先；先定视觉方向再动手，反模板化",
    brief: [
      "当前技能档：设计视觉。",
      "- 覆盖：Web/移动端 UI 与落地页、设计系统与主题、图标与插画、品牌与视觉规范、banner、既有界面重设计、图片方向与 image-to-code。",
      "- 铁律：深浅色都要适配；图标禁 emoji 与豆腐块，用内联 SVG（stroke=currentColor）；图形化优先于文字标签。",
      "- 先定视觉方向再动手，反模板化；交付前自检对比度、溢出、空状态。",
    ].join("\n"),
    skills: [
      "design-taste-frontend", "design-taste-frontend-v1", "frontend-design",
      "frontend-ui-engineering", "ui-design", "ui-styling", "ui-ux-pro-max",
      "design-system", "design", "high-end-visual-design", "minimalist-ui",
      "industrial-brutalist-ui", "gpt-taste", "stitch-design-taste",
      "drawing-icons-svg", "brand", "brandkit", "banner-design",
      "imagegen-frontend-web", "imagegen-frontend-mobile", "image-to-code",
      "redesign-existing-projects", "full-output-enforcement", "algorithmic-art",
      "canvas-design", "theme-factory",
      // 界面/产品文案的人味（去 AI 腔）：与 human-writing（长帖创作）分工
      "human-copy",
      // 自由造型 SVG 绘图（几何构造 + 美观 + 质感）：与 drawing-icons-svg（图标级）分工
      "svg-illustration",
    ],
    mustLead: ["design-taste-frontend", "human-copy", "theme-factory"],
  },

  ops: {
    label: "改 DSH 运维",
    hint: "插件·配置·token·升级",
    keywords: [
      "dsh", "plugin", "cordis", "install", "deploy", "config", "token", "mcp",
      "upgrade", "profile",
      "插件", "技能档", "运维", "配置", "部署", "升级", "成本",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "运维=绝不整删 node_modules、安装走 dsh plugin add file:...、改官方包先备份；命令静默并给真实结果",
    brief: [
      "当前技能档：DSH 运维。",
      "- 覆盖：DSH 插件/技能/配置、token 成本、MCP 接入、DSH 升级。",      "- 铁律：绝不整删 `~/.dsh\\profiles\\node_modules`（报错只删点名包）；插件源码唯一真源 `<DSH 安装根>\\plugins\\`，安装一律 `dsh plugin add file:...`（CLI 在 `<DSH 安装根>\\node_modules\\.bin\\dsh.cmd`）；改官方 `@deepseek-ai` 包先备份；DSH 重启只能由用户点「重启 DSH」。",
      "- 命令行静默、不弹黑窗；每条改动给命令 + 真实结果。",
    ].join("\n"),
    skills: [
      "dsh-plugin-development", "dsh-token-budget", "dsh-upgrade", "mcp-builder",
      // computer use 是 DSH 自身能力的实操手册。必须显式列出：planVisibility 只按
      // skills 数组构造可见集，关键词 fallback 不参与可见性判定——漏列即永久隐藏
      // （2026-09-21 整定：该技能原缺 frontmatter，从未注册，补上后才发现此坑）。
      "dsh-computer-use",
    ],
    mustLead: ["dsh-plugin-development", "dsh-token-budget", "dsh-upgrade"],
  },

  life: {
    label: "陪伴与生活",
    hint: "情绪·哲学对话·追问复盘·跑腿",
    keywords: [
      "counsel", "coach", "dialogue", "philosophy", "stoic", "emotion",
      "brainstorm", "investigate", "challenge", "retrospect", "decision",
      "premortem", "benchmark", "paotui", "delivery", "takeout",
      "陪伴", "心理", "哲学", "情绪", "焦虑", "头脑风暴", "决策", "复盘",
      "调研", "质疑", "跑腿", "外卖", "代买", "取号",
    ],
    /** One-line rule used by the compact brief. */
    briefOne: "陪伴=先说人话再给方法，不说教、不贴标签；决策/复盘先框定问题再发散，结论给可执行下一步；代办=两步确认再下单",
    brief: [
      "当前技能档：陪伴与生活。",
      "- 覆盖：情绪陪伴与心理疏导、哲学与思想家视角、对话与自我反思；问题框定与发散收敛、调研质疑、复盘回顾；生活代办（美团跑腿：帮取送/帮买/取号挂号/搬装）。",
      "- 铁律：先说人话再给方法；不说教、不贴标签、不急着总结成道理。决策/复盘先把问题框定清楚再发散，结论必须落到可执行的下一步。",
      "- **代办类必须先复述需求与金额、用户点头才下单。**",
    ].join("\n"),
    skills: [
      "counseling-companion", "cognitive-toolkit", "satori", "coach", "council",
      "dialogue", "encounter", "create", "marcus-aurelius", "epictetus",
      "diogenes", "spinoza", "nietzsche", "sartre", "montaigne", "weil",
      "hadot", "buber", "arendt", "fukuyama", "herbert", "kusanagi", "leto-ii",
      "meadows", "morin", "musashi", "sunzi", "taleb",
      "mt-paotui-for-client",
      "frame-problem", "brainstorm", "investigate", "challenge", "probe",
      "experiment", "benchmark-praxis", "retrospect-collab", "retrospect-domain",
      "retrospect-report",
    ],
    mustLead: ["counseling-companion", "cognitive-toolkit", "frame-problem"],
  },
};

/** skill name -> set id, built from the curated lists. Throws on any overlap. */
export function skillIndex() {
  const idx = new Map();
  for (const id of SET_ORDER) {
    for (const s of SKILL_SETS[id].skills) {
      if (idx.has(s)) throw new Error(`skill "${s}" is declared in two skill sets`);
      idx.set(s, id);
    }
  }
  for (const s of ALWAYS_ON_SKILLS) {
    if (idx.has(s)) throw new Error(`always-on skill "${s}" is also declared in a set`);
    idx.set(s, "always");
  }
  return idx;
}

/** Keyword fallback for a skill that no curated list mentions. Returns set id or null. */
export function classifyByKeywords(name, description) {
  const hay = `${name || ""} ${description || ""}`.toLowerCase();
  if (!hay.trim()) return null;
  let best = null;
  let bestScore = 0;
  for (const id of SET_ORDER) {
    let score = 0;
    for (const kw of SKILL_SETS[id].keywords) {
      if (hay.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Diagnostic classifier: where WOULD one skill land if it had to be filed.
 * Explicit frontmatter `skill-set:` wins (may also be "always"); otherwise the curated
 * index; otherwise the keyword fallback; otherwise null.
 * 注意：这只是给维护报告用的建议值，**不参与可见性判定**（见 `planVisibility`）。
 */
export function resolveSkill(name, description, declaredSet) {
  if (declaredSet) {
    const d = String(declaredSet).trim().toLowerCase();
    if (d === "always" || d === "core") return "always";
    const aliased = resolveSetId(d);
    if (SKILL_SETS[aliased]) return aliased;
    return "unknown-set:" + d; // an explicit but unknown id must not file it elsewhere
  }
  const idx = skillIndex();
  if (idx.has(name)) return idx.get(name);
  return classifyByKeywords(name, description);
}

export function validSetIds() {
  return [...SET_ORDER];
}

export function setLabel(id) {
  if (id === "always") return "常驻";
  return SKILL_SETS[id] ? SKILL_SETS[id].label : id;
}

/**
 * The per-set off-switches as a Set. `disabledBySet` may be a Map (host runtime) or a
 * plain object (tests / serialized config); anything else means "nothing off".
 */
function offSetFor(disabledBySet, id) {
  if (!disabledBySet) return EMPTY_SET;
  const raw = typeof disabledBySet.get === "function" ? disabledBySet.get(id) : disabledBySet[id];
  if (!raw) return EMPTY_SET;
  if (raw instanceof Set) return raw;
  const list = Array.isArray(raw) ? raw : raw.disabled;
  return new Set(Array.isArray(list) ? list : []);
}

const EMPTY_SET = new Set();

/**
 * Decision core (pure): given every known skill and the active sets, decide what
 * to hide. `active = []` hides everything except the always-on skills (empty default).
 * A third argument switches individual skills off INSIDE their own set only
 * (`{ data: { disabled: ["x"] } }` or a `Map<setId, Set<name>>`), so the same skill
 * stays visible whenever another active set still contributes it.
 * Unknown skills are ALWAYS kept visible so a brand-new skill can never vanish.
 * Retired set ids are resolved through `SET_ALIASES` first, so an old session's stored
 * list keeps its full skill surface after a re-org.
 */
export function planVisibility(allSkills, activeIds, disabledBySet) {
  const act = [...new Set((activeIds || []).map(resolveSetId).filter((id) => SKILL_SETS[id]))];
  const idx = skillIndex();
  const visible = new Set(ALWAYS_ON_SKILLS);
  for (const id of act) {
    const off = offSetFor(disabledBySet, id);
    for (const s of SKILL_SETS[id].skills) if (!off.has(s)) visible.add(s);
  }
  const hidden = [];
  const kept = [];
  const unclassified = [];
  for (const s of allSkills) {
    const name = typeof s === "string" ? s : s.name;
    /* 可见性判据只有两条：常驻名单、或「正在生效的档」的策展名单。
       frontmatter 与关键词兜底一律不参与——命中与否都不该改变谁能被看见。 */
    const filed = idx.has(name) || ALWAYS_ON_SKILLS.includes(name);
    if (!filed) unclassified.push(name);
    if (ALWAYS_ON_SKILLS.includes(name) || visible.has(name)) kept.push(name);
    else hidden.push(name);
  }
  return { active: act, hidden, kept, unclassified, visible: [...visible] };
}

/** The brief text injected for the active sets (identity is NOT restated here). */
export function briefFor(activeIds) {
  const act = (activeIds || []).map(resolveSetId).filter((id) => SKILL_SETS[id]);
  if (!act.length) return emptySetsBrief();
  const labels = act.map((id) => SKILL_SETS[id].label).join("、");
  const rules = act.map((id) => SKILL_SETS[id].briefOne).filter(Boolean).join("；");
  // 主力技能硬映射：目录只给 name+description，模型要在几十行里自己判断；
  // 这行把它变成明确的"点名先加载"，是解决「切了档但技能不触发」的关键杠杆。
  const lead = act
    .map((id) => {
      const names = (SKILL_SETS[id].mustLead || []).filter(Boolean);
      return names.length ? SKILL_SETS[id].label + "→" + names.join("/") : "";
    })
    .filter(Boolean);
  const leadLine = lead.length
    ? "\n本档主力（任务命中即先 skill 加载再动手，禁止凭记忆替代）：" + lead.join("；") + "。"
    : "";
  return "当前技能档（" + act.length + "）：" + labels + "。\n铁律：" + rules + "。" + leadLine;
}

