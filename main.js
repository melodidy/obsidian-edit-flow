/*
 * Edit Flow - 一体化媒体作品发布工作流插件 v4
 * 重构: 3大类(视频/图片/文字)+子类 / 便签非Modal浮窗 / 路径自动搜索
 */

const {
  Plugin, WorkspaceLeaf, ItemView, Modal, Setting, PluginSettingTab,
  Notice, TFile, TFolder, MarkdownView, debounce, AbstractInputSuggest,
} = require("obsidian");

/* =========================================================================
 *  常量
 * ========================================================================= */

const VIEW_DASHBOARD = "edit-flow-dashboard";
const VIEW_TOOLS = "edit-flow-tools";
const VIEW_NAVIGATION = "edit-flow-navigation";

const STAGES = [
  { id: "inspiration", name: "灵感", icon: "sparkles", folder: "01-灵感" },
  { id: "topic", name: "选题", icon: "lightbulb", folder: "02-选题" },
  { id: "script", name: "脚本", icon: "file-text", folder: "03-脚本" },
  { id: "copy", name: "文案", icon: "align-left", folder: "04-文案" },
  { id: "cover", name: "封面", icon: "image", folder: "05-封面" },
  { id: "work", name: "作品", icon: "film", folder: "06-作品" },
  { id: "publish", name: "发布", icon: "send", folder: "07-发布" },
];

// 莫兰迪色系 (统一用于所有颜色)
const MORANDI = {
  green:   "#C9DBD2", // 雾霾绿
  oat:     "#D4C5B9", // 燕麦
  purple:  "#C9C4D4", // 雾霾紫
  pink:    "#DBC9C9", // 藕粉
  blue:    "#C9D4DB", // 雾霾蓝
  beige:   "#DBD4C9", // 米杏
  sage:    "#D2D4C9", // 灰绿
  mauve:   "#D4C9D2", // 浅藕
};
const MORANDI_LIST = Object.values(MORANDI);

// 作品进度状态 (与工作流阶段 stage 分开的独立维度)
const WORK_STATUS = [
  { id: "not-started", name: "未开始", icon: "circle",       color: MORANDI.sage },
  { id: "planning",    name: "策划中", icon: "clipboard",     color: MORANDI.blue },
  { id: "in-progress", name: "制作中", icon: "hammer",        color: MORANDI.oat },
  { id: "completed",   name: "已完成", icon: "circle-check",  color: MORANDI.green },
  { id: "published",   name: "已发布", icon: "send",          color: MORANDI.purple },
];
function getWorkStatus(id) { return WORK_STATUS.find((s) => s.id === id) || WORK_STATUS[0]; }

// 图标库 (53 个, 供主分类/子类选择)
const ICON_LIBRARY = ["file","file-text","film","video","music","image","palette","camera","mic","headphones","scroll","book","pen-tool","edit","hash","tag","star","heart","zap","flame","sparkles","lightbulb","compass","map-pin","clock","calendar","eye","thumbs-up","message-circle","send","bookmark","award","feather","brush","layers","grid","layout","monitor","play","pause","stop","fast-forward","skip-forward","volume-2","captions","repeat","shuffle","cloud","download","upload","folder","archive","box","package"];

// 3 大类 (主分类) - 莫兰迪色
const MAIN_CATEGORIES = [
  { id: "video", name: "视频作品", icon: "film",        color: MORANDI.purple, description: "短视频/混剪/歌词排版等视频类" },
  { id: "image", name: "图片作品", icon: "image",       color: MORANDI.blue,   description: "海报/插画/设计图等图片类" },
  { id: "text",  name: "文字作品", icon: "file-text",   color: MORANDI.pink,    description: "文章/图文/脚本等文字类" },
];

// 默认子类 (按主分类)
const DEFAULT_SUBTYPES = {
  video: [
    { id: "short-video",   name: "短视频",   icon: "video",    color: MORANDI.purple, needsScript: true,  needsCover: true,  needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: video\nsub-type: short-video\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n> 灵感来源\n\n## 选题\n\n## 文案\n\n## 音乐/BGM\n\n## 封面\n\n## 作品内容\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
    { id: "mix-cut-video",  name: "混剪视频", icon: "film",     color: MORANDI.oat,    needsScript: true,  needsCover: true,  needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: video\nsub-type: mix-cut-video\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n> 混剪主题、节奏\n\n## 选题\n- 主题:\n- 素材来源:\n\n## 文案\n\n## 音乐/BGM\n\n## 封面\n\n## 作品内容\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
    { id: "lyrics-layout",  name: "歌词排版", icon: "music",    color: MORANDI.green,  needsScript: false, needsCover: true,  needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: video\nsub-type: lyrics-layout\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n> 选曲原因、视觉风格\n\n## 选题\n- 歌曲:\n- 歌手:\n\n## 歌词排版\n\n## 文案\n\n## 音乐/BGM\n\n## 封面\n\n## 作品内容\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
  ],
  image: [
    { id: "poster",         name: "海报",     icon: "image",    color: MORANDI.blue,   needsScript: false, needsCover: false, needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: image\nsub-type: poster\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n> 设计灵感、参考图\n\n## 选题\n- 主题:\n- 尺寸:\n\n## 设计稿\n\n## 作品内容\n\n## 文案\n\n## 音乐/BGM\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
    { id: "illustration",   name: "插画",     icon: "palette",  color: MORANDI.mauve,  needsScript: false, needsCover: false, needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: image\nsub-type: illustration\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n\n## 选题\n\n## 设计稿\n\n## 作品内容\n\n## 文案\n\n## 音乐/BGM\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
  ],
  text: [
    { id: "article",        name: "文章",     icon: "file-text",color: MORANDI.pink,   needsScript: false, needsCover: false, needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: text\nsub-type: article\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n\n## 选题\n- 主题:\n- 受众:\n\n## 大纲\n\n## 正文\n\n## 文案\n\n## 音乐/BGM\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
    { id: "script-text",    name: "脚本",     icon: "scroll",  color: MORANDI.beige,  needsScript: true,  needsCover: false, needsCopy: true,
      template: `---\ntype: edit-flow-work\nmain-category: text\nsub-type: script-text\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n\n## 选题\n\n## 文案\n\n## 音乐/BGM\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n` },
  ],
};

const DEFAULT_SETTINGS = {
  rootFolder: "Edit Flow",
  // 只保留作品/脚本两个文件夹 (根目录下只有 作品/脚本/素材库 三个)
  stageFolders: {
    work: "作品", script: "脚本",
  },
  materialFolder: "素材库",
  stickyFolder: "便签",
  templateFolder: "模板",
  inspirationFolder: "灵感",
  mainCategories: [],
  subTypes: {},
  accounts: [],
  // 作品对象 (目标受众/创作对象, 支持自定义)
  audiences: [],
  enableHandwriting: true,
  stickyNotes: [],
  enableAutoOpenTimeline: true,
  workIndex: [],
  // 表格行颜色: { 文件路径: [颜色1, 颜色2, ...] }
  gridRowColors: {},
  // 每周排期表 (全局模板: 周几做什么类型 + 发什么类型, 与单作品 publishDate 分开)
  // makeTypes / publishTypes 存子类 id 数组
  weeklySchedule: [
    { day: 1, name: "周一", makeTypes: [], publishTypes: [] },
    { day: 2, name: "周二", makeTypes: [], publishTypes: [] },
    { day: 3, name: "周三", makeTypes: [], publishTypes: [] },
    { day: 4, name: "周四", makeTypes: [], publishTypes: [] },
    { day: 5, name: "周五", makeTypes: [], publishTypes: [] },
    { day: 6, name: "周六", makeTypes: [], publishTypes: [] },
    { day: 7, name: "周日", makeTypes: [], publishTypes: [] },
  ],
};

/* =========================================================================
 *  工具函数
 * ========================================================================= */

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function todayStr() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function nowTimeStr() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}`; }
function setLucideIcon(el, name) {
  if (!el || !name) return;
  el.empty();
  try { const { setIcon } = require("obsidian"); if (typeof setIcon === "function") { setIcon(el, name); } } catch (e) {}
  // 确保 SVG 有尺寸 (移动端兜底, 防止 0×0 不显示)
  const svg = el.querySelector("svg");
  if (svg) {
    if (!svg.getAttribute("width")) svg.setAttribute("width", "16");
    if (!svg.getAttribute("height")) svg.setAttribute("height", "16");
    svg.style.width = svg.style.width || "1em";
    svg.style.height = svg.style.height || "1em";
    svg.style.display = "inline-block";
    return;
  }
  try { if (el.setIcon) el.setIcon(name); else el.textContent = name.slice(0,2); } catch (e) { el.textContent = name; }
}
function parseFrontmatter(content) {
  const fm = {}; const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm, body: content };
  const lines = m[1].split(/\r?\n/); let curKey = null;
  for (const line of lines) {
    if (/^\s*-\s+/.test(line) && curKey) {
      const v = line.replace(/^\s*-\s*/, "").trim().replace(/^"(.*)"$/, "$1");
      if (!Array.isArray(fm[curKey])) fm[curKey] = []; fm[curKey].push(v);
    } else { const kv = line.match(/^([\w\-]+):\s*(.*)$/); if (kv) { let v = kv[2].trim(); if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1,-1); fm[kv[1]] = v; curKey = kv[1]; } }
  }
  return { fm, body: m[2] };
}
function sortNodes(nodes) {
  return nodes.slice().sort((a, b) => {
    const ta = a.time.split(":").map(Number); const tb = b.time.split(":").map(Number);
    for (let i = 0; i < Math.max(ta.length, tb.length); i++) { const va = ta[i]||0; const vb = tb[i]||0; if (va !== vb) return va - vb; }
    return 0;
  });
}

/* =========================================================================
 *  FolderSuggest - 路径自动搜索
 * ========================================================================= */

class FolderSuggest extends AbstractInputSuggest {
  constructor(app, inputEl) { super(app, inputEl); this.inputEl = inputEl; }
  getSuggestions(query) {
    const q = (query || "").toLowerCase();
    const all = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder);
    return all.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 12);
  }
  renderSuggestion(folder, el) { el.createDiv({ text: folder.name }); el.createDiv({ cls: "ef-suggest-path", text: folder.path }); }
  selectSuggestion(folder) { this.inputEl.value = folder.path; this.inputEl.trigger("change"); this.close(); }
}

/* =========================================================================
 *  工作流管理器
 * ========================================================================= */

class WorkflowManager {
  constructor(plugin) { this.plugin = plugin; }
  async ensureFolder(relPath) {
    const { vault } = this.plugin.app; const parts = relPath.split("/").filter(Boolean); let cur = "";
    for (const p of parts) {
      cur = cur ? cur + "/" + p : p;
      if (!vault.getAbstractFileByPath(cur)) { try { await vault.createFolder(cur); } catch (e) {} }
    }
  }
  getStageFolder(stageId) { return this.plugin.settings.stageFolders?.[stageId] || STAGES.find((s) => s.id === stageId)?.folder || stageId; }
  // 作品统一放作品文件夹, 脚本统一放脚本文件夹
  getWorkFolder() { return `${this.plugin.settings.rootFolder}/${this.getStageFolder("work")}`; }
  getScriptFolder() { return `${this.plugin.settings.rootFolder}/${this.getStageFolder("script")}`; }
  getInspirationFolder() { return `${this.plugin.settings.rootFolder}/${this.plugin.settings.inspirationFolder || "灵感"}`; }
  getMainCategory(id) { return this.plugin.settings.mainCategories.find((c) => c.id === id); }
  getSubType(mainId, subId) { return (this.plugin.settings.subTypes[mainId] || []).find((s) => s.id === subId); }
  getAllSubTypes() { return Object.values(this.plugin.settings.subTypes || {}).flat(); }
  getSubTypeById(subId) { return this.getAllSubTypes().find((s) => s.id === subId); }
  renderTemplate(tpl, vars) { return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] || ""); }

  // 各阶段对应的字段配置 (弹窗输入 → 注入笔记对应章节)
  static STAGE_FIELDS = {
    inspiration: { label: "灵感", placeholder: "灵感来源、想法、参考...", section: "灵感" },
    topic:       { label: "选题", placeholder: "选题角度、主题、受众...", section: "选题" },
    copy:        { label: "文案", placeholder: "发布文案、标题、话题...", section: "文案" },
    cover:       { label: "封面", placeholder: "封面设计说明、风格、参考...", section: "封面" },
    work:        { label: "作品内容", placeholder: "作品成品说明、链接、备注...", section: "作品内容" },
  };

  async createWork({ mainCategory, subType, stage = "inspiration", title, stageContent = "", audience = "" }) {
    const cat = this.getMainCategory(mainCategory);
    const st = this.getSubType(mainCategory, subType);
    if (!cat || !st) throw new Error("未知分类");
    const finalTitle = (title || "").trim() || `${st.name}-${todayStr().slice(5)}-${uid().slice(0,4)}`;
    const root = this.plugin.settings.rootFolder;
    // 作品统一放作品文件夹
    const workFolder = this.getWorkFolder();
    await this.ensureFolder(workFolder);
    const vars = { title: finalTitle, date: todayStr() };
    // 优先从模板文件夹读取用户自定义模板, 读不到用内置模板
    let tpl = st.template;
    const tplPath = `${root}/${this.plugin.settings.templateFolder}/EF-${st.name}.md`;
    const tplFile = this.plugin.app.vault.getAbstractFileByPath(tplPath);
    if (tplFile && tplFile instanceof TFile) {
      try { const t = await this.plugin.app.vault.read(tplFile); if (t && t.trim()) tpl = t; } catch (e) {}
    }
    let content = this.renderTemplate(tpl, vars);
    content = content.replace(/status: \w+/, `status: ${stage}\nprogress: not-started`);
    // 写入作品对象到 frontmatter (字段名 character, 存主角名字方便人读)
    if (audience) {
      const aud = this.getAudience(audience);
      const audName = aud ? aud.name : "";
      if (audName) content = content.replace(/^(---\n)/, `$1character: ${audName}\n`);
    }
    // 如果该阶段有内容, 注入到对应章节
    if (stageContent) {
      const sf = WorkflowManager.STAGE_FIELDS[stage];
      if (sf) {
        // 宽容匹配章节标题: ## 文案 后紧跟换行 (兼容 \r\n)
        const sectionRe = new RegExp(`(##\\s+${sf.section}[^\\n\\r]*\\r?\\n)`, "");
        if (sectionRe.test(content)) {
          content = content.replace(sectionRe, `$1\n${stageContent}\n`);
        } else {
          // 章节标题匹配不到, 在文末追加该章节
          content = content.replace(/\s+$/, "") + `\n\n## ${sf.section}\n\n${stageContent}\n`;
        }
      }
    }
    const file = await this.plugin.app.vault.create(`${workFolder}/${finalTitle}.md`, content);
    await this.registerWork(file, mainCategory, subType, stage, audience);
    return { file, subType: st, mainCategory: cat };
  }
  async updateFrontmatter(file, updates) { await this.plugin.app.fileManager.processFrontMatter(file, (fm) => Object.assign(fm, updates)); }
  async registerWork(file, mainCategory, subType, stage, audience = "") {
    const idx = this.plugin.settings.workIndex || [];
    const entry = { id: uid(), path: file.path, name: file.basename, mainCategory, subType, stage, progress: "not-started", created: todayStr(), updated: todayStr(), audience };
    const ei = idx.findIndex((e) => e.path === file.path);
    if (ei >= 0) { entry.publishDate = idx[ei].publishDate; entry.publishPlatforms = idx[ei].publishPlatforms || []; entry.progress = idx[ei].progress || "not-started"; entry.audience = audience || idx[ei].audience || ""; idx[ei] = entry; } else idx.push(entry);
    this.plugin.settings.workIndex = idx; await this.plugin.saveSettings();
  }
  // 每周排期表 (全局模板: 周几制作/发布什么类型, 与单作品 publishDate 分开)
  getWeeklySchedule() {
    const ws = this.plugin.settings.weeklySchedule;
    if (!ws || ws.length !== 7) return DEFAULT_SETTINGS.weeklySchedule.map((d) => ({ ...d }));
    return ws;
  }
  // dayIdx: 1(周一) ~ 7(周日); makeTypes/publishTypes 为子类 id 数组
  async setWeeklyDay(dayIdx, makeTypes, publishTypes) {
    const ws = this.getWeeklySchedule();
    const entry = ws.find((d) => d.day === dayIdx);
    if (!entry) return;
    entry.makeTypes = makeTypes || [];
    entry.publishTypes = publishTypes || [];
    this.plugin.settings.weeklySchedule = ws;
    await this.plugin.saveSettings();
  }
  // 发布时间 (作品计划发布日期, 与排期表分开; 与 progress 状态独立)
  async setPublishDate(workId, date) {
    const idx = this.plugin.settings.workIndex || [];
    const e = idx.find((x) => x.id === workId);
    if (!e) return;
    e.publishDate = date || null;
    e.updated = todayStr();
    await this.plugin.saveSettings();
    try {
      const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
      if (f && f instanceof TFile) await this.updateFrontmatter(f, { "publish-date": date || "" });
    } catch (err) {}
  }
  // 发布平台 (作品发布到了哪些账号, 存账号 id 数组)
  async setPublishPlatforms(workId, platformIds) {
    const idx = this.plugin.settings.workIndex || [];
    const e = idx.find((x) => x.id === workId);
    if (!e) return;
    e.publishPlatforms = platformIds || [];
    e.updated = todayStr();
    await this.plugin.saveSettings();
    try {
      const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
      if (f && f instanceof TFile) await this.updateFrontmatter(f, { "publish-platforms": platformIds || [] });
    } catch (err) {}
  }
  // 按账号 id 查找已发布到此平台的作品
  getWorksByAccount(accountId) {
    return (this.plugin.settings.workIndex || []).filter((w) => (w.publishPlatforms || []).includes(accountId));
  }
  // 作品对象 (目标受众/创作对象)
  getAudiences() { return this.plugin.settings.audiences || []; }
  getAudience(id) { return this.getAudiences().find((a) => a.id === id); }
  getAudienceByName(name) { return this.getAudiences().find((a) => a.name === name); }
  getWorksByAudience(audienceId) { return (this.plugin.settings.workIndex || []).filter((w) => w.audience === audienceId); }
  async setWorkAudience(workId, audienceId) {
    const idx = this.plugin.settings.workIndex || [];
    const e = idx.find((x) => x.id === workId);
    if (!e) return;
    e.audience = audienceId || ""; e.updated = todayStr();
    await this.plugin.saveSettings();
    try {
      const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
      if (f && f instanceof TFile) {
        // frontmatter 字段名 character, 存主角名字 (不是 id)
        const aud = this.getAudience(audienceId);
        const audName = aud ? aud.name : "";
        await this.updateFrontmatter(f, { "character": audName });
      }
    } catch (err) {}
  }
  listWorks() { return this.plugin.settings.workIndex || []; }
  // 修改作品类型 (主分类 + 子类)
  async changeWorkType(workId, mainCategory, subType) {
    const idx = this.plugin.settings.workIndex || [];
    const e = idx.find((x) => x.id === workId);
    if (!e) return;
    e.mainCategory = mainCategory; e.subType = subType; e.updated = todayStr();
    await this.plugin.saveSettings();
    try {
      const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
      if (f && f instanceof TFile) await this.updateFrontmatter(f, { "main-category": mainCategory, "sub-type": subType });
    } catch (err) {}
  }
  // 修改作品进度状态 (未开始/策划中/制作中/已完成/已发布)
  async changeWorkStatus(workId, progress) {
    const idx = this.plugin.settings.workIndex || [];
    const e = idx.find((x) => x.id === workId);
    if (!e) return;
    e.progress = progress; e.updated = todayStr();
    await this.plugin.saveSettings();
    try {
      const f = this.plugin.app.vault.getAbstractFileByPath(e.path);
      if (f && f instanceof TFile) await this.updateFrontmatter(f, { "progress": progress });
    } catch (err) {}
  }
  // 同步作品索引与实际作品文件夹 (文件夹↔导航/看板同步)
  async syncWorkIndex() {
    const workFolder = this.getWorkFolder();
    const folder = this.plugin.app.vault.getAbstractFileByPath(workFolder);
    // 收集作品文件夹下所有 .md 文件 (含子文件夹)
    let files = [];
    const collect = (f) => {
      if (f instanceof TFile && f.extension === "md") files.push(f);
      else if (f instanceof TFolder) for (const child of f.children) collect(child);
    };
    if (folder instanceof TFolder) collect(folder);
    const filePaths = new Set(files.map((f) => f.path));
    const idx = (this.plugin.settings.workIndex || []).slice();
    let changed = false;
    // 1) 移除索引里指向已不存在文件的项
    for (let i = idx.length - 1; i >= 0; i--) {
      if (idx[i].path && !filePaths.has(idx[i].path)) { idx.splice(i, 1); changed = true; }
    }
    // 2) 加入作品文件夹里存在但不在索引里的文件 (读 frontmatter 判断分类)
    const indexedPaths = new Set(idx.map((e) => e.path));
    for (const f of files) {
      try {
        const cache = this.plugin.app.metadataCache.getFileCache(f);
        const fm = cache?.frontmatter || {};
        // 只收录 type=edit-flow-work 的文件
        if (fm.type !== "edit-flow-work") continue;
        const mainCategory = fm["main-category"] || "";
        const subType = fm["sub-type"] || "";
        const stage = fm.status || "inspiration";
        const progress = fm.progress || "not-started";
        const publishDate = fm["publish-date"] || null;
        const publishPlatforms = fm["publish-platforms"] || [];
        // frontmatter 字段名 character, 存的是主角名字, 转成 id 存入 workIndex
        const audName = fm.character || "";
        const audObj = audName ? this.getAudienceByName(audName) : null;
        const audience = audObj ? audObj.id : "";
        if (!indexedPaths.has(f.path)) {
          // 新增
          idx.push({
            id: uid(), path: f.path, name: f.basename,
            mainCategory, subType, stage, progress,
            created: fm.created || todayStr(), updated: todayStr(),
            publishDate, publishPlatforms, audience,
          });
          changed = true;
        } else {
          // 更新已有项 (名称/分类/阶段/状态/发布信息/对象 可能被外部修改)
          const e = idx.find((x) => x.path === f.path);
          if (e.name !== f.basename || e.mainCategory !== mainCategory || e.subType !== subType || e.stage !== stage || e.progress !== progress || (e.publishDate || null) !== (publishDate || null) || (e.audience || "") !== audience) {
            e.name = f.basename; e.mainCategory = mainCategory; e.subType = subType; e.stage = stage; e.progress = progress;
            e.publishDate = publishDate; e.publishPlatforms = publishPlatforms; e.audience = audience;
            e.updated = todayStr(); changed = true;
          }
        }
      } catch (e) {}
    }
    if (changed) { this.plugin.settings.workIndex = idx; await this.plugin.saveSettings(); }
    return changed;
  }
  getActiveWorkFile() {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.file) return null;
    const cache = this.plugin.app.metadataCache.getFileCache(view.file);
    const fm = cache?.frontmatter;
    if (fm && (fm.type === "edit-flow-work" || fm["main-category"])) return view.file;
    if (fm && fm.work) {
      const m = String(fm.work).match(/\[\[([^\]]+)\]\]/);
      if (m) { const f = this.plugin.app.metadataCache.getFirstLinkpathDest(m[1], view.file.path); if (f) return f; }
    }
    return null;
  }
}

/* =========================================================================
 *  模板管理器
 * ========================================================================= */

class TemplateManager {
  constructor(plugin) { this.plugin = plugin; }
  async createTemplate(name, content) {
    const root = this.plugin.settings.rootFolder; const tplFolder = `${root}/${this.plugin.settings.templateFolder}`;
    await this.plugin.workflow.ensureFolder(tplFolder);
    const path = `${tplFolder}/${name}.md`;
    if (this.plugin.app.vault.getAbstractFileByPath(path)) return null;
    return await this.plugin.app.vault.create(path, content);
  }
  async addMainCategory({ name, description, color, icon }) {
    const id = name.replace(/\s+/g,"-").toLowerCase() + "-" + uid().slice(0,4);
    const cat = { id, name, icon: icon || "file", color: color || MORANDI.sage, description: description || "" };
    this.plugin.settings.mainCategories.push(cat);
    this.plugin.settings.subTypes[id] = [];
    await this.plugin.saveSettings();
    return cat;
  }
  async removeMainCategory(id) {
    const idx = this.plugin.settings.mainCategories.findIndex((c) => c.id === id);
    if (idx >= 0) {
      this.plugin.settings.mainCategories.splice(idx, 1);
      delete this.plugin.settings.subTypes[id];
      await this.plugin.saveSettings();
    }
  }
  async addSubType(mainId, { name, description, color, icon, needsScript, needsCover, needsCopy, template }) {
    const id = name.replace(/\s+/g,"-").toLowerCase() + "-" + uid().slice(0,4);
    const st = {
      id, name, icon: icon || "file", color: color || MORANDI.sage, description: description || "",
      needsScript: !!needsScript, needsCover: !!needsCover, needsCopy: needsCopy !== false,
      template: template || `---\ntype: edit-flow-work\nmain-category: ${mainId}\nsub-type: ${id}\ntitle: "{{title}}"\nstatus: inspiration\ncreated: {{date}}\ntags:\n  - edit-flow/work\n---\n\n# {{title}}\n\n## 灵感\n\n## 选题\n\n## 作品内容\n`,
    };
    if (!this.plugin.settings.subTypes[mainId]) this.plugin.settings.subTypes[mainId] = [];
    this.plugin.settings.subTypes[mainId].push(st);
    await this.plugin.saveSettings();
    await this.createTemplate(`EF-${name}`, st.template);
    return st;
  }
  async removeSubType(mainId, subId) {
    const arr = this.plugin.settings.subTypes[mainId] || [];
    const idx = arr.findIndex((s) => s.id === subId);
    if (idx >= 0) { arr.splice(idx, 1); await this.plugin.saveSettings(); }
  }
}

/* =========================================================================
 *  综合看板 (左侧栏) - 按主分类分组显示子类
 * ========================================================================= */

class DashboardView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW_DASHBOARD; }
  getDisplayText() { return "Edit Flow · 看板"; }
  getIcon() { return "clapperboard"; }

  async onOpen() {
    this.registerEvent(this.plugin.app.workspace.on("file-open", () => this.draw()));
    const debouncedDraw = debounce(() => { this.plugin.workflow.syncWorkIndex(); this.draw(); }, 300);
    this.registerEvent(this.plugin.app.vault.on("modify", debouncedDraw));
    this.registerEvent(this.plugin.app.vault.on("create", debouncedDraw));
    this.registerEvent(this.plugin.app.vault.on("delete", debouncedDraw));
    this.registerEvent(this.plugin.app.vault.on("rename", debouncedDraw));
    // 首次打开先同步作品索引 (避免 workIndex 为空时看不到作品)
    await this.plugin.workflow.syncWorkIndex();
    this.draw();
  }

  async refresh() {
    await this.plugin.workflow.syncWorkIndex();
    this.draw();
    new Notice("已刷新");
  }

  draw() {
    const c = this.contentEl; c.empty(); c.addClass("ef-dashboard");
    // 工具栏
    const toolbar = c.createDiv({ cls: "ef-dash-toolbar" });
    toolbar.createDiv({ cls: "ef-dash-title" }).textContent = "Edit Flow";
    const actions = toolbar.createDiv({ cls: "ef-dash-actions" });
    const newBtn = actions.createEl("button", { cls: "mod-cta" });
    setLucideIcon(newBtn, "plus"); newBtn.appendText(" 新建");
    newBtn.onclick = () => new CreateWorkModal(this.app, this.plugin, () => this.draw()).open();
    const refreshBtn = actions.createEl("button", { cls: "ef-btn ef-btn-icon" });
    setLucideIcon(refreshBtn, "refresh-cw"); refreshBtn.title = "刷新";
    refreshBtn.onclick = () => this.refresh();
    const navBtn = actions.createEl("button");
    setLucideIcon(navBtn, "compass"); navBtn.appendText(" 导航");
    navBtn.onclick = () => this.plugin.activateNavigation();

    // 账号概览
    const accSection = c.createDiv({ cls: "ef-dash-section" });
    const accHead = accSection.createDiv({ cls: "ef-dash-acc-head" });
    accHead.createDiv({ cls: "ef-dash-section-title" }).textContent = "账号";
    const accAddBtn = accHead.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(accAddBtn, "settings"); accAddBtn.appendText(" 管理");
    accAddBtn.onclick = () => new AccountsModal(this.app, this.plugin, () => this.draw()).open();
    const accGrid = accSection.createDiv({ cls: "ef-dash-acc-grid" });
    const accounts = this.plugin.settings.accounts || [];
    const works = this.plugin.workflow.listWorks();
    if (accounts.length === 0) {
      const empty = accGrid.createDiv({ cls: "ef-muted ef-empty-sm" });
      empty.textContent = "还没有账号, 点击\"管理\"添加。";
    } else {
      for (const acc of accounts) {
        const card = accGrid.createDiv({ cls: "ef-dash-acc-card" });
        card.style.borderLeftColor = acc.color || MORANDI.pink;
        const accCount = works.filter((w) => (w.publishPlatforms || []).includes(acc.id)).length;
        card.createDiv({ cls: "ef-dash-acc-dot", attr: { style: `background:${acc.color || MORANDI.pink}` } });
        const info = card.createDiv({ cls: "ef-dash-acc-info" });
        info.createDiv({ cls: "ef-dash-acc-name" }).textContent = acc.accountId || acc.name || "";
        if (acc.platform) info.createDiv({ cls: "ef-dash-acc-platform" }).textContent = acc.platform;
        card.createDiv({ cls: "ef-dash-acc-count" }).textContent = `${accCount} 个作品`;
        card.onclick = () => new AccountsModal(this.app, this.plugin, () => this.draw()).open();
      }
    }

    // 按主分类分组的作品看板 (平铺, 不再嵌套阶段列)
    const workSection = c.createDiv({ cls: "ef-dash-section" });
    workSection.createDiv({ cls: "ef-dash-section-title" }).textContent = "作品看板";
    for (const cat of this.plugin.settings.mainCategories) {
      const catWrap = workSection.createDiv({ cls: "ef-dash-cat" });
      const catHead = catWrap.createDiv({ cls: "ef-dash-cat-head", attr: { style: `border-left-color:${cat.color}` } });
      const ic = catHead.createSpan({ cls: "ef-dash-cat-icon" });
      setLucideIcon(ic, cat.icon);
      catHead.createSpan({ cls: "ef-dash-cat-name" }).textContent = cat.name;
      const subs = this.plugin.settings.subTypes[cat.id] || [];
      const subTags = catHead.createDiv({ cls: "ef-dash-cat-subs" });
      for (const st of subs) {
        const tag = subTags.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } });
        tag.textContent = st.name;
      }
      const catWorks = works.filter((w) => w.mainCategory === cat.id);
      catHead.createSpan({ cls: "ef-dash-col-count" }).textContent = catWorks.length;
      if (catWorks.length === 0) { catWrap.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "暂无作品"; continue; }
      // 拆分: 进行中 (非已发布) + 已发布 (默认折叠)
      const activeWorks = catWorks.filter((w) => w.progress !== "published");
      const publishedWorks = catWorks.filter((w) => w.progress === "published");

      const renderWorkCard = (parent, w) => {
        const st = this.plugin.workflow.getSubType(cat.id, w.subType);
        const card = parent.createDiv({ cls: "ef-dash-work-card" });
        if (st) card.style.borderLeftColor = st.color;
        // 子类标签 + 进度状态标签 (可点击修改)
        const tagRow = card.createDiv({ cls: "ef-dash-work-tags" });
        if (st) tagRow.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
        const wStatus = getWorkStatus(w.progress);
        const sTag = tagRow.createSpan({ cls: "ef-dash-stage-tag", attr: { style: `background:${wStatus.color}66` } });
        setLucideIcon(sTag.createSpan(), wStatus.icon); sTag.appendText(wStatus.name);
        sTag.title = "点击修改状态";
        sTag.onclick = (e) => { e.stopPropagation(); new ChangeWorkStatusModal(this.app, this.plugin, w, () => this.draw()).open(); };
        const nameEl = card.createDiv({ cls: "ef-dash-work-name" });
        nameEl.textContent = w.name;
        // 发布标记
        if (w.publishDate) { const pubTag = card.createDiv({ cls: "ef-dash-work-pub" }); setLucideIcon(pubTag.createSpan(), "send"); pubTag.appendText(" " + w.publishDate.slice(5)); }
        // 整卡可点击跳转
        card.onclick = async (e) => { if (e.target.closest("button")) return; const f = this.app.vault.getAbstractFileByPath(w.path); if (f && f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); };
        const btns = card.createDiv({ cls: "ef-dash-work-btns" });
        // 修改状态
        const editStage = btns.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(editStage, "git-commit"); editStage.title = "修改状态";
        editStage.onclick = (e) => { e.stopPropagation(); new ChangeWorkStatusModal(this.app, this.plugin, w, () => this.draw()).open(); };
        // 修改类型
        const editType = btns.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(editType, "tag"); editType.title = "修改类型";
        editType.onclick = (e) => { e.stopPropagation(); new ChangeWorkTypeModal(this.app, this.plugin, w, () => this.draw()).open(); };
        // 时间线
        const tl = btns.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(tl, "git-branch"); tl.title = "时间线";
        tl.onclick = (e) => { e.stopPropagation(); this.plugin.activateTools("timeline"); };
        // 发布管理
        const pub = btns.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(pub, "send"); pub.title = "发布管理";
        pub.onclick = (e) => { e.stopPropagation(); new PublishWorkModal(this.app, this.plugin, w, () => this.draw()).open(); };
        // 删除
        const del = btns.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(del, "trash-2"); del.title = "从索引移除 (不删除文件)";
        del.onclick = async (e) => { e.stopPropagation(); if (confirm(`从作品索引移除 "${w.name}"? 文件不会被删除。`)) { const idx = this.plugin.settings.workIndex.findIndex((x) => x.id === w.id); if (idx >= 0) { this.plugin.settings.workIndex.splice(idx, 1); await this.plugin.saveSettings(); this.draw(); } } };
      };

      // 进行中作品网格
      const activeGrid = catWrap.createDiv({ cls: "ef-dash-work-grid" });
      if (activeWorks.length === 0 && publishedWorks.length === 0) { activeGrid.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "暂无作品"; }
      for (const w of activeWorks) renderWorkCard(activeGrid, w);

      // 已发布作品折叠区
      if (publishedWorks.length > 0) {
        const pubFold = catWrap.createDiv({ cls: "ef-dash-pub-fold" });
        const pubHead = pubFold.createDiv({ cls: "ef-dash-pub-head" });
        const chev = pubHead.createSpan({ cls: "ef-dash-pub-chev" });
        setLucideIcon(chev, "chevron-right");
        pubHead.createSpan({ cls: "ef-dash-pub-title" }).textContent = `已发布 (${publishedWorks.length})`;
        const pubGrid = pubFold.createDiv({ cls: "ef-dash-work-grid ef-dash-pub-grid is-collapsed" });
        for (const w of publishedWorks) renderWorkCard(pubGrid, w);
        pubHead.onclick = () => {
          const collapsed = pubGrid.hasClass("is-collapsed");
          pubGrid.toggleClass("is-collapsed", !collapsed);
          setLucideIcon(chev, collapsed ? "chevron-down" : "chevron-right");
        };
      }
    }
  }
}

/* =========================================================================
 *  功能区 (右侧栏 - tabs)
 * ========================================================================= */

class ToolsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin;
    this.activeTab = "timeline";
    this.tlNodes = []; this.tlDragSrcId = null; this.tlActiveWorkFile = null; this.tlScriptFile = null;
    this.tlMode = "timeline"; // "timeline" | "grid"
    this.tlGrid = { headers: ["列1", "列2", "列3"], rows: [] };
    this.inspQuery = "";
  }
  getViewType() { return VIEW_TOOLS; }
  getDisplayText() { return "Edit Flow · 功能区"; }
  getIcon() { return "scissors"; }
  async onOpen() {
    this.registerEvent(this.plugin.app.workspace.on("file-open", () => { if (this.activeTab === "timeline") this.tlRefresh(); }));
    this.draw();
  }

  draw() {
    const c = this.contentEl; c.empty(); c.addClass("ef-tools");
    const tabBar = c.createDiv({ cls: "ef-tools-tabs" });
    const tabs = [
      { id: "timeline", name: "逻辑线", icon: "git-branch" },
      { id: "inspiration", name: "灵感", icon: "sparkles" },
      { id: "sticky", name: "便签", icon: "sticky-note" },
      { id: "material", name: "素材", icon: "package" },
    ];
    for (const t of tabs) {
      const btn = tabBar.createEl("button", { cls: "ef-tools-tab" + (this.activeTab === t.id ? " is-active" : "") });
      const ic = btn.createSpan(); setLucideIcon(ic, t.icon);
      btn.appendText(" " + t.name);
      btn.onclick = () => { this.activeTab = t.id; this.draw(); };
    }
    if (this.activeTab === "sticky") {
      const fb = c.createDiv({ cls: "ef-tools-float-bar" }).createEl("button", { cls: "mod-cta" });
      setLucideIcon(fb, "plus"); fb.appendText(" 新建悬浮便签");
      fb.onclick = () => this.plugin.openStickyNote();
    }
    this.tabBody = c.createDiv({ cls: "ef-tools-body" });
    if (this.activeTab === "timeline") this.renderTimeline();
    else if (this.activeTab === "inspiration") this.renderInspiration();
    else if (this.activeTab === "sticky") this.renderStickyList();
    else if (this.activeTab === "material") this.renderMaterial();
  }

  /* ---- 时间线 ---- */
  async tlRefresh() {
    const wf = this.plugin.workflow.getActiveWorkFile();
    if (wf !== this.tlActiveWorkFile) {
      this.tlActiveWorkFile = wf;
      await this.tlLoadScript();
      if (this.tlMode === "grid") await this.tlLoadGrid();
      if (this.activeTab === "timeline") this.renderTimeline();
    }
  }
  async tlLoadScript() {
    this.tlNodes = []; this.tlScriptFile = null;
    if (!this.tlActiveWorkFile) return;
    // 逻辑线直接存在作品文件里 (## 逻辑线 章节), 不再读外部脚本文件
    this.tlScriptFile = this.tlActiveWorkFile;
    try {
      const content = await this.plugin.app.vault.read(this.tlActiveWorkFile);
      this.tlNodes = this.tlExtractNodes(content);
    } catch (e) { this.tlNodes = []; }
  }
  // 从作品文件内容里提取 ## 逻辑线 章节的节点
  tlExtractNodes(content) {
    const { body } = parseFrontmatter(content);
    // 提取 ## 逻辑线 章节 (到下一个 ## 或文末)
    const secRe = /##\s+逻辑线[^\n\r]*\r?\n([\s\S]*?)(?=\n##\s|$)/;
    const m = body.match(secRe);
    const section = m ? m[1] : "";
    const nodes = [];
    const lines = section.split(/\r?\n/);
    let cur = null, buf = [];
    for (const line of lines) {
      // 兼容老格式: ## 时间 标题 / 新格式: ### 标题 (章节内用三级标题)
      const nm = line.match(/^###\s+(.+)$/);
      if (nm) {
        if (cur) { cur.content = buf.join("\n").trim(); nodes.push(cur); }
        cur = { id: uid(), title: nm[1].trim(), content: "", note: "" }; buf = [];
      } else if (line.startsWith("> ") && cur) {
        cur.note += line.slice(2) + "\n";
      } else if (cur) {
        buf.push(line);
      }
    }
    if (cur) { cur.content = buf.join("\n").trim(); nodes.push(cur); }
    return nodes;
  }
  async tlSaveNodes() {
    if (!this.tlScriptFile || !this.tlActiveWorkFile) return;
    // 构造节点章节内容
    let nodesBody = "";
    this.tlNodes.forEach((n) => {
      nodesBody += `### ${n.title || "节点"}\n\n`;
      if (n.content) nodesBody += `${n.content}\n\n`;
      if (n.note) nodesBody += `> ${n.note}\n\n`;
    });
    if (!nodesBody.trim()) nodesBody = "> 侧边栏逻辑线视图编辑节点\n";
    // 读取当前作品文件, 替换或插入 ## 逻辑线 章节
    const file = this.tlActiveWorkFile;
    let content = await this.plugin.app.vault.read(file);
    const secRe = /##\s+逻辑线[\s\S]*?(?=\n##\s|$)/;
    const newSection = `## 逻辑线\n\n${nodesBody.trimEnd()}\n`;
    if (secRe.test(content)) {
      content = content.replace(secRe, newSection);
    } else {
      content = content.replace(/\s+$/, "") + `\n\n${newSection}`;
    }
    await this.plugin.app.vault.modify(file, content);
  }

  renderTimeline() {
    const c = this.tabBody; c.empty();
    const header = c.createDiv({ cls: "ef-tl-header" });
    const titleEl = header.createDiv({ cls: "ef-tl-title" });
    if (this.tlActiveWorkFile) {
      const fm = this.plugin.app.metadataCache.getFileCache(this.tlActiveWorkFile)?.frontmatter || {};
      const cat = this.plugin.workflow.getMainCategory(fm["main-category"]);
      const st = this.plugin.workflow.getSubType(fm["main-category"], fm["sub-type"]);
      if (st) titleEl.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
      titleEl.createSpan({ cls: "ef-tl-name" }).textContent = this.tlActiveWorkFile.basename;
    } else titleEl.createSpan({ cls: "ef-muted" }).textContent = "未选中作品";
    const tools = header.createDiv({ cls: "ef-tl-tools" });
    // 模式切换: 时间轴 / 表格
    const modeSwitch = tools.createDiv({ cls: "ef-tl-mode-switch" });
    const tlBtn = modeSwitch.createEl("button", { cls: "ef-tl-mode-btn" + (this.tlMode === "timeline" ? " is-active" : "") });
    setLucideIcon(tlBtn, "list"); tlBtn.title = "时间轴模式";
    tlBtn.onclick = async () => { if (this.tlMode === "timeline") return; this.tlMode = "timeline"; this.renderTimeline(); };
    const gridBtn = modeSwitch.createEl("button", { cls: "ef-tl-mode-btn" + (this.tlMode === "grid" ? " is-active" : "") });
    setLucideIcon(gridBtn, "table"); gridBtn.title = "表格模式";
    gridBtn.onclick = async () => { if (this.tlMode === "grid") return; this.tlMode = "grid"; await this.tlLoadGrid(); this.renderTimeline(); };
    const saveBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon" });
    setLucideIcon(saveBtn, "save"); saveBtn.title = "保存";
    saveBtn.onclick = async () => { if (this.tlMode === "grid") await this.tlSaveGrid(); else await this.tlSaveNodes(); new Notice("已保存"); };
    if (!this.tlActiveWorkFile) {
      const empty = c.createDiv({ cls: "ef-empty-state" });
      empty.createEl("p", { cls: "ef-muted" }).textContent = "请先打开一个作品文件";
      return;
    }
    if (this.tlMode === "grid") { this._tlGridHost = c.createDiv({ cls: "ef-tl-grid-host" }); this.renderGrid(); return; }
    const addRow = c.createDiv({ cls: "ef-tl-addrow" });
    const titleInput = addRow.createEl("input", { cls: "ef-tl-title-input", attr: { placeholder: "节点标题 (可选, 回车添加)" } });
    const addNodeBtn = addRow.createEl("button", { cls: "mod-cta" });
    setLucideIcon(addNodeBtn, "plus"); addNodeBtn.appendText(" 添加");
    const importBtn = addRow.createEl("button", { cls: "ef-btn" });
    setLucideIcon(importBtn, "upload"); importBtn.appendText(" 导入歌词/文本");
    importBtn.onclick = () => this.tlImportFromFile();
    const onAdd = () => { this.tlNodes.push({ id: uid(), title: titleInput.value.trim(), content: "", note: "" }); titleInput.value = ""; this.tlRenderNodes(); this.tlSaveNodes(); };
    addNodeBtn.onclick = onAdd;
    titleInput.onkeydown = (e) => { if (e.key === "Enter") onAdd(); };
    this.tlNodesContainer = c.createDiv({ cls: "ef-tl-nodes" });
    this.tlRenderNodes();
  }

  // ===== 表格模式 =====
  async tlLoadGrid() {
    if (!this.tlActiveWorkFile) { this.tlGrid = { headers: ["列1", "列2", "列3"], rows: [] }; return; }
    try {
      const content = await this.plugin.app.vault.read(this.tlActiveWorkFile);
      this.tlGrid = this.tlExtractGrid(content);
    } catch (e) { this.tlGrid = { headers: ["列1", "列2", "列3"], rows: [] }; }
  }
  tlExtractGrid(content) {
    const { body } = parseFrontmatter(content);
    const secRe = /##\s+逻辑线表格[^\n\r]*\r?\n([\s\S]*?)(?=\n##\s|$)/;
    const m = body.match(secRe);
    if (!m) return { headers: ["列1", "列2", "列3"], rows: [] };
    const lines = m[1].split(/\r?\n/).filter((l) => l.trim() && l.startsWith("|"));
    if (lines.length < 2) return { headers: ["列1", "列2", "列3"], rows: [] };
    const parseLine = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const headers = parseLine(lines[0]);
    // 从 data.json 读取行颜色和折叠状态
    const pathKey = this.tlActiveWorkFile.path;
    const saved = (this.plugin.settings.gridRowColors && this.plugin.settings.gridRowColors[pathKey]) || { colors: [], collapsed: {} };
    // 解析缩进前缀重建树形结构: » 表示一级子行, » » 表示二级
    const rows = [];
    const stack = []; // 用于追踪每层的父行
    for (let i = 2; i < lines.length; i++) {
      let cells = parseLine(lines[i]);
      while (cells.length < headers.length) cells.push("");
      // 解析第一列的缩进前缀
      let indent = 0;
      let firstCell = cells[0] || "";
      while (firstCell.startsWith("» ")) { indent++; firstCell = firstCell.slice(2); }
      cells[0] = firstCell;
      const colorIdx = i - 2;
      const node = { cells, color: (saved.colors && saved.colors[colorIdx]) || "", collapsed: false, children: [] };
      // 找到正确的父节点
      while (stack.length > indent) stack.pop();
      if (stack.length === 0) { rows.push(node); }
      else { stack[stack.length - 1].children.push(node); }
      stack.push(node);
      // 恢复折叠状态
      const nodeKey = `${colorIdx}`;
      if (saved.collapsed && saved.collapsed[nodeKey]) node.collapsed = true;
    }
    return { headers, rows };
  }
  // 扁平化树形结构用于保存: 返回 [{ cells, color }, ...]
  tlFlattenGridRows() {
    const result = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const cells = n.cells.slice();
        if (depth > 0) cells[0] = "» ".repeat(depth) + (cells[0] || "");
        result.push({ cells, color: n.color || "", collapsed: n.collapsed || false });
        if (n.children && n.children.length > 0) walk(n.children, depth + 1);
      }
    };
    walk(this.tlGrid.rows, 0);
    return result;
  }
  async tlSaveGrid() {
    if (!this.tlActiveWorkFile) return;
    const flat = this.tlFlattenGridRows();
    // 写纯表格到笔记 (含缩进前缀)
    let tableBody = "| " + this.tlGrid.headers.join(" | ") + " |\n";
    tableBody += "|" + this.tlGrid.headers.map(() => "---").join("|") + "|\n";
    for (const row of flat) {
      const cells = row.cells.slice(0, this.tlGrid.headers.length);
      while (cells.length < this.tlGrid.headers.length) cells.push("");
      tableBody += "| " + cells.join(" | ") + " |\n";
    }
    const newSection = `## 逻辑线表格\n\n${tableBody.trimEnd()}\n`;
    const file = this.tlActiveWorkFile;
    let content = await this.plugin.app.vault.read(file);
    const secRe = /##\s+逻辑线表格[\s\S]*?(?=\n##\s|$)/;
    if (secRe.test(content)) content = content.replace(secRe, newSection);
    else content = content.replace(/\s+$/, "") + `\n\n${newSection}`;
    await this.plugin.app.vault.modify(file, content);
    // 保存行颜色和折叠状态到 data.json
    if (!this.plugin.settings.gridRowColors) this.plugin.settings.gridRowColors = {};
    this.plugin.settings.gridRowColors[file.path] = {
      colors: flat.map((r) => r.color || ""),
      collapsed: flat.reduce((acc, r, i) => { if (r.collapsed) acc[i] = true; return acc; }, {}),
    };
    await this.plugin.saveSettings();
  }

  renderGrid() {
    const c = this._tlGridHost; if (!c) return; c.empty();
    const wrap = c.createDiv({ cls: "ef-tl-grid-wrap" });
    const toolbar = wrap.createDiv({ cls: "ef-tl-grid-toolbar" });
    const addRowBtn = toolbar.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(addRowBtn, "plus"); addRowBtn.appendText(" 行");
    addRowBtn.onclick = async () => { this.tlGrid.rows.push(this.tlNewRow()); this.renderGrid(); await this.tlSaveGrid(); };
    const addColBtn = toolbar.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(addColBtn, "plus"); addColBtn.appendText(" 列");
    addColBtn.onclick = async () => { this.tlGrid.headers.push("新列"); this.tlWalkAllRows((r) => r.cells.push("")); this.renderGrid(); await this.tlSaveGrid(); };
    const importBtn = toolbar.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(importBtn, "upload"); importBtn.appendText(" 导入歌词/文本");
    importBtn.onclick = () => this.tlGridImportFromFile();
    const table = wrap.createEl("table", { cls: "ef-tl-grid-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    const headCorner = headRow.createEl("th", { cls: "ef-tl-grid-corner" });
    this.tlGrid.headers.forEach((h, ci) => {
      const th = headRow.createEl("th", { cls: "ef-tl-grid-th" });
      const input = th.createEl("input", { cls: "ef-tl-grid-head-input", attr: { value: h, placeholder: "列名" } });
      input.onchange = async () => { this.tlGrid.headers[ci] = input.value; await this.tlSaveGrid(); };
      const colOps = th.createDiv({ cls: "ef-tl-grid-col-ops" });
      const insLeft = colOps.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "左侧插入列" } });
      setLucideIcon(insLeft, "chevron-left"); insLeft.onclick = async () => { this.tlGrid.headers.splice(ci, 0, "新列"); this.tlWalkAllRows((r) => r.cells.splice(ci, 0, "")); this.renderGrid(); await this.tlSaveGrid(); };
      const insRight = colOps.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "右侧插入列" } });
      setLucideIcon(insRight, "chevron-right"); insRight.onclick = async () => { this.tlGrid.headers.splice(ci + 1, 0, "新列"); this.tlWalkAllRows((r) => r.cells.splice(ci + 1, 0, "")); this.renderGrid(); await this.tlSaveGrid(); };
      const delCol = colOps.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "删除此列" } });
      setLucideIcon(delCol, "trash-2"); delCol.onclick = async () => { if (this.tlGrid.headers.length <= 1) { new Notice("至少保留一列"); return; } this.tlGrid.headers.splice(ci, 1); this.tlWalkAllRows((r) => r.cells.splice(ci, 1)); this.renderGrid(); await this.tlSaveGrid(); };
    });
    const tbody = table.createEl("tbody");
    this._renderGridRows(tbody, this.tlGrid.rows, 0);
    if (this.tlGrid.rows.length === 0) {
      const emptyRow = tbody.createEl("tr");
      const emptyCell = emptyRow.createEl("td", { cls: "ef-tl-grid-empty", attr: { colspan: String(this.tlGrid.headers.length + 1) } });
      emptyCell.textContent = '空表格, 点击上方"添加行"开始';
    }
  }

  // 递归渲染行 (含子行)
  _renderGridRows(tbody, rows, depth, parentPath) {
    parentPath = parentPath || [];
    rows.forEach((row, ri) => {
      const rowPath = parentPath.concat(ri);
      const tr = tbody.createEl("tr");
      tr.dataset.depth = depth;
      tr.dataset.rowpath = rowPath.join("-");
      tr.style.setProperty("--row-depth", depth);
      // 颜色: 自定义色优先, 否则按层级取默认莫兰迪色
      const rowColor = row.color || MORANDI_LIST[depth % MORANDI_LIST.length];
      tr.style.background = rowColor + "44";
      tr.dataset.defaultColor = rowColor;
      // 拖拽换序
      tr.draggable = true;
      tr.addEventListener("dragstart", (e) => { this._tlGridDragPath = rowPath.join("-"); tr.classList.add("ef-tl-grid-dragging"); e.dataTransfer.effectAllowed = "move"; });
      tr.addEventListener("dragend", () => { tr.classList.remove("ef-tl-grid-dragging"); tbody.querySelectorAll(".ef-tl-grid-drag-over").forEach((n) => n.classList.remove("ef-tl-grid-drag-over")); });
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (this._tlGridDragPath && this._tlGridDragPath !== rowPath.join("-")) {
          // 判断鼠标在行的上半还是下半
          const rect = tr.getBoundingClientRect();
          const isUpper = (e.clientY - rect.top) < rect.height / 2;
          tr.classList.remove("ef-tl-grid-drag-over-bottom");
          if (isUpper) { tr.classList.add("ef-tl-grid-drag-over-top"); tr.classList.remove("ef-tl-grid-drag-over-bottom"); }
          else { tr.classList.add("ef-tl-grid-drag-over-bottom"); tr.classList.remove("ef-tl-grid-drag-over-top"); }
        }
      });
      tr.addEventListener("dragleave", () => { tr.classList.remove("ef-tl-grid-drag-over-top", "ef-tl-grid-drag-over-bottom"); });
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        const isOverTop = tr.classList.contains("ef-tl-grid-drag-over-top");
        tr.classList.remove("ef-tl-grid-drag-over-top", "ef-tl-grid-drag-over-bottom");
        const fromPath = this._tlGridDragPath;
        if (!fromPath || fromPath === rowPath.join("-")) return;
        // 不能拖到自己的子行里
        if (rowPath.join("-").startsWith(fromPath + "-")) { new Notice("不能拖到自己的子行内"); return; }
        // 通过路径查找源行
        const fromParts = fromPath.split("-").map(Number);
        const toParts = rowPath.slice();
        // 获取源行数据
        let fromArr = this.tlGrid.rows;
        let fromNode;
        for (let i = 0; i < fromParts.length; i++) {
          fromNode = fromArr[fromParts[i]];
          if (i < fromParts.length - 1) fromArr = fromNode.children;
        }
        const [moved] = fromArr.splice(fromParts[fromParts.length - 1], 1);
        // 重新查找目标位置 (源行被移除后索引可能变化)
        let toArr = this.tlGrid.rows;
        let toNode;
        for (let i = 0; i < toParts.length; i++) {
          // 如果源行在同一层级且在目标之前, 索引需要调整
          let idx = toParts[i];
          if (fromParts.length <= i + 1 && fromParts[i] < idx && fromParts.slice(0, i).join("-") === toParts.slice(0, i).join("-")) idx--;
          toNode = toArr[idx];
          if (i < toParts.length - 1) toArr = toNode.children;
        }
        let toIdx = toParts[toParts.length - 1];
        if (fromParts.length === toParts.length && fromParts.slice(0, -1).join("-") === toParts.slice(0, -1).join("-") && fromParts[fromParts.length - 1] < toIdx) toIdx--;
        if (!isOverTop) toIdx++;
        toArr.splice(toIdx, 0, moved);
        this._tlGridDragPath = null;
        this.renderGrid();
        await this.tlSaveGrid();
        new Notice("已调整顺序");
      });
      // 行首操作格: 两行按钮, 每行用 flex 左对齐
      const rowOpsCell = tr.createEl("td", { cls: "ef-tl-grid-row-ops" });
      // 第一行: 上方插入/下方插入/删除
      const row1 = rowOpsCell.createDiv({ cls: "ef-tl-grid-row-ops-line" });
      const insAbove = row1.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "上方插入同级行" } });
      setLucideIcon(insAbove, "chevron-up"); insAbove.onclick = async () => { rows.splice(ri, 0, this.tlNewRow()); this.renderGrid(); await this.tlSaveGrid(); };
      const insBelow = row1.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "下方插入同级行" } });
      setLucideIcon(insBelow, "chevron-down"); insBelow.onclick = async () => { rows.splice(ri + 1, 0, this.tlNewRow()); this.renderGrid(); await this.tlSaveGrid(); };
      const delRow = row1.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "删除此行(含子行)" } });
      setLucideIcon(delRow, "trash-2"); delRow.onclick = async () => { rows.splice(ri, 1); this.renderGrid(); await this.tlSaveGrid(); };
      // 第二行: 颜色/添加子行/展开收起
      const row2 = rowOpsCell.createDiv({ cls: "ef-tl-grid-row-ops-line" });
      const colorBtn = row2.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm ef-tl-grid-color-btn", attr: { title: "行颜色" } });
      if (row.color) {
        colorBtn.style.setProperty("background", row.color, "important");
        colorBtn.style.setProperty("border-color", row.color, "important");
        colorBtn.innerHTML = "";
      } else {
        // 显示默认层级色 (半透明 + 虚线边框)
        colorBtn.style.setProperty("background", rowColor + "66", "important");
        colorBtn.style.setProperty("border-color", rowColor, "important");
        colorBtn.style.borderStyle = "dashed";
        setLucideIcon(colorBtn, "palette");
      }
      colorBtn.onclick = () => this.tlPickRowColor(row, colorBtn);
      const addChildBtn = row2.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm", attr: { title: "添加子行" } });
      setLucideIcon(addChildBtn, "corner-down-right");
      addChildBtn.onclick = async () => {
        if (!row.children) row.children = [];
        row.children.push(this.tlNewRow());
        row.collapsed = false;
        this.renderGrid();
        await this.tlSaveGrid();
      };
      const hasChildren = row.children && row.children.length > 0;
      if (hasChildren) {
        const toggleBtn = row2.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm ef-tl-grid-toggle", attr: { title: row.collapsed ? "展开" : "收起" } });
        setLucideIcon(toggleBtn, row.collapsed ? "chevron-right" : "chevron-down");
        toggleBtn.onclick = async () => { row.collapsed = !row.collapsed; this.renderGrid(); await this.tlSaveGrid(); };
      } else {
        row2.createDiv({ cls: "ef-tl-grid-toggle-placeholder" });
      }
      // 数据单元格 (第一列加缩进)
      this.tlGrid.headers.forEach((h, ci) => {
        const td = tr.createEl("td", { cls: "ef-tl-grid-td" });
        if (ci === 0 && depth > 0) td.style.paddingLeft = (8 + depth * 20) + "px";
        const ta = td.createEl("textarea", { cls: "ef-tl-grid-cell", attr: { placeholder: "" } });
        ta.value = row.cells[ci] || "";
        ta.oninput = debounce(() => { row.cells[ci] = ta.value; this.tlSaveGrid(); }, 600);
      });
      // 递归渲染子行 (如果未收起)
      if (hasChildren && !row.collapsed) {
        this._renderGridRows(tbody, row.children, depth + 1, rowPath);
      }
    });
  }

  // 遍历所有行 (含子行)
  tlWalkAllRows(fn) {
    const walk = (nodes) => { for (const n of nodes) { fn(n); if (n.children) walk(n.children); } };
    walk(this.tlGrid.rows);
  }
  tlNewRow() { return { cells: this.tlGrid.headers.map(() => ""), color: "", collapsed: false, children: [] }; }

  // 行颜色选择器
  tlPickRowColor(row, anchorBtn) {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = "选择行颜色";
    modal.modalEl.style.maxWidth = "320px";
    const palette = modal.contentEl.createDiv({ cls: "ef-tl-grid-color-palette" });
    const clearBtn = palette.createEl("button", { cls: "ef-tl-grid-color-swatch ef-tl-grid-color-clear", attr: { title: "使用默认层级色" } });
    setLucideIcon(clearBtn, "rotate-ccw");
    clearBtn.onclick = async () => { row.color = ""; this.renderGrid(); await this.tlSaveGrid(); modal.close(); };
    const colors = ["#B5B682", "#9CA8B8", "#C8B8A0", "#A8B8A0", "#D4B5B0", "#B8A8C8", "#D8C8B0", "#A8C0B8", "#E8B8B8", "#7EC8E3", "#FFD580", "#C8E6A0"];
    colors.forEach((c) => {
      const sw = palette.createEl("button", { cls: "ef-tl-grid-color-swatch", attr: { style: `background:${c}!important;border-color:${c}!important`, title: c } });
      sw.onclick = async () => { row.color = c; this.renderGrid(); await this.tlSaveGrid(); modal.close(); };
    });
    modal.open();
  }

  // 从 lrc / txt 文件导入逻辑线节点
  async tlImportFromFile() {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = "导入歌词/文本到逻辑线";
    modal.modalEl.style.maxWidth = "600px";
    const desc = modal.contentEl.createDiv({ cls: "ef-muted", attr: { style: "margin-bottom:12px;" } });
    desc.textContent = "选择素材库里的 lrc 歌词或 txt 文本文件, 每行/每句歌词生成一个逻辑线节点。";
    // 文件列表
    const listEl = modal.contentEl.createDiv({ cls: "ef-tl-import-list" });
    const root = this.plugin.settings.rootFolder;
    const matFolder = `${root}/${this.plugin.settings.materialFolder}`;
    const folder = this.app.vault.getAbstractFileByPath(matFolder);
    let files = [];
    const collect = (f) => {
      if (f instanceof TFile) { const ext = f.extension?.toLowerCase(); if (ext === "lrc" || ext === "txt") files.push(f); }
      else if (f instanceof TFolder) for (const child of f.children) collect(child);
    };
    if (folder instanceof TFolder) collect(folder);
    if (files.length === 0) {
      listEl.createEl("p", { cls: "ef-muted" }).textContent = "素材库里没有 lrc 或 txt 文件, 请先放入素材文件夹";
    } else {
      for (const f of files) {
        const row = listEl.createDiv({ cls: "ef-tl-import-row" });
        const ic = row.createDiv({ cls: "ef-insp-row-icon" });
        setLucideIcon(ic, f.extension === "lrc" ? "music" : "file-text");
        const nameEl = row.createDiv({ cls: "ef-insp-row-name" });
        const relPath = f.path.startsWith(matFolder + "/") ? f.path.slice(matFolder.length + 1) : f.name;
        nameEl.textContent = relPath;
        nameEl.title = f.path;
        const importMode = row.createEl("select", { cls: "ef-tl-import-mode" });
        importMode.innerHTML = '<option value="append">追加到末尾</option><option value="replace">替换全部</option>';
        const btn = row.createEl("button", { cls: "mod-cta ef-btn-sm" });
        btn.textContent = "导入";
        btn.onclick = async () => {
          const content = await this.app.vault.read(f);
          let newNodes = [];
          if (f.extension === "lrc") {
            // lrc: [mm:ss.xxx] 歌词 → 每句一个节点
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
              const m = line.match(/\[(\d{2}):(\d{2})\.?(\d{0,3})\]\s*(.*)/);
              if (m) {
                const mm = m[1], ss = m[2];
                const lyric = (m[4] || "").trim();
                if (lyric) newNodes.push({ id: uid(), title: `${mm}:${ss}`, content: lyric, note: "" });
              }
            }
          } else {
            // txt: 按空行分段, 每段一个节点
            const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
            if (paragraphs.length > 1) {
              paragraphs.forEach((p, i) => newNodes.push({ id: uid(), title: `段落 ${i + 1}`, content: p, note: "" }));
            } else {
              // 没有空行分段, 按每行一个节点
              const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
              lines.forEach((l, i) => newNodes.push({ id: uid(), title: `第 ${i + 1} 行`, content: l, note: "" }));
            }
          }
          if (newNodes.length === 0) { new Notice("文件内容为空或格式不支持"); return; }
          if (importMode.value === "replace") this.tlNodes = newNodes;
          else this.tlNodes.push(...newNodes);
          this.tlRenderNodes();
          await this.tlSaveNodes();
          modal.close();
          new Notice(`已导入 ${newNodes.length} 个节点`);
        };
      }
    }
    modal.open();
  }

  // 从 lrc / txt 文件导入到表格模式
  async tlGridImportFromFile() {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = "导入歌词/文本到表格";
    modal.modalEl.style.maxWidth = "600px";
    const desc = modal.contentEl.createDiv({ cls: "ef-muted", attr: { style: "margin-bottom:12px;" } });
    desc.textContent = "选择素材库里的 lrc 歌词或 txt 文本文件。lrc 会按时间戳分句生成行, txt 按段落或行生成行。";
    // 导入选项
    const optRow = modal.contentEl.createDiv({ cls: "ef-tl-grid-import-opts", attr: { style: "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;" } });
    optRow.createDiv({ cls: "ef-muted" }).textContent = "导入模式:";
    const importMode = optRow.createEl("select", { cls: "ef-tl-title-input", attr: { style: "flex:0 0 auto;" } });
    importMode.innerHTML = '<option value="append">追加到末尾</option><option value="replace">替换全部</option>';
    optRow.createDiv({ cls: "ef-muted" }).textContent = "lrc 列结构:";
    const lrcColsMode = optRow.createEl("select", { cls: "ef-tl-title-input", attr: { style: "flex:0 0 auto;" } });
    lrcColsMode.innerHTML = '<option value="auto">自动(空表时设为时间/歌词)</option><option value="keep">保持现有列结构</option>';
    // 文件列表
    const listEl = modal.contentEl.createDiv({ cls: "ef-tl-import-list" });
    const root = this.plugin.settings.rootFolder;
    const matFolder = `${root}/${this.plugin.settings.materialFolder}`;
    const folder = this.app.vault.getAbstractFileByPath(matFolder);
    let files = [];
    const collect = (f) => {
      if (f instanceof TFile) { const ext = f.extension?.toLowerCase(); if (ext === "lrc" || ext === "txt") files.push(f); }
      else if (f instanceof TFolder) for (const child of f.children) collect(child);
    };
    if (folder instanceof TFolder) collect(folder);
    if (files.length === 0) {
      listEl.createEl("p", { cls: "ef-muted" }).textContent = "素材库里没有 lrc 或 txt 文件, 请先放入素材文件夹";
    } else {
      for (const f of files) {
        const row = listEl.createDiv({ cls: "ef-tl-import-row" });
        const ic = row.createDiv({ cls: "ef-insp-row-icon" });
        setLucideIcon(ic, f.extension === "lrc" ? "music" : "file-text");
        const nameEl = row.createDiv({ cls: "ef-insp-row-name" });
        const relPath = f.path.startsWith(matFolder + "/") ? f.path.slice(matFolder.length + 1) : f.name;
        nameEl.textContent = relPath;
        nameEl.title = f.path;
        const btn = row.createEl("button", { cls: "mod-cta ef-btn-sm" });
        btn.textContent = "导入";
        btn.onclick = async () => {
          const content = await this.app.vault.read(f);
          let newRows = [];
          if (f.extension === "lrc") {
            // lrc: [mm:ss.xxx] 歌词 → 每句一个表格行
            const lines = content.split(/\r?\n/);
            for (const line of lines) {
              const m = line.match(/\[(\d{2}):(\d{2})\.?(\d{0,3})\]\s*(.*)/);
              if (m) {
                const mm = m[1], ss = m[2];
                const lyric = (m[4] || "").trim();
                if (lyric) {
                  const r = this.tlNewRow();
                  r.cells[0] = `${mm}:${ss}`;
                  r.cells[1] = lyric;
                  newRows.push(r);
                }
              }
            }
            // 自动模式: 空表时设置列头为 时间/歌词
            if (lrcColsMode.value === "auto" && this.tlGrid.rows.length === 0) {
              const isDefault = this.tlGrid.headers.length === 3 && this.tlGrid.headers.every((h, i) => h === ["列1", "列2", "列3"][i]);
              if (isDefault) this.tlGrid.headers = ["时间", "歌词", ""];
            }
          } else {
            // txt: 按空行分段, 每段一个表格行; 无空行则按行
            const paragraphs = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
            if (paragraphs.length > 1) {
              paragraphs.forEach((p) => { const r = this.tlNewRow(); r.cells[0] = p; newRows.push(r); });
            } else {
              const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
              lines.forEach((l) => { const r = this.tlNewRow(); r.cells[0] = l; newRows.push(r); });
            }
          }
          if (newRows.length === 0) { new Notice("文件内容为空或格式不支持"); return; }
          if (importMode.value === "replace") this.tlGrid.rows = newRows;
          else this.tlGrid.rows.push(...newRows);
          this.renderGrid();
          await this.tlSaveGrid();
          modal.close();
          new Notice(`已导入 ${newRows.length} 行`);
        };
      }
    }
    modal.open();
  }

  tlRenderNodes() {
    const c = this.tlNodesContainer; if (!c) return; c.empty();
    if (this.tlNodes.length === 0) { c.createEl("p", { cls: "ef-muted ef-tl-empty" }).textContent = "暂无节点"; return; }
    // 拖拽状态
    this._tlDragId = null;
    this.tlNodes.forEach((node, idx) => {
      const row = c.createDiv({ cls: "ef-tl-node" });
      row.dataset.id = node.id;
      row.draggable = true;
      const left = row.createDiv({ cls: "ef-tl-node-left" });
      // 序号 (不依赖时间)
      const numEl = left.createDiv({ cls: "ef-tl-num" });
      numEl.textContent = String(idx + 1).padStart(2, "0");
      // 上下移动按钮 (兼容移动端)
      const upBtn = left.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm ef-tl-move-btn" });
      setLucideIcon(upBtn, "chevron-up"); upBtn.title = "上移";
      upBtn.onclick = () => this.tlMoveNode(node.id, -1);
      const downBtn = left.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm ef-tl-move-btn" });
      setLucideIcon(downBtn, "chevron-down"); downBtn.title = "下移";
      downBtn.onclick = () => this.tlMoveNode(node.id, 1);
      // 拖拽手柄 (桌面端)
      const dragHandle = left.createDiv({ cls: "ef-tl-drag-handle" });
      setLucideIcon(dragHandle, "grip-vertical");
      dragHandle.title = "拖动排序";
      const line = row.createDiv({ cls: "ef-tl-line" });
      line.createDiv({ cls: "ef-tl-dot" }); line.createDiv({ cls: "ef-tl-bar" });
      const card = row.createDiv({ cls: "ef-tl-card" });
      const cardHead = card.createDiv({ cls: "ef-tl-card-head" });
      const titleInput = cardHead.createEl("input", { cls: "ef-tl-card-title", attr: { value: node.title || "", placeholder: "节点标题" } });
      titleInput.onchange = () => { node.title = titleInput.value; this.tlSaveNodes(); };
      const cardTools = cardHead.createDiv({ cls: "ef-tl-card-tools" });
      const hwBtn = cardTools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
      setLucideIcon(hwBtn, this.plugin.settings.enableHandwriting ? "pen-tool" : "keyboard");
      hwBtn.onclick = () => this.tlToggleHandwrite(node, card);
      const delBtn = cardTools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
      setLucideIcon(delBtn, "trash-2");
      delBtn.onclick = () => { this.tlNodes = this.tlNodes.filter((n) => n.id !== node.id); this.tlRenderNodes(); this.tlSaveNodes(); };
      const ta = card.createEl("textarea", { cls: "ef-tl-card-textarea", attr: { placeholder: "输入节点内容..." } });
      ta.value = node.content || "";
      ta.oninput = debounce(() => { node.content = ta.value; this.tlSaveNodes(); }, 600);
      const noteTa = card.createEl("textarea", { cls: "ef-tl-card-note-input", attr: { placeholder: "备注..." } });
      noteTa.value = node.note || "";
      noteTa.oninput = debounce(() => { node.note = noteTa.value; this.tlSaveNodes(); }, 600);
      // 拖拽事件
      row.addEventListener("dragstart", (e) => { this._tlDragId = node.id; row.classList.add("ef-tl-dragging"); e.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragend", () => { row.classList.remove("ef-tl-dragging"); c.querySelectorAll(".ef-tl-node").forEach((n) => n.classList.remove("ef-tl-drag-over")); });
      row.addEventListener("dragover", (e) => { e.preventDefault(); if (this._tlDragId && this._tlDragId !== node.id) row.classList.add("ef-tl-drag-over"); });
      row.addEventListener("dragleave", () => { row.classList.remove("ef-tl-drag-over"); });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("ef-tl-drag-over");
        if (!this._tlDragId || this._tlDragId === node.id) return;
        const fromIdx = this.tlNodes.findIndex((n) => n.id === this._tlDragId);
        const toIdx = this.tlNodes.findIndex((n) => n.id === node.id);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = this.tlNodes.splice(fromIdx, 1);
        this.tlNodes.splice(toIdx, 0, moved);
        this._tlDragId = null;
        this.tlRenderNodes();
        this.tlSaveNodes();
      });
    });
  }

  tlMoveNode(nodeId, dir) {
    const idx = this.tlNodes.findIndex((n) => n.id === nodeId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= this.tlNodes.length) return;
    [this.tlNodes[idx], this.tlNodes[target]] = [this.tlNodes[target], this.tlNodes[idx]];
    this.tlRenderNodes(); this.tlSaveNodes();
  }

  tlToggleHandwrite(node, card) {
    let hw = card.querySelector(".ef-tl-handwrite");
    if (hw) { hw.remove(); return; }
    hw = card.createDiv({ cls: "ef-tl-handwrite" });
    const canvas = hw.createEl("canvas", { cls: "ef-hw-canvas" });
    const ctx = canvas.getContext("2d");
    let drawing = false;
    const strokes = node._strokes || []; node._strokes = strokes;
    const redraw = () => { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.lineWidth = 2 * (window.devicePixelRatio||1); ctx.lineCap = "round"; ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue("--text-normal") || "#333"; for (const s of strokes) { ctx.beginPath(); s.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.stroke(); } };
    setTimeout(() => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = r.width > 0 ? r.width : (card.offsetWidth - 12);
      canvas.width = w * dpr;
      canvas.height = 120 * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = "120px";
      redraw();
    }, 50);
    const getPos = (e) => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; const dpr = window.devicePixelRatio||1; return { x: (t.clientX - r.left) * dpr, y: (t.clientY - r.top) * dpr }; };
    const start = (e) => { e.preventDefault(); drawing = true; strokes.push([getPos(e)]); };
    const move = (e) => { if (!drawing) return; e.preventDefault(); strokes[strokes.length-1].push(getPos(e)); redraw(); };
    const end = () => { drawing = false; };
    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start); canvas.addEventListener("touchmove", move); canvas.addEventListener("touchend", end);
    const tools = hw.createDiv({ cls: "ef-hw-tools" });
    const clrBtn = tools.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(clrBtn, "eraser"); clrBtn.appendText(" 清除");
    clrBtn.onclick = () => { strokes.length = 0; redraw(); };
  }

  tlAddNode() { this.tlNodes.push({ id: uid(), time: this.tlNextTime(), title: "", content: "", note: "" }); this.tlRenderNodes(); this.tlSaveNodes(); }

  /* ---- 灵感库 (读取灵感文件夹下笔记中未勾选的 checkbox) ---- */
  renderInspiration() {
    const c = this.tabBody; c.empty();
    const head = c.createDiv({ cls: "ef-insp-head" });
    const input = head.createEl("input", { cls: "ef-insp-input", attr: { placeholder: "搜索未完成项..." } });
    input.value = this.inspQuery;
    input.oninput = debounce(() => { this.inspQuery = input.value; this.renderInspirationList(); }, 300);
    const newBtn = head.createEl("button", { cls: "mod-cta" });
    setLucideIcon(newBtn, "plus"); newBtn.appendText(" 新建");
    newBtn.onclick = async () => {
      const folder = this.plugin.workflow.getInspirationFolder();
      await this.plugin.workflow.ensureFolder(folder);
      const name = `灵感-${todayStr().slice(5)}-${nowTimeStr().replace(":","")}`;
      const content = `---\nkanban-plugin: board\ntype: edit-flow-inspiration\ncreated: ${todayStr()} ${nowTimeStr()}\ntags:\n  - edit-flow/inspiration\n---\n\n`;
      const f = await this.app.vault.create(`${folder}/${name}.md`, content);
      await this.app.workspace.getLeaf(false).openFile(f);
      this.renderInspirationList();
    };
    this.inspListEl = c.createDiv({ cls: "ef-insp-list" });
    this.renderInspirationList();
  }
  async renderInspirationList() {
    const c = this.inspListEl; if (!c) return; c.empty();
    const folder = this.plugin.workflow.getInspirationFolder();
    const folderObj = this.app.vault.getAbstractFileByPath(folder);
    let files = [];
    const collect = (f) => {
      if (f instanceof TFile && f.extension === "md") files.push(f);
      else if (f instanceof TFolder) for (const child of f.children) collect(child);
    };
    if (folderObj instanceof TFolder) collect(folderObj);
    // 收集所有未勾选 checkbox 项
    const items = [];
    for (const f of files) {
      const text = await this.app.vault.read(f);
      const lines = text.split("\n");
      for (const line of lines) {
        const m = line.match(/^\s*- \[ \] (.+)$/);
        if (m && m[1].trim()) items.push({ file: f, text: m[1].trim() });
      }
    }
    const q = this.inspQuery.trim().toLowerCase();
    const filtered = q
      ? items.filter((it) => it.text.toLowerCase().includes(q) || it.file.basename.toLowerCase().includes(q))
      : items;
    c.createDiv({ cls: "ef-muted" }).textContent = `共 ${filtered.length} 项未完成 · 来自 ${files.length} 个笔记`;
    if (filtered.length === 0) {
      c.createDiv({ cls: "ef-empty-state" }).createEl("p", { cls: "ef-muted" }).textContent = "暂无未完成项, 点击\"新建\"创建笔记";
      return;
    }
    for (const it of filtered) {
      const row = c.createDiv({ cls: "ef-insp-row" });
      const ic = row.createDiv({ cls: "ef-insp-row-icon" }); setLucideIcon(ic, "circle");
      const nameEl = row.createDiv({ cls: "ef-insp-row-name" });
      nameEl.textContent = it.text;
      nameEl.onclick = async () => await this.app.workspace.getLeaf(false).openFile(it.file);
      row.createDiv({ cls: "ef-muted ef-insp-row-path" }).textContent = it.file.basename;
    }
  }

  /* ---- 便签列表 (从便签文件夹读取) ---- */
  async renderStickyList() {
    const c = this.tabBody; c.empty();
    const notes = await this.plugin.loadStickyNotes();
    if (notes.length === 0) { c.createDiv({ cls: "ef-empty-state" }).createEl("p", { cls: "ef-muted" }).textContent = "暂无便签, 上方按钮新建"; return; }
    const grid = c.createDiv({ cls: "ef-sticky-cards" });
    for (const note of notes) {
      const card = grid.createDiv({ cls: "ef-sticky-card", attr: { style: `background:${note.color || MORANDI_LIST[0]}` } });
      const head = card.createDiv({ cls: "ef-sticky-card-head" });
      head.createDiv({ cls: "ef-sticky-card-title" }).textContent = note.title || "便签";
      const tools = head.createDiv({ cls: "ef-sticky-card-tools" });
      const floatBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
      setLucideIcon(floatBtn, "external-link"); floatBtn.title = "浮窗打开";
      floatBtn.onclick = () => this.plugin.openStickyNote(note);
      const delBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
      setLucideIcon(delBtn, "trash-2"); delBtn.title = "删除便签";
      delBtn.onclick = async () => { if (confirm(`删除便签 "${note.title || "便签"}"?`)) { await this.plugin.deleteStickyMd(note.id); this.renderStickyList(); } };
      const body = card.createDiv({ cls: "ef-sticky-card-body" });
      const preview = (note.content || "").slice(0, 80);
      body.textContent = preview + ((note.content || "").length > 80 ? "..." : "");
      card.onclick = (e) => { if (!e.target.closest("button")) this.plugin.openStickyNote(note); };
    }
  }

  /* ---- 素材库 ---- */
  // 素材文件夹下的所有文件都作为素材 (含子文件夹)
  async renderMaterial() {
    const c = this.tabBody; c.empty();
    const head = c.createDiv({ cls: "ef-insp-head" });
    head.createEl("span", { cls: "ef-muted" }).textContent = "素材库";
    const refreshBtn = head.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(refreshBtn, "refresh-cw"); refreshBtn.title = "刷新";
    refreshBtn.onclick = () => this.renderMaterial();
    const openBtn = head.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(openBtn, "folder"); openBtn.appendText(" 打开文件夹");
    openBtn.onclick = async () => {
      const root = this.plugin.settings.rootFolder;
      const matFolder = `${root}/${this.plugin.settings.materialFolder}`;
      await this.plugin.workflow.ensureFolder(matFolder);
      const folder = this.app.vault.getAbstractFileByPath(matFolder);
      if (folder) await this.app.workspace.getLeaf(false).openFile(folder);
      else new Notice("文件夹已创建");
    };
    this.matListEl = c.createDiv({ cls: "ef-insp-list" });
    await this.renderMaterialList();
  }
  async renderMaterialList() {
    const c = this.matListEl; if (!c) return; c.empty();
    const root = this.plugin.settings.rootFolder;
    const matFolder = `${root}/${this.plugin.settings.materialFolder}`;
    const folder = this.app.vault.getAbstractFileByPath(matFolder);
    // 递归收集素材文件夹下所有文件 (含子文件夹)
    let files = [];
    const collect = (f) => {
      if (f instanceof TFile) files.push(f);
      else if (f instanceof TFolder) for (const child of f.children) collect(child);
    };
    if (folder instanceof TFolder) collect(folder);
    c.createDiv({ cls: "ef-muted" }).textContent = `共 ${files.length} 个素材`;
    if (files.length === 0) {
      const empty = c.createDiv({ cls: "ef-empty-sm ef-muted" });
      empty.textContent = "素材库为空, 直接把素材文件放进素材文件夹即可";
      return;
    }
    // 按修改时间倒序
    files.sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));
    for (const f of files) {
      const row = c.createDiv({ cls: "ef-insp-row" });
      const ic = row.createDiv({ cls: "ef-insp-row-icon" });
      const ext = f.extension?.toLowerCase();
      if (ext === "md") setLucideIcon(ic, "file-text");
      else if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) setLucideIcon(ic, "image");
      else if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) setLucideIcon(ic, "video");
      else if (["mp3", "wav", "flac", "aac", "m4a"].includes(ext)) setLucideIcon(ic, "music");
      else if (ext === "lrc") setLucideIcon(ic, "music");
      else if (ext === "txt") setLucideIcon(ic, "file-text");
      else setLucideIcon(ic, "file");
      const nameEl = row.createDiv({ cls: "ef-insp-row-name" });
      // 显示相对素材文件夹的路径
      const relPath = f.path.startsWith(matFolder + "/") ? f.path.slice(matFolder.length + 1) : f.name;
      nameEl.textContent = relPath;
      nameEl.title = f.path;
      nameEl.onclick = async () => {
        if (f.extension === "md") { await this.app.workspace.getLeaf(false).openFile(f); }
        else if (f.extension === "txt" || f.extension === "lrc") { await this.previewTextFile(f); }
        else this.app.workspace.getLeaf(false).openLinkText(f.path, "", false);
      };
    }
  }

  // 预览 txt / lrc 歌词文件
  async previewTextFile(f) {
    const modal = new Modal(this.app);
    modal.titleEl.textContent = f.name;
    modal.modalEl.style.maxWidth = "700px";
    modal.modalEl.style.maxHeight = "80vh";
    const content = await this.app.vault.read(f);
    let displayText = content;
    if (f.extension === "lrc") {
      // 歌词文件: 去掉时间标签 [mm:ss.xxx] 方便阅读
      displayText = content.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, "").trim();
    }
    const body = modal.contentEl.createDiv({ cls: "ef-text-preview" });
    body.textContent = displayText;
    // 工具栏: 复制按钮
    const toolbar = modal.contentEl.createDiv({ cls: "ef-text-preview-toolbar" });
    const copyBtn = toolbar.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(copyBtn, "copy"); copyBtn.appendText(" 复制全文");
    copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(displayText); new Notice("已复制到剪贴板"); }
      catch (e) {
        // 兜底: 选中文字方式
        const range = document.createRange(); range.selectNode(body);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        try { document.execCommand("copy"); new Notice("已复制"); } catch (e2) { new Notice("复制失败, 请手动选中文字"); }
      }
    };
    // lrc 额外: 复制带时间标签的原文
    if (f.extension === "lrc") {
      const copyRawBtn = toolbar.createEl("button", { cls: "ef-btn ef-btn-sm" });
      setLucideIcon(copyRawBtn, "clock"); copyRawBtn.appendText(" 复制原格式");
      copyRawBtn.onclick = async () => {
        try { await navigator.clipboard.writeText(content); new Notice("已复制原格式歌词"); }
        catch (e) { new Notice("复制失败, 请手动选中"); }
      };
    }
    modal.open();
  }
}

/* =========================================================================
 *  导航页面 (主视图) - 按主分类显示子类
 * ========================================================================= */

class NavigationView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.filter = "all"; this.audienceFilter = ""; this.searchQuery = ""; this.weekStart = this.getWeekStart(new Date()); this.calView = "week"; this.calMonth = new Date(); }
  getViewType() { return VIEW_NAVIGATION; }
  getDisplayText() { return "Edit Flow · 导航"; }
  getIcon() { return "film"; }
  async onOpen() {
    // 监听文件变化, 自动同步作品索引 + 刷新视图
    this.registerEvent(this.app.workspace.on("file-open", () => this.draw()));
    const debouncedDraw = debounce(() => { this.plugin.workflow.syncWorkIndex(); this.draw(); }, 300);
    this.registerEvent(this.app.vault.on("create", debouncedDraw));
    this.registerEvent(this.app.vault.on("delete", debouncedDraw));
    this.registerEvent(this.app.vault.on("rename", debouncedDraw));
    this.registerEvent(this.app.vault.on("modify", debouncedDraw));
    // 首次打开先同步作品索引
    await this.plugin.workflow.syncWorkIndex();
    this.draw();
  }

  async refresh() {
    await this.plugin.workflow.syncWorkIndex();
    this.draw();
    new Notice("已刷新");
  }

  getWeekStart(d) {
    const date = new Date(d); const day = date.getDay() || 7; // 周日=7
    date.setDate(date.getDate() - day + 1); date.setHours(0,0,0,0); return date;
  }
  formatDate(d) { const p = (n) => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
  formatShort(d) { const p = (n) => String(n).padStart(2,"0"); return `${p(d.getMonth()+1)}/${p(d.getDate())}`; }
  isToday(d) { return this.formatDate(d) === this.formatDate(new Date()); }

  draw() {
    const c = this.contentEl; c.empty(); c.addClass("ef-navigation");
    const hero = c.createDiv({ cls: "ef-nav-hero" });
    const hc = hero.createDiv({ cls: "ef-nav-hero-content" });
    hc.createEl("h1").textContent = "Edit Flow";
    hc.createEl("p", { cls: "ef-nav-sub" }).textContent = "一体化媒体作品发布工作流";
    const ha = hero.createDiv({ cls: "ef-nav-hero-actions" });
    const newBtn = ha.createEl("button", { cls: "mod-cta" });
    setLucideIcon(newBtn, "plus"); newBtn.appendText(" 新建作品");
    newBtn.onclick = () => new CreateWorkModal(this.app, this.plugin, () => this.draw()).open();
    const refreshBtn = ha.createEl("button", { cls: "ef-btn ef-btn-icon" });
    setLucideIcon(refreshBtn, "refresh-cw"); refreshBtn.title = "刷新";
    refreshBtn.onclick = () => this.refresh();
    const dashBtn = ha.createEl("button");
    setLucideIcon(dashBtn, "clapperboard"); dashBtn.appendText(" 看板");
    dashBtn.onclick = () => this.plugin.activateDashboard();
    const toolsBtn = ha.createEl("button");
    setLucideIcon(toolsBtn, "scissors"); toolsBtn.appendText(" 功能区");
    toolsBtn.onclick = () => this.plugin.activateTools();

    const works = this.plugin.workflow.listWorks();

    // 统计卡片
    const stats = c.createDiv({ cls: "ef-nav-stats" });
    const todayStr2 = this.formatDate(new Date());
    // 今日待办 = 今日排期表里要制作+发布的类型数
    const todayWeekday = new Date().getDay() || 7; // 周日=7
    const todaySched = this.plugin.workflow.getWeeklySchedule().find((d) => d.day === todayWeekday);
    const todayTodoCount = (todaySched ? todaySched.makeTypes.length + todaySched.publishTypes.length : 0);
    const pendingCount = works.filter((w) => w.progress === "planning" || w.progress === "in-progress").length;
    const statItems = [
      { label: "作品总数", value: works.length, icon: "film" },
      { label: "今日排期", value: todayTodoCount, icon: "calendar-check" },
      { label: "进行中", value: pendingCount, icon: "loader" },
      { label: "已发布", value: works.filter((w) => w.progress === "published").length, icon: "check-circle" },
    ];
    for (const s of statItems) {
      const card = stats.createDiv({ cls: "ef-nav-stat-card" });
      const ic = card.createDiv({ cls: "ef-nav-stat-icon" }); setLucideIcon(ic, s.icon);
      card.createDiv({ cls: "ef-nav-stat-value" }).textContent = s.value;
      card.createDiv({ cls: "ef-nav-stat-label" }).textContent = s.label;
    }

    // 今日排期 (来自每周排期表, 非单作品日期)
    if (todaySched && (todaySched.makeTypes.length || todaySched.publishTypes.length)) {
      const todayWrap = c.createDiv({ cls: "ef-nav-today" });
      todayWrap.createDiv({ cls: "ef-nav-section-title" }).textContent = `今日排期 · ${todaySched.name}`;
      const todayList = todayWrap.createDiv({ cls: "ef-today-list" });
      if (todaySched.makeTypes.length) {
        const row = todayList.createDiv({ cls: "ef-today-row ef-today-row-types" });
        setLucideIcon(row.createSpan({ cls: "ef-today-tag-ic" }), "hammer");
        row.createDiv({ cls: "ef-today-tag-label" }).textContent = "制作";
        const chips = row.createDiv({ cls: "ef-today-chips" });
        for (const sid of todaySched.makeTypes) {
          const st = this.plugin.workflow.getSubTypeById(sid);
          if (st) chips.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
        }
      }
      if (todaySched.publishTypes.length) {
        const row = todayList.createDiv({ cls: "ef-today-row ef-today-row-types" });
        setLucideIcon(row.createSpan({ cls: "ef-today-tag-ic" }), "send");
        row.createDiv({ cls: "ef-today-tag-label" }).textContent = "发布";
        const chips = row.createDiv({ cls: "ef-today-chips" });
        for (const sid of todaySched.publishTypes) {
          const st = this.plugin.workflow.getSubTypeById(sid);
          if (st) chips.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
        }
      }
    }

    // 每周排期表 (全局模板)
    this.renderWeeklySchedule(c);

    // 发布日历 (按作品 publishDate 显示)
    this.renderCalendar(c, works);

    // 作品类型 - 紧凑横向 chip 布局
    const typesWrap = c.createDiv({ cls: "ef-nav-section" });
    typesWrap.createDiv({ cls: "ef-nav-section-title" }).textContent = "作品分类";
    for (const cat of this.plugin.settings.mainCategories) {
      const catRow = typesWrap.createDiv({ cls: "ef-cat-compact" });
      const catHead = catRow.createDiv({ cls: "ef-cat-compact-head", attr: { style: `background:${cat.color}` } });
      const ic = catHead.createSpan({ cls: "ef-cat-compact-icon" });
      setLucideIcon(ic, cat.icon);
      catHead.createSpan({ cls: "ef-cat-compact-name" }).textContent = cat.name;
      const addSubBtn = catHead.createEl("button", { cls: "ef-btn ef-btn-sm ef-cat-add-btn" });
      setLucideIcon(addSubBtn, "plus"); addSubBtn.title = "添加子类";
      addSubBtn.onclick = (e) => { e.stopPropagation(); new AddSubTypeModal(this.app, this.plugin, cat.id, () => this.draw()).open(); };
      const chips = catRow.createDiv({ cls: "ef-cat-chips" });
      const subs = this.plugin.settings.subTypes[cat.id] || [];
      for (const st of subs) {
        const chip = chips.createDiv({ cls: "ef-chip", attr: { style: `--accent:${st.color}` } });
        const sic = chip.createSpan({ cls: "ef-chip-icon" });
        setLucideIcon(sic, st.icon);
        chip.createSpan({ cls: "ef-chip-name" }).textContent = st.name;
        const delBtn = chip.createEl("button", { cls: "ef-chip-del" });
        setLucideIcon(delBtn, "x"); delBtn.title = "删除子类";
        delBtn.onclick = async (e) => { e.stopPropagation(); if (confirm(`删除子类 "${st.name}"? 作品文件不会删除。`)) { await this.plugin.templates.removeSubType(cat.id, st.id); this.draw(); } };
        chip.onclick = (e) => { if (!e.target.closest("button")) new CreateWorkModal(this.app, this.plugin, { preMain: cat.id, preSub: st.id, onCreated: () => this.draw() }).open(); };
      }
      const addChip = chips.createDiv({ cls: "ef-chip ef-chip-add" });
      setLucideIcon(addChip.createSpan({ cls: "ef-chip-icon" }), "plus");
      addChip.createSpan({ cls: "ef-chip-name" }).textContent = "添加子类";
      addChip.onclick = () => new AddSubTypeModal(this.app, this.plugin, cat.id, () => this.draw()).open();
    }
    const addCatBtn = typesWrap.createEl("button", { cls: "mod-cta ef-add-cat-btn" });
    setLucideIcon(addCatBtn, "plus"); addCatBtn.appendText(" 添加主分类");
    addCatBtn.onclick = () => new AddMainCategoryModal(this.app, this.plugin, () => this.draw()).open();

    // 作品对象 (chip 布局, 点击筛选对应作品)
    const auds = this.plugin.settings.audiences || [];
    const audWrap = c.createDiv({ cls: "ef-nav-section" });
    const audHead = audWrap.createDiv({ cls: "ef-weekly-head" });
    audHead.createDiv({ cls: "ef-nav-section-title" }).textContent = "作品对象";
    const audManageBtn = audHead.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(audManageBtn, "settings"); audManageBtn.appendText(" 管理");
    audManageBtn.onclick = () => new AudiencesModal(this.app, this.plugin, () => this.draw()).open();
    const audChips = audWrap.createDiv({ cls: "ef-cat-chips" });
    if (auds.length === 0) {
      audChips.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "还没有对象, 点击右上角「管理」添加。";
    }
    for (const aud of auds) {
      const count = this.plugin.workflow.getWorksByAudience(aud.id).length;
      const chip = audChips.createDiv({ cls: "ef-chip" + (this.audienceFilter === aud.id ? " is-active" : ""), attr: { style: `--accent:${aud.color || MORANDI.blue}` } });
      const ic = chip.createSpan({ cls: "ef-chip-icon" });
      setLucideIcon(ic, "users");
      chip.createSpan({ cls: "ef-chip-name" }).textContent = aud.name;
      const cnt = chip.createSpan({ cls: "ef-chip-count" }); cnt.textContent = String(count);
      chip.title = `点击筛选「${aud.name}」下的作品`;
      chip.onclick = (e) => {
        if (e.target.closest("button")) return;
        this.audienceFilter = this.audienceFilter === aud.id ? "" : aud.id;
        this.draw();
      };
    }

    // 工作流 (脚本走侧边栏时间线, 发布走发布管理弹窗, 不在此创建)
    const flowWrap = c.createDiv({ cls: "ef-nav-section" });
    flowWrap.createDiv({ cls: "ef-nav-section-title" }).textContent = "工作流";
    const flowBar = flowWrap.createDiv({ cls: "ef-flow-bar" });
    const flowStages = STAGES.filter((s) => s.id !== "publish" && s.id !== "script");
    flowStages.forEach((s, i) => {
      const step = flowBar.createDiv({ cls: "ef-flow-step" });
      const dot = step.createDiv({ cls: "ef-flow-dot" }); setLucideIcon(dot, s.icon);
      step.createDiv({ cls: "ef-flow-name" }).textContent = s.name;
      step.onclick = () => new CreateWorkModal(this.app, this.plugin, { preStage: s.id, onCreated: () => this.draw() }).open();
      if (i < flowStages.length - 1) flowBar.createDiv({ cls: "ef-flow-arrow" });
    });

    // 作品列表 + 搜索
    const listWrap = c.createDiv({ cls: "ef-nav-section" });
    const listHead = listWrap.createDiv({ cls: "ef-nav-list-head" });
    const listTitle = listHead.createDiv({ cls: "ef-nav-section-title" });
    let titleText = "我的作品";
    if (this.audienceFilter) {
      const aud = this.plugin.workflow.getAudience(this.audienceFilter);
      titleText = aud ? `${aud.name} · 作品` : "我的作品";
    }
    listTitle.textContent = titleText;
    const controls = listHead.createDiv({ cls: "ef-nav-list-controls" });
    // 对象筛选清除按钮 (仅当按对象筛选时显示)
    if (this.audienceFilter) {
      const clrBtn = controls.createEl("button", { cls: "ef-btn ef-btn-sm ef-aud-clear" });
      setLucideIcon(clrBtn, "x"); clrBtn.appendText(" 清除筛选");
      clrBtn.onclick = () => { this.audienceFilter = ""; this.draw(); };
    }
    const searchInput = controls.createEl("input", { cls: "ef-search-input", attr: { placeholder: "搜索作品..." } });
    searchInput.value = this.searchQuery;
    searchInput.oninput = debounce(() => { this.searchQuery = searchInput.value; this.renderWorksList(listBody); }, 250);
    const filterSel = controls.createEl("select", { cls: "ef-filter-sel" });
    filterSel.createEl("option", { attr: { value: "all" } }).textContent = "全部";
    for (const cat of this.plugin.settings.mainCategories) filterSel.createEl("option", { attr: { value: cat.id } }).textContent = cat.name;
    filterSel.value = this.filter;
    filterSel.onchange = () => { this.filter = filterSel.value; this.renderWorksList(listBody); };
    const listBody = listWrap.createDiv({ cls: "ef-works-list" });
    this.renderWorksList(listBody);
  }

  // 每周排期表 (全局模板: 周几做什么类型 + 发什么类型)
  renderWeeklySchedule(c) {
    const wrap = c.createDiv({ cls: "ef-nav-section ef-weekly-sched" });
    const head = wrap.createDiv({ cls: "ef-weekly-head" });
    head.createDiv({ cls: "ef-nav-section-title" }).textContent = "每周排期表";
    const editBtn = head.createEl("button", { cls: "ef-btn ef-btn-sm" });
    setLucideIcon(editBtn, "pencil"); editBtn.appendText(" 编辑排期");
    editBtn.onclick = () => new WeeklyScheduleModal(this.app, this.plugin, () => this.draw()).open();
    const ws = this.plugin.workflow.getWeeklySchedule();
    const grid = wrap.createDiv({ cls: "ef-weekly-grid" });
    for (const d of ws) {
      const isToday = d.day === (new Date().getDay() || 7);
      const col = grid.createDiv({ cls: "ef-weekly-col" + (isToday ? " is-today" : "") });
      const colHead = col.createDiv({ cls: "ef-weekly-col-head" });
      colHead.createDiv({ cls: "ef-weekly-day-name" }).textContent = d.name;
      const body = col.createDiv({ cls: "ef-weekly-col-body" });
      const mkWrap = body.createDiv({ cls: "ef-weekly-types ef-weekly-make" });
      mkWrap.createDiv({ cls: "ef-weekly-types-label" }).textContent = "制作";
      if (d.makeTypes.length === 0) mkWrap.createDiv({ cls: "ef-muted ef-weekly-empty" }).textContent = "—";
      for (const sid of d.makeTypes) {
        const st = this.plugin.workflow.getSubTypeById(sid);
        if (st) mkWrap.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
      }
      const pbWrap = body.createDiv({ cls: "ef-weekly-types ef-weekly-publish" });
      pbWrap.createDiv({ cls: "ef-weekly-types-label" }).textContent = "发布";
      if (d.publishTypes.length === 0) pbWrap.createDiv({ cls: "ef-muted ef-weekly-empty" }).textContent = "—";
      for (const sid of d.publishTypes) {
        const st = this.plugin.workflow.getSubTypeById(sid);
        if (st) pbWrap.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
      }
    }
  }

  // 发布日历 (周/月可切换, 只按作品 publishDate 显示)
  renderCalendar(c, works) {
    const wrap = c.createDiv({ cls: "ef-nav-section ef-cal-section" });
    const head = wrap.createDiv({ cls: "ef-cal-head" });
    head.createDiv({ cls: "ef-nav-section-title" }).textContent = "发布日历";
    const nav = head.createDiv({ cls: "ef-cal-nav" });
    // 视图切换
    const viewToggle = nav.createDiv({ cls: "ef-cal-toggle" });
    const weekBtn = viewToggle.createEl("button", { cls: "ef-btn ef-btn-sm" + (this.calView === "week" ? " is-active" : "") });
    weekBtn.appendText("周");
    weekBtn.onclick = () => { this.calView = "week"; this.draw(); };
    const monthBtn = viewToggle.createEl("button", { cls: "ef-btn ef-btn-sm" + (this.calView === "month" ? " is-active" : "") });
    monthBtn.appendText("月");
    monthBtn.onclick = () => { this.calView = "month"; this.draw(); };
    // 前后导航
    const prevBtn = nav.createEl("button", { cls: "ef-btn ef-btn-icon" });
    setLucideIcon(prevBtn, "chevron-left");
    prevBtn.onclick = () => { if (this.calView === "week") this.weekStart.setDate(this.weekStart.getDate() - 7); else this.calMonth.setMonth(this.calMonth.getMonth() - 1); this.draw(); };
    const labelEl = nav.createDiv({ cls: "ef-cal-week-label" });
    const todayBtn = nav.createEl("button", { cls: "ef-btn ef-btn-sm" });
    todayBtn.appendText("今天");
    todayBtn.onclick = () => { this.weekStart = this.getWeekStart(new Date()); this.calMonth = new Date(); this.draw(); };
    const nextBtn = nav.createEl("button", { cls: "ef-btn ef-btn-icon" });
    setLucideIcon(nextBtn, "chevron-right");
    nextBtn.onclick = () => { if (this.calView === "week") this.weekStart.setDate(this.weekStart.getDate() + 7); else this.calMonth.setMonth(this.calMonth.getMonth() + 1); this.draw(); };

    if (this.calView === "week") {
      const weekEnd = new Date(this.weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      labelEl.textContent = `${this.formatShort(this.weekStart)} - ${this.formatShort(weekEnd)}`;
      this.renderWeekGrid(wrap, works);
    } else {
      const y = this.calMonth.getFullYear(), m = this.calMonth.getMonth();
      labelEl.textContent = `${y}年${m+1}月`;
      this.renderMonthGrid(wrap, works, y, m);
    }
  }

  renderWeekGrid(wrap, works) {
    const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    const grid = wrap.createDiv({ cls: "ef-cal-grid ef-cal-week" });
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(this.weekStart); dayDate.setDate(dayDate.getDate() + i);
      this.renderDayCol(grid, dayDate, dayNames[i], works);
    }
  }

  renderMonthGrid(wrap, works, y, m) {
    const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
    const firstDay = new Date(y, m, 1);
    const startDay = (firstDay.getDay() || 7) - 1; // 周一=0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayFmt = this.formatDate(new Date());
    const grid = wrap.createDiv({ cls: "ef-cal-grid ef-cal-month" });
    // 表头
    for (const dn of dayNames) { const h = grid.createDiv({ cls: "ef-cal-mo-head" }); h.textContent = dn; }
    // 上月补齐
    const prevMonthDays = new Date(y, m, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      const d = new Date(y, m - 1, prevMonthDays - i);
      const col = grid.createDiv({ cls: "ef-cal-col ef-cal-mo-other" });
      this.renderDayColContent(col, d, works, true);
    }
    // 本月
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      const col = grid.createDiv({ cls: "ef-cal-col" + (this.formatDate(date) === todayFmt ? " is-today" : "") });
      this.renderDayColContent(col, date, works, false);
    }
    // 下月补齐到填满最后一行
    const total = startDay + daysInMonth;
    const tail = (7 - (total % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
      const d = new Date(y, m + 1, i);
      const col = grid.createDiv({ cls: "ef-cal-col ef-cal-mo-other" });
      this.renderDayColContent(col, d, works, true);
    }
  }

  renderDayCol(parent, dayDate, dayName, works) {
    const dateStr = this.formatDate(dayDate);
    const isToday = this.isToday(dayDate);
    const col = parent.createDiv({ cls: "ef-cal-col" + (isToday ? " is-today" : "") });
    const colHead = col.createDiv({ cls: "ef-cal-col-head" });
    colHead.createDiv({ cls: "ef-cal-day-name" }).textContent = dayName;
    colHead.createDiv({ cls: "ef-cal-day-date" }).textContent = `${dayDate.getMonth()+1}/${dayDate.getDate()}`;
    const colBody = col.createDiv({ cls: "ef-cal-col-body" });
    this.renderDayCards(colBody, dateStr, works);
  }

  renderDayColContent(col, dayDate, works, isOther) {
    const dateStr = this.formatDate(dayDate);
    const colHead = col.createDiv({ cls: "ef-cal-col-head ef-cal-mo-head-cell" });
    colHead.createDiv({ cls: "ef-cal-day-date" }).textContent = dayDate.getDate();
    const colBody = col.createDiv({ cls: "ef-cal-col-body" });
    this.renderDayCards(colBody, dateStr, works);
  }

  // 渲染某天的卡片 (显示发布时间 + 状态, 排期表在每周排期表区单独展示)
  renderDayCards(colBody, dateStr, works) {
    const published = works.filter((w) => w.publishDate === dateStr);
    for (const w of published) {
      const st = this.plugin.workflow.getSubType(w.mainCategory, w.subType);
      const wStatus = getWorkStatus(w.progress);
      const card = colBody.createDiv({ cls: "ef-cal-card ef-cal-publish" });
      // 左边框用状态颜色, 直观体现进度
      card.style.borderLeftColor = wStatus.color;
      const headRow = card.createDiv({ cls: "ef-cal-card-head-row" });
      if (st) headRow.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
      // 状态标签 (可点击修改)
      const statusTag = headRow.createSpan({ cls: "ef-cal-status-tag", attr: { style: `background:${wStatus.color}55` } });
      setLucideIcon(statusTag.createSpan(), wStatus.icon);
      statusTag.appendText(wStatus.name);
      statusTag.title = "点击修改状态";
      statusTag.onclick = (e) => { e.stopPropagation(); new ChangeWorkStatusModal(this.app, this.plugin, w, () => this.draw()).open(); };
      card.createDiv({ cls: "ef-cal-card-name" }).textContent = w.name;
      card.title = "发布时间: " + dateStr;
      card.onclick = async () => { const f = this.app.vault.getAbstractFileByPath(w.path); if (f && f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); };
    }
  }

  renderWorksList(container) {
    container.empty();
    let works = this.plugin.workflow.listWorks();
    if (this.filter !== "all") works = works.filter((w) => w.mainCategory === this.filter);
    if (this.audienceFilter) works = works.filter((w) => w.audience === this.audienceFilter);
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      works = works.filter((w) => w.name.toLowerCase().includes(q));
    }
    if (works.length === 0) { container.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = this.searchQuery ? "未找到匹配作品" : "暂无作品"; return; }
    works.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    for (const w of works) {
      const cat = this.plugin.workflow.getMainCategory(w.mainCategory);
      const st = this.plugin.workflow.getSubType(w.mainCategory, w.subType);
      const wAud = w.audience ? this.plugin.workflow.getAudience(w.audience) : null;
      const row = container.createDiv({ cls: "ef-work-row" });
      if (st) row.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
      const nameEl = row.createDiv({ cls: "ef-work-name" });
      nameEl.textContent = w.name;
      nameEl.onclick = async () => { const f = this.app.vault.getAbstractFileByPath(w.path); if (f && f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); };
      // 作品对象标签 (可点击切换该对象筛选)
      if (wAud) {
        const audTag = row.createDiv({ cls: "ef-work-audience", attr: { style: `background:${wAud.color || MORANDI.blue}33;color:${wAud.color || MORANDI.blue}` } });
        setLucideIcon(audTag.createSpan({ cls: "ef-work-stage-ic" }), "users");
        audTag.appendText(wAud.name);
        audTag.title = "点击筛选该对象的作品";
        audTag.onclick = (e) => { e.stopPropagation(); this.audienceFilter = wAud.id; this.draw(); };
      }
      // 发布时间标记 (发送图标, 可点击设置; 与排期表分开)
      const pubBtn = row.createDiv({ cls: "ef-work-pubdate" + (w.publishDate ? "" : " is-empty") });
      setLucideIcon(pubBtn.createSpan(), "send");
      if (w.publishDate) { pubBtn.appendText(" " + w.publishDate.slice(5)); pubBtn.title = "发布时间: " + w.publishDate; }
      else { pubBtn.title = "点击设置发布时间"; }
      pubBtn.onclick = () => new PublishWorkModal(this.app, this.plugin, w, () => this.renderWorksList(container)).open();
      if (cat) row.createDiv({ cls: "ef-work-cat" }).textContent = cat.name;
      // 进度状态标签 (可点击修改)
      const wStatus = getWorkStatus(w.progress);
      const statusEl = row.createDiv({ cls: "ef-work-stage", attr: { style: `background:${wStatus.color}66` } });
      setLucideIcon(statusEl.createSpan({ cls: "ef-work-stage-ic" }), wStatus.icon);
      statusEl.appendText(wStatus.name);
      statusEl.title = "点击修改状态";
      statusEl.onclick = (e) => { e.stopPropagation(); new ChangeWorkStatusModal(this.app, this.plugin, w, () => this.renderWorksList(container)).open(); };
      row.createDiv({ cls: "ef-work-date" }).textContent = (w.updated || w.created || "").slice(0,10);
    }
  }
}

/* =========================================================================
 *  悬浮便签 (非 Modal, 用 document.body 浮层 - 可编辑背景)
 * ========================================================================= */

class StickyFloatView {
  constructor(plugin, note) {
    this.plugin = plugin;
    this.note = note || { id: uid(), title: "便签", content: "", color: MORANDI_LIST[0], x: 200, y: 200, w: 260, h: 240 };
    this.el = null;
  }

  show() {
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "ef-sticky-float";
    el.style.background = this.note.color;
    el.style.left = (this.note.x || 200) + "px";
    el.style.top = (this.note.y || 200) + "px";
    el.style.width = (this.note.w || 260) + "px";
    el.style.height = (this.note.h || 240) + "px";

    // 标题栏 (最顶部)
    const head = el.createDiv({ cls: "ef-sticky-head" });
    const dragHandle = head.createDiv({ cls: "ef-sticky-drag" });
    setLucideIcon(dragHandle, "move");
    const titleInput = head.createEl("input", { cls: "ef-sticky-title", type: "text", value: this.note.title, placeholder: "标题" });
    titleInput.addEventListener("mousedown", (e) => e.stopPropagation());
    titleInput.oninput = () => { this.note.title = titleInput.value; this.save(); };
    const tools = head.createDiv({ cls: "ef-sticky-tools" });
    const colorBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
    setLucideIcon(colorBtn, "palette"); colorBtn.title = "换色";
    colorBtn.onclick = () => {
      const idx = MORANDI_LIST.indexOf(this.note.color);
      this.note.color = MORANDI_LIST[(idx + 1) % MORANDI_LIST.length];
      el.style.background = this.note.color;
      this.save();
    };
    const dockBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
    setLucideIcon(dockBtn, "panel-right"); dockBtn.title = "停靠到侧边栏";
    dockBtn.onclick = () => { this.close(); this.plugin.dockStickyNote(this.note); };
    const closeBtn = tools.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
    setLucideIcon(closeBtn, "x"); closeBtn.title = "关闭";
    closeBtn.onclick = () => this.close();

    // 内容区
    const body = el.createDiv({ cls: "ef-sticky-body" });
    const ta = body.createEl("textarea", { cls: "ef-sticky-textarea", placeholder: "随手记下想法..." });
    ta.value = this.note.content || "";
    ta.oninput = debounce(() => { this.note.content = ta.value; this.save(); }, 400);
    setTimeout(() => ta.focus(), 50);

    // 调整大小手柄
    const resize = el.createDiv({ cls: "ef-sticky-resize" });

    // 拖拽 (整个 head 触发, 但 input/button 内部 stopPropagation)
    let dragging = false, offX = 0, offY = 0;
    head.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.closest("button")) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      offX = e.clientX - rect.left; offY = e.clientY - rect.top;
      e.preventDefault();
    });
    const moveHandler = (e) => { if (!dragging) return; el.style.left = (e.clientX - offX) + "px"; el.style.top = (e.clientY - offY) + "px"; };
    const upHandler = () => { if (dragging) { dragging = false; this.note.x = parseInt(el.style.left); this.note.y = parseInt(el.style.top); this.save(); } };
    document.addEventListener("mousemove", moveHandler);
    document.addEventListener("mouseup", upHandler);

    // 调整大小
    let rDrag = false, rSX = 0, rSY = 0, rSW = 0, rSH = 0;
    resize.addEventListener("mousedown", (e) => { rDrag = true; rSX = e.clientX; rSY = e.clientY; rSW = el.offsetWidth; rSH = el.offsetHeight; e.preventDefault(); e.stopPropagation(); });
    const rMove = (e) => { if (!rDrag) return; el.style.width = Math.max(180, rSW + e.clientX - rSX) + "px"; el.style.height = Math.max(120, rSH + e.clientY - rSY) + "px"; };
    const rUp = () => { if (rDrag) { rDrag = false; this.note.w = el.offsetWidth; this.note.h = el.offsetHeight; this.save(); } };
    document.addEventListener("mousemove", rMove);
    document.addEventListener("mouseup", rUp);

    document.body.appendChild(el);
    this.el = el;
    this._cleanup = () => {
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("mouseup", upHandler);
      document.removeEventListener("mousemove", rMove);
      document.removeEventListener("mouseup", rUp);
    };
    // 打开即保存 (新建便签即使不输入也会保留)
    this.save();
  }

  close() {
    if (this.el) { this.el.remove(); this.el = null; }
    if (this._cleanup) this._cleanup();
    this.plugin._stickyFloats = (this.plugin._stickyFloats || []).filter((v) => v !== this);
  }

  save() {
    // 保存到根目录下的便签文件夹 (每个便签一个 md 文件)
    this.plugin.saveStickyToMd(this.note);
  }
}

/* =========================================================================
 *  Modals
 * ========================================================================= */

class CreateWorkModal extends Modal {
  constructor(app, plugin, opts = {}) {
    super(app); this.plugin = plugin;
    this.main = opts.preMain; this.sub = opts.preSub; this.stage = opts.preStage || "inspiration"; this.title = "";
    this.stageContent = "";
    this.audience = "";
    this.onCreated = opts.onCreated || (() => {});
  }
  onOpen() {
    const c = this.contentEl; c.empty();
    c.createEl("h2").textContent = "新建作品";
    // 无主分类时提示去设置页添加
    if (!this.plugin.settings.mainCategories || this.plugin.settings.mainCategories.length === 0) {
      c.createEl("p", { cls: "ef-muted" }).textContent = "还没有作品类型, 请先到设置 → Edit Flow → 作品类型添加主分类和子类。";
      const btns = c.createDiv({ cls: "ef-modal-btns" });
      btns.createEl("button", { text: "关闭" }).onclick = () => this.close();
      return;
    }
    this.main = this.main || this.plugin.settings.mainCategories[0]?.id;
    const cats = this.plugin.settings.mainCategories;
    new Setting(c).setName("主分类").addDropdown((dd) => {
      for (const cat of cats) dd.addOption(cat.id, cat.name);
      if (this.main) dd.setValue(this.main);
      dd.onChange((v) => { this.main = v; this.sub = null; this.renderSubDropdown(subSetting); });
    });
    const subSetting = new Setting(c).setName("子类");
    this.renderSubDropdown(subSetting);

    // 作品对象 (可选, 支持在弹窗里快速添加)
    this.audSettingWrap = c.createDiv({ cls: "ef-aud-setting-wrap" });
    this.renderAudienceSetting();

    // 起始阶段 (不同阶段会显示对应内容输入框)
    new Setting(c).setName("起始阶段").setDesc("从哪个阶段开始创作, 会弹出对应输入框").addDropdown((dd) => {
      for (const s of STAGES) dd.addOption(s.id, s.name);
      dd.setValue(this.stage);
      dd.onChange((v) => { this.stage = v; this.renderStageContent(); });
    });

    new Setting(c).setName("标题").addText((t) => { t.setPlaceholder("作品标题 (可选)"); t.onChange((v) => this.title = v); });

    // 阶段内容输入区 (根据 stage 显示不同输入框)
    this.stageContentWrap = c.createDiv({ cls: "ef-stage-content-wrap" });
    this.renderStageContent();

    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    const create = btns.createEl("button", { cls: "mod-cta", text: "创建" });
    create.onclick = async () => {
      try {
        const { file } = await this.plugin.workflow.createWork({
          mainCategory: this.main, subType: this.sub, stage: this.stage,
          title: this.title, stageContent: this.stageContent, audience: this.audience,
        });
        // 打开作品文件
        await this.app.workspace.getLeaf(false).openFile(file);
        new Notice("已创建: " + file.basename);
        // 所有作品都自动打开逻辑线
        if (this.plugin.settings.enableAutoOpenTimeline) {
          await new Promise((r) => setTimeout(r, 200));
          await this.plugin.activateToolsForFile("timeline", file);
        }
        this.onCreated(); this.close();
      } catch (e) { new Notice("创建失败: " + e.message); console.error(e); }
    };
  }

  // 根据阶段渲染不同的内容输入框
  renderStageContent() {
    const c = this.stageContentWrap; if (!c) return; c.empty();
    const sf = WorkflowManager.STAGE_FIELDS[this.stage];
    if (!sf) return;
    const wrap = c.createDiv({ cls: "ef-stage-field" });
    wrap.createEl("label", { cls: "ef-stage-label", text: sf.label + " (可选)" });
    if (this.stage === "script") {
      const ta = wrap.createEl("textarea", { cls: "ef-stage-textarea", attr: { placeholder: sf.placeholder } });
      ta.oninput = () => this.stageContent = ta.value;
    } else if (this.stage === "copy") {
      const titleInput = wrap.createEl("input", { cls: "ef-stage-input", attr: { placeholder: "文案标题" } });
      const bodyTa = wrap.createEl("textarea", { cls: "ef-stage-textarea", attr: { placeholder: "文案正文" } });
      const tagsInput = wrap.createEl("input", { cls: "ef-stage-input", attr: { placeholder: "话题标签 (空格分隔)" } });
      const gather = () => { this.stageContent = `**标题**: ${titleInput.value}\n\n${bodyTa.value}\n\n**话题**: ${tagsInput.value}`; };
      [titleInput, bodyTa, tagsInput].forEach((el) => el.addEventListener("input", gather));
    } else if (this.stage === "cover") {
      const styleInput = wrap.createEl("input", { cls: "ef-stage-input", attr: { placeholder: "封面风格 (如: 极简/国风/霓虹)" } });
      const descTa = wrap.createEl("textarea", { cls: "ef-stage-textarea", attr: { placeholder: "封面设计说明、参考链接..." } });
      const gather = () => { this.stageContent = `**风格**: ${styleInput.value}\n\n${descTa.value}`; };
      styleInput.addEventListener("input", gather);
      descTa.addEventListener("input", gather);
    } else {
      // inspiration / topic / work - 单个 textarea (script 阶段走侧边栏时间线)
      const ta = wrap.createEl("textarea", { cls: "ef-stage-textarea", attr: { placeholder: sf.placeholder } });
      ta.oninput = () => this.stageContent = ta.value;
    }
  }

  renderSubDropdown(setting) {
    setting.clear();
    const subs = this.plugin.settings.subTypes[this.main] || [];
    if (!this.sub && subs.length > 0) this.sub = subs[0].id;
    setting.addDropdown((dd) => {
      for (const st of subs) dd.addOption(st.id, st.name);
      if (this.sub) dd.setValue(this.sub);
      dd.onChange((v) => this.sub = v);
    });
  }

  // 作品对象下拉框 (可重建, 支持 AudiencesModal 关闭后刷新选项)
  renderAudienceSetting() {
    const wrap = this.audSettingWrap; if (!wrap) return; wrap.empty();
    const s = new Setting(wrap).setName("作品对象").setDesc("目标受众/创作对象 (可选)");
    s.addDropdown((dd) => {
      dd.addOption("", "无");
      for (const a of this.plugin.settings.audiences || []) dd.addOption(a.id, a.name);
      if (this.audience) dd.setValue(this.audience);
      dd.onChange((v) => { this.audience = v; });
    });
    s.addExtraButton((b) => {
      b.setIcon("plus"); b.setTooltip("新建对象");
      b.onClick(() => new AudiencesModal(this.app, this.plugin, () => this.renderAudienceSetting(), { quickAdd: true }).open());
    });
  }
}

class AddSubTypeModal extends Modal {
  constructor(app, plugin, mainId, onDone) { super(app); this.plugin = plugin; this.mainId = mainId; this.onDone = onDone || (() => {}); }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-amc-modal");
    c.createEl("h2").textContent = "添加子类";
    let icon = "file";
    const toggles = { needsScript: false, needsCover: false, needsCopy: true };
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, placeholder, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", placeholder } });
      return input;
    };
    const nameInput = mkRow("名称", "如: 短视频");
    const descInput = mkRow("描述", "可选");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: MORANDI.sage } });
    // 开关 (用原生 checkbox)
    const mkToggle = (label, key) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-toggle-row" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const cb = row.createEl("input", { cls: "ef-acc-modal-checkbox", attr: { type: "checkbox" } });
      cb.checked = toggles[key];
      cb.onchange = () => toggles[key] = cb.checked;
    };
    mkToggle("需要脚本", "needsScript");
    mkToggle("需要封面", "needsCover");
    mkToggle("需要文案", "needsCopy");
    // 图标选择器 (网格点选)
    c.createEl("label", { cls: "ef-acc-modal-label", text: "图标" }).style.marginTop = "8px";
    const iconWrap = c.createDiv({ cls: "ef-icon-picker" });
    const previewEl = iconWrap.createDiv({ cls: "ef-icon-preview" });
    setLucideIcon(previewEl.createSpan(), icon);
    previewEl.createSpan({ cls: "ef-icon-name" }).textContent = icon;
    const grid = iconWrap.createDiv({ cls: "ef-icon-grid" });
    for (const ic of ICON_LIBRARY) {
      const btn = grid.createEl("button", { cls: "ef-icon-btn" + (ic === icon ? " is-selected" : "") });
      setLucideIcon(btn.createSpan(), ic);
      btn.title = ic;
      btn.onclick = () => {
        icon = ic;
        previewEl.empty();
        setLucideIcon(previewEl.createSpan(), ic);
        previewEl.createSpan({ cls: "ef-icon-name" }).textContent = ic;
        grid.querySelectorAll(".ef-icon-btn").forEach((b) => b.removeClass("is-selected"));
        btn.addClass("is-selected");
      };
    }
    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    btns.createEl("button", { cls: "mod-cta", text: "添加" }).onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice("请输入名称"); nameInput.focus(); return; }
      await this.plugin.templates.addSubType(this.mainId, { name, description: descInput.value.trim(), color: colorInput.value, icon, needsScript: toggles.needsScript, needsCover: toggles.needsCover, needsCopy: toggles.needsCopy, template: "" });
      new Notice("已添加: " + name); this.onDone(); this.close();
    };
  }
}

class AddMainCategoryModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone || (() => {}); }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-amc-modal");
    c.createEl("h2").textContent = "添加主分类";
    let icon = "file";
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, placeholder, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", placeholder } });
      return input;
    };
    const nameInput = mkRow("名称", "如: 视频作品");
    const descInput = mkRow("描述", "可选");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: MORANDI.sage } });
    // 图标选择器 (网格点选)
    c.createEl("label", { cls: "ef-acc-modal-label", text: "图标" }).style.marginTop = "8px";
    const iconWrap = c.createDiv({ cls: "ef-icon-picker" });
    const previewEl = iconWrap.createDiv({ cls: "ef-icon-preview" });
    setLucideIcon(previewEl.createSpan(), icon);
    previewEl.createSpan({ cls: "ef-icon-name" }).textContent = icon;
    const grid = iconWrap.createDiv({ cls: "ef-icon-grid" });
    for (const ic of ICON_LIBRARY) {
      const btn = grid.createEl("button", { cls: "ef-icon-btn" + (ic === icon ? " is-selected" : "") });
      setLucideIcon(btn.createSpan(), ic);
      btn.title = ic;
      btn.onclick = () => {
        icon = ic;
        previewEl.empty();
        setLucideIcon(previewEl.createSpan(), ic);
        previewEl.createSpan({ cls: "ef-icon-name" }).textContent = ic;
        grid.querySelectorAll(".ef-icon-btn").forEach((b) => b.removeClass("is-selected"));
        btn.addClass("is-selected");
      };
    }
    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    btns.createEl("button", { cls: "mod-cta", text: "添加" }).onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice("请输入名称"); nameInput.focus(); return; }
      await this.plugin.templates.addMainCategory({ name, description: descInput.value.trim(), color: colorInput.value, icon });
      new Notice("已添加: " + name); this.onDone(); this.close();
    };
  }
}

class AccountsModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone || (() => {}); }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-acc-modal");
    c.createEl("h2").textContent = "账号管理";
    c.createEl("p", { cls: "ef-muted" }).textContent = "添加自己的账号 (ID/平台/链接), 作品发布时选择对应平台。";
    const listEl = c.createDiv({ cls: "ef-acc-modal-list" });
    const render = () => {
      listEl.empty();
      const accs = this.plugin.settings.accounts || [];
      if (accs.length === 0) { listEl.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "还没有账号, 下面添加。"; return; }
      accs.forEach((acc, idx) => {
        const card = listEl.createDiv({ cls: "ef-acc-modal-card" });
        card.style.borderLeftColor = acc.color || MORANDI.pink;
        const head = card.createDiv({ cls: "ef-acc-modal-card-head" });
        const dot = head.createDiv({ cls: "ef-pub-dot", attr: { style: `background:${acc.color || MORANDI.pink}` } });
        const nameEl = head.createDiv({ cls: "ef-acc-modal-name" });
        nameEl.textContent = acc.accountId || acc.name || "";
        if (acc.platform) { const pf = head.createDiv({ cls: "ef-acc-modal-platform" }); pf.textContent = acc.platform; }
        const editBtn = head.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(editBtn, "edit-3"); editBtn.title = "编辑账号";
        editBtn.onclick = (e) => { e.stopPropagation(); this.openEdit(acc, idx, () => { render(); this.onDone(); }); };
        const delBtn = head.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(delBtn, "trash-2"); delBtn.title = "删除账号";
        delBtn.onclick = async (e) => { e.stopPropagation(); if (confirm(`删除账号 "${acc.accountId || acc.name}"? 作品记录不会删除。`)) { this.plugin.settings.accounts.splice(idx, 1); await this.plugin.saveSettings(); render(); this.onDone(); } };
        if (acc.url) {
          const linkRow = card.createDiv({ cls: "ef-acc-modal-link" });
          setLucideIcon(linkRow.createSpan({ cls: "ef-acc-modal-link-ic" }), "link");
          const linkEl = linkRow.createEl("a", { cls: "ef-acc-modal-link-url" });
          linkEl.textContent = acc.url; linkEl.href = acc.url; linkEl.target = "_blank";
        }
        // 显示已发布到此账号的作品
        const works = this.plugin.workflow.getWorksByAccount(acc.id);
        const wRow = card.createDiv({ cls: "ef-acc-modal-works" });
        wRow.createDiv({ cls: "ef-acc-modal-works-label" }).textContent = `已发布 (${works.length})`;
        if (works.length > 0) {
          const wList = wRow.createDiv({ cls: "ef-acc-modal-works-list" });
          for (const w of works) {
            const wRow2 = wList.createDiv({ cls: "ef-acc-modal-work-row" });
            const st = this.plugin.workflow.getSubType(w.mainCategory, w.subType);
            if (st) wRow2.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
            const wName = wRow2.createDiv({ cls: "ef-acc-modal-work-name" });
            wName.textContent = w.name;
            wName.onclick = async () => { const f = this.app.vault.getAbstractFileByPath(w.path); if (f && f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); };
            if (w.publishDate) wRow2.createSpan({ cls: "ef-acc-modal-work-date" }).textContent = w.publishDate.slice(5);
          }
        }
      });
    };
    render();
    // 添加账号表单 (用原生 input, 直接读 value, 避免 onChange 闭包问题)
    c.createEl("h3", { cls: "ef-acc-modal-add-title" }).textContent = "添加账号";
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, placeholder, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", placeholder } });
      return input;
    };
    const idInput = mkRow("账号 ID", "你的账号名/号");
    const pfInput = mkRow("平台", "抖音/小红书/B站/公众号...");
    const urlInput = mkRow("链接", "账号主页链接 (可选)");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: MORANDI_LIST[Math.floor(Math.random()*MORANDI_LIST.length)] } });
    const addBtn = c.createEl("button", { cls: "mod-cta ef-acc-modal-add-btn", text: "添加账号" });
    addBtn.onclick = async () => {
      const accountId = idInput.value.trim();
      if (!accountId) { new Notice("请输入账号 ID"); idInput.focus(); return; }
      this.plugin.settings.accounts.push({ id: uid(), accountId, platform: pfInput.value.trim(), url: urlInput.value.trim(), color: colorInput.value });
      await this.plugin.saveSettings(); render(); this.onDone(); new Notice("已添加: " + accountId);
      idInput.value = ""; pfInput.value = ""; urlInput.value = "";
      idInput.focus();
    };
  }
  openEdit(acc, idx, onDone) {
    const modal = new Modal(this.app);
    const c = modal.contentEl; c.empty(); c.addClass("ef-acc-modal");
    c.createEl("h2").textContent = "编辑账号";
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, value, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", value: value || "" } });
      return input;
    };
    const idInput = mkRow("账号 ID", acc.accountId || acc.name || "");
    const pfInput = mkRow("平台", acc.platform || "");
    const urlInput = mkRow("链接", acc.url || "");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: acc.color || MORANDI.pink } });
    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => modal.close();
    btns.createEl("button", { cls: "mod-cta", text: "保存" }).onclick = async () => {
      const accountId = idInput.value.trim();
      if (!accountId) { new Notice("请输入账号 ID"); return; }
      const a = this.plugin.settings.accounts[idx];
      a.accountId = accountId; a.platform = pfInput.value.trim(); a.url = urlInput.value.trim(); a.color = colorInput.value;
      await this.plugin.saveSettings(); onDone(); modal.close(); new Notice("已更新");
    };
    modal.open();
  }
}

// 作品对象管理 (目标受众/创作对象, 支持自定义)
class AudiencesModal extends Modal {
  constructor(app, plugin, onDone, opts = {}) {
    super(app); this.plugin = plugin; this.onDone = onDone || (() => {});
    this.quickAdd = opts.quickAdd || false;
  }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-acc-modal");
    c.createEl("h2").textContent = "作品对象";
    c.createEl("p", { cls: "ef-muted" }).textContent = "管理作品的目标受众/创作对象 (如: 粉丝/客户/自己), 创建作品时可选择。";
    const listEl = c.createDiv({ cls: "ef-acc-modal-list" });
    const render = () => {
      listEl.empty();
      const auds = this.plugin.settings.audiences || [];
      if (auds.length === 0) { listEl.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "还没有对象, 下面添加。"; }
      auds.forEach((aud, idx) => {
        const card = listEl.createDiv({ cls: "ef-acc-modal-card" });
        card.style.borderLeftColor = aud.color || MORANDI.blue;
        const head = card.createDiv({ cls: "ef-acc-modal-card-head" });
        const dot = head.createDiv({ cls: "ef-pub-dot", attr: { style: `background:${aud.color || MORANDI.blue}` } });
        head.createDiv({ cls: "ef-acc-modal-name" }).textContent = aud.name || "";
        if (aud.description) head.createDiv({ cls: "ef-acc-modal-platform" }).textContent = aud.description;
        const editBtn = head.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(editBtn, "edit-3"); editBtn.title = "编辑对象";
        editBtn.onclick = (e) => { e.stopPropagation(); this.openEdit(aud, idx, () => { render(); this.onDone(); }); };
        const delBtn = head.createEl("button", { cls: "ef-btn ef-btn-icon ef-btn-sm" });
        setLucideIcon(delBtn, "trash-2"); delBtn.title = "删除对象";
        delBtn.onclick = async (e) => { e.stopPropagation(); if (confirm(`删除对象 "${aud.name}"? 作品不会被删除, 只是取消关联。`)) { this.plugin.settings.audiences.splice(idx, 1); await this.plugin.saveSettings(); render(); this.onDone(); } };
        // 显示该对象下的作品
        const works = this.plugin.workflow.getWorksByAudience(aud.id);
        const wRow = card.createDiv({ cls: "ef-acc-modal-works" });
        wRow.createDiv({ cls: "ef-acc-modal-works-label" }).textContent = `作品 (${works.length})`;
        if (works.length > 0) {
          const wList = wRow.createDiv({ cls: "ef-acc-modal-works-list" });
          for (const w of works) {
            const wRow2 = wList.createDiv({ cls: "ef-acc-modal-work-row" });
            const st = this.plugin.workflow.getSubType(w.mainCategory, w.subType);
            if (st) wRow2.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
            const wName = wRow2.createDiv({ cls: "ef-acc-modal-work-name" });
            wName.textContent = w.name;
            wName.onclick = async () => { const f = this.app.vault.getAbstractFileByPath(w.path); if (f && f instanceof TFile) await this.app.workspace.getLeaf(false).openFile(f); };
          }
        }
      });
    };
    render();
    // 添加对象表单 (原生 input, 直接读 value)
    c.createEl("h3", { cls: "ef-acc-modal-add-title" }).textContent = "添加对象";
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, placeholder, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", placeholder } });
      return input;
    };
    const nameInput = mkRow("名称", "如: 粉丝/客户A/自己");
    const descInput = mkRow("描述", "可选");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: MORANDI_LIST[Math.floor(Math.random()*MORANDI_LIST.length)] } });
    const addBtn = c.createEl("button", { cls: "mod-cta ef-acc-modal-add-btn", text: "添加对象" });
    addBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice("请输入对象名称"); nameInput.focus(); return; }
      const newAud = { id: uid(), name, description: descInput.value.trim(), color: colorInput.value };
      this.plugin.settings.audiences.push(newAud);
      await this.plugin.saveSettings();
      // quickAdd 模式: 添加后自动选中并关闭弹窗 (供 CreateWorkModal 快速添加)
      if (this.quickAdd) { this.onDone(); this.close(); new Notice("已添加: " + name); return; }
      render(); this.onDone(); new Notice("已添加: " + name);
      nameInput.value = ""; descInput.value = ""; nameInput.focus();
    };
    // quickAdd 模式聚焦名称
    if (this.quickAdd) { nameInput.focus(); }
  }
  openEdit(aud, idx, onDone) {
    const modal = new Modal(this.app);
    const c = modal.contentEl; c.empty(); c.addClass("ef-acc-modal");
    c.createEl("h2").textContent = "编辑对象";
    const formWrap = c.createDiv({ cls: "ef-acc-modal-form" });
    const mkRow = (label, value, type) => {
      const row = formWrap.createDiv({ cls: "ef-acc-modal-field" });
      row.createEl("label", { cls: "ef-acc-modal-label", text: label });
      const input = row.createEl("input", { cls: "ef-acc-modal-input", attr: { type: type || "text", value: value || "" } });
      return input;
    };
    const nameInput = mkRow("名称", aud.name || "");
    const descInput = mkRow("描述", aud.description || "");
    const colorRow = formWrap.createDiv({ cls: "ef-acc-modal-field" });
    colorRow.createEl("label", { cls: "ef-acc-modal-label", text: "颜色" });
    const colorInput = colorRow.createEl("input", { cls: "ef-acc-modal-color", attr: { type: "color", value: aud.color || MORANDI.blue } });
    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => modal.close();
    btns.createEl("button", { cls: "mod-cta", text: "保存" }).onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice("请输入对象名称"); return; }
      const a = this.plugin.settings.audiences[idx];
      a.name = name; a.description = descInput.value.trim(); a.color = colorInput.value;
      await this.plugin.saveSettings(); onDone(); modal.close(); new Notice("已更新");
    };
    modal.open();
  }
}

// 每周排期表编辑 (周一~周日 每天选 制作类型 + 发布类型, 与单作品发布时间分开)
class WeeklyScheduleModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone || (() => {}); }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-weekly-modal");
    c.createEl("h2").textContent = "每周排期表";
    c.createEl("p", { cls: "ef-muted" }).textContent = "设定每周几要制作什么类型、发什么类型。这是固定模板, 与单个作品的发布时间独立。";
    const ws = this.plugin.workflow.getWeeklySchedule();
    const allSubs = this.plugin.workflow.getAllSubTypes();
    if (allSubs.length === 0) { c.createDiv({ cls: "ef-muted" }).textContent = "请先创建作品子类。"; return; }

    for (const d of ws) {
      const dayRow = c.createDiv({ cls: "ef-ws-day-row" });
      const dayHead = dayRow.createDiv({ cls: "ef-ws-day-head" });
      const todayWeekday = new Date().getDay() || 7;
      if (d.day === todayWeekday) dayHead.addClass("is-today");
      dayHead.createDiv({ cls: "ef-ws-day-name" }).textContent = d.name;
      dayHead.createDiv({ cls: "ef-muted ef-ws-day-hint" }).textContent = "制作 / 发布";
      const body = dayRow.createDiv({ cls: "ef-ws-day-body" });
      // 制作类型
      const mkWrap = body.createDiv({ cls: "ef-ws-type-col" });
      mkWrap.createDiv({ cls: "ef-ws-type-label" }).textContent = "制作";
      this.renderChipPicker(mkWrap, allSubs, d.makeTypes, (newArr) => { d.makeTypes = newArr; });
      // 发布类型
      const pbWrap = body.createDiv({ cls: "ef-ws-type-col" });
      pbWrap.createDiv({ cls: "ef-ws-type-label" }).textContent = "发布";
      this.renderChipPicker(pbWrap, allSubs, d.publishTypes, (newArr) => { d.publishTypes = newArr; });
    }

    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    const saveBtn = btns.createEl("button", { cls: "mod-cta", text: "保存" });
    saveBtn.onclick = async () => {
      for (const d of ws) await this.plugin.workflow.setWeeklyDay(d.day, d.makeTypes, d.publishTypes);
      new Notice("每周排期表已保存");
      this.onDone();
      this.close();
    };
  }
  // 多选 chip
  renderChipPicker(container, allSubs, selected, onChange) {
    const sel = new Set(selected);
    const chips = container.createDiv({ cls: "ef-ws-chips" });
    const rerender = () => {
      chips.empty();
      for (const st of allSubs) {
        const on = sel.has(st.id);
        const chip = chips.createDiv({ cls: "ef-ws-chip" + (on ? " is-on" : ""), attr: { style: on ? `background:${st.color}` : "" } });
        const ic = chip.createSpan({ cls: "ef-ws-chip-ic" }); setLucideIcon(ic, st.icon);
        chip.createSpan({ cls: "ef-ws-chip-name" }).textContent = st.name;
        chip.onclick = () => { if (sel.has(st.id)) sel.delete(st.id); else sel.add(st.id); onChange(Array.from(sel)); rerender(); };
      }
    };
    rerender();
  }
}

// 发布管理弹窗 (设发布日期 + 选择发布到了哪些平台)
class PublishWorkModal extends Modal {
  constructor(app, plugin, work, onDone) { super(app); this.plugin = plugin; this.work = work; this.onDone = onDone || (() => {}); }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-pub-modal");
    c.createEl("h2").textContent = "发布管理";
    const w = this.work;
    const st = this.plugin.workflow.getSubType(w.mainCategory, w.subType);
    if (st) c.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
    c.createEl("p", { cls: "ef-pub-modal-name" }).textContent = w.name;

    // 发布日期
    c.createEl("label", { cls: "ef-pub-modal-label", text: "发布日期" });
    const dateInput = c.createEl("input", { cls: "ef-search-input", attr: { type: "date", value: w.publishDate || "" } });
    dateInput.style.marginBottom = "12px";

    // 发布平台 (多选账号) — sel 提到外层, 避免块级作用域导致保存按钮访问不到
    c.createEl("label", { cls: "ef-pub-modal-label", text: "发布平台 (勾选发布到的账号)" });
    const accounts = this.plugin.settings.accounts || [];
    const sel = new Set(w.publishPlatforms || []);
    if (accounts.length === 0) {
      c.createDiv({ cls: "ef-muted ef-empty-sm" }).textContent = "还没有账号, 请先在账号管理添加。";
    } else {
      const chipsEl = c.createDiv({ cls: "ef-pub-modal-chips" });
      const rerender = () => {
        chipsEl.empty();
        for (const acc of accounts) {
          const on = sel.has(acc.id);
          const chip = chipsEl.createDiv({ cls: "ef-pub-modal-chip" + (on ? " is-on" : ""), attr: { style: on ? `background:${acc.color || MORANDI.pink}` : "" } });
          chip.createDiv({ cls: "ef-pub-modal-chip-dot", attr: { style: !on ? `background:${acc.color || MORANDI.pink}` : "" } });
          const info = chip.createDiv({ cls: "ef-pub-modal-chip-info" });
          info.createDiv({ cls: "ef-pub-modal-chip-name" }).textContent = acc.accountId || acc.name || "";
          if (acc.platform) info.createDiv({ cls: "ef-pub-modal-chip-platform" }).textContent = acc.platform;
          chip.onclick = () => { if (sel.has(acc.id)) sel.delete(acc.id); else sel.add(acc.id); rerender(); };
        }
      };
      rerender();
    }

    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    btns.createEl("button", { cls: "mod-cta", text: "保存" }).onclick = async () => {
      await this.plugin.workflow.setPublishDate(w.id, dateInput.value);
      await this.plugin.workflow.setPublishPlatforms(w.id, Array.from(sel));
      new Notice("已保存发布信息");
      this.onDone(); this.close();
    };
  }
}

// 修改作品类型 (主分类 + 子类)
class ChangeWorkTypeModal extends Modal {
  constructor(app, plugin, work, onDone) { super(app); this.plugin = plugin; this.work = work; this.onDone = onDone || (() => {}); this.main = work.mainCategory; this.sub = work.subType; }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-cwt-modal");
    c.createEl("h2").textContent = "修改作品类型";
    c.createEl("p", { cls: "ef-muted" }).textContent = this.work.name;

    // 主分类
    c.createEl("label", { cls: "ef-pub-modal-label", text: "主分类" });
    const mainSel = c.createEl("select", { cls: "ef-search-input" });
    for (const cat of this.plugin.settings.mainCategories) {
      const opt = mainSel.createEl("option", { attr: { value: cat.id } });
      opt.textContent = cat.name; if (cat.id === this.main) opt.selected = true;
    }
    mainSel.style.marginBottom = "10px";

    // 子类
    c.createEl("label", { cls: "ef-pub-modal-label", text: "子类" });
    const subWrap = c.createDiv({ cls: "ef-cwt-subs" });
    const renderSubs = () => {
      subWrap.empty();
      const subs = this.plugin.settings.subTypes[this.main] || [];
      for (const st of subs) {
        const on = st.id === this.sub;
        const chip = subWrap.createDiv({ cls: "ef-pub-modal-chip" + (on ? " is-on" : ""), attr: { style: on ? `background:${st.color}` : "" } });
        chip.createDiv({ cls: "ef-pub-modal-chip-dot", attr: { style: !on ? `background:${st.color}` : "" } });
        chip.createDiv({ cls: "ef-pub-modal-chip-name" }).textContent = st.name;
        chip.onclick = () => { this.sub = st.id; renderSubs(); };
      }
    };
    mainSel.onchange = () => { this.main = mainSel.value; const subs = this.plugin.settings.subTypes[this.main] || []; this.sub = subs[0]?.id || ""; renderSubs(); };
    renderSubs();

    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    btns.createEl("button", { cls: "mod-cta", text: "保存" }).onclick = async () => {
      if (!this.main || !this.sub) { new Notice("请选择类型"); return; }
      await this.plugin.workflow.changeWorkType(this.work.id, this.main, this.sub);
      new Notice("已修改作品类型");
      this.onDone(); this.close();
    };
  }
}

// 修改作品进度状态 (未开始/策划中/制作中/已完成/已发布)
class ChangeWorkStatusModal extends Modal {
  constructor(app, plugin, work, onDone) { super(app); this.plugin = plugin; this.work = work; this.onDone = onDone || (() => {}); this.progress = work.progress || "not-started"; }
  onOpen() {
    const c = this.contentEl; c.empty(); c.addClass("ef-cws-modal");
    c.createEl("h2").textContent = "修改作品状态";
    c.createEl("p", { cls: "ef-muted" }).textContent = this.work.name;
    const grid = c.createDiv({ cls: "ef-cws-grid" });
    const render = () => {
      grid.empty();
      for (const s of WORK_STATUS) {
        const on = s.id === this.progress;
        const card = grid.createDiv({ cls: "ef-cws-card" + (on ? " is-on" : ""), attr: { style: on ? `border-color:${s.color}; background:${s.color}55` : "" } });
        const ic = card.createDiv({ cls: "ef-cws-icon" }); setLucideIcon(ic, s.icon);
        card.createDiv({ cls: "ef-cws-name" }).textContent = s.name;
        card.onclick = () => { this.progress = s.id; render(); };
      }
    };
    render();
    const btns = c.createDiv({ cls: "ef-modal-btns" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    btns.createEl("button", { cls: "mod-cta", text: "保存" }).onclick = async () => {
      await this.plugin.workflow.changeWorkStatus(this.work.id, this.progress);
      new Notice("已修改作品状态");
      this.onDone(); this.close();
    };
  }
}

class EditFlowSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const c = this.containerEl; c.empty();
    c.createEl("h2").textContent = "Edit Flow 设置";

    // 路径设置 (用 addText + FolderSuggest, 不产生空白行)
    c.createEl("h3").textContent = "路径设置 (输入关键字会自动搜索文件夹)";
    this.addFolderSetting(c, "根文件夹", "所有 Edit Flow 文件的根目录", "rootFolder", "Edit Flow");
    this.addFolderSetting(c, "作品文件夹", "所有作品统一存放的文件夹", null, "作品",
      (v) => { if (!this.plugin.settings.stageFolders) this.plugin.settings.stageFolders = {}; this.plugin.settings.stageFolders["work"] = v || "作品"; this.plugin.saveSettings(); },
      () => this.plugin.settings.stageFolders?.work || "作品");
    this.addFolderSetting(c, "脚本文件夹", "所有脚本统一存放的文件夹", null, "脚本",
      (v) => { if (!this.plugin.settings.stageFolders) this.plugin.settings.stageFolders = {}; this.plugin.settings.stageFolders["script"] = v || "脚本"; this.plugin.saveSettings(); },
      () => this.plugin.settings.stageFolders?.script || "脚本");
    this.addFolderSetting(c, "素材库文件夹", "素材库在根目录下的文件夹名", "materialFolder", "素材库");
    this.addFolderSetting(c, "便签文件夹", "便签在根目录下的文件夹名", "stickyFolder", "便签");
    this.addFolderSetting(c, "模板文件夹", "模板在根目录下的文件夹名", "templateFolder", "模板");
    this.addFolderSetting(c, "灵感文件夹", "灵感笔记在根目录下的文件夹名", "inspirationFolder", "灵感");

    c.createEl("h3").textContent = "功能";
    new Setting(c).setName("自动打开时间线").setDesc("创建带脚本的作品时自动激活功能区时间线").addToggle((t) => {
      t.setValue(this.plugin.settings.enableAutoOpenTimeline);
      t.onChange((v) => { this.plugin.settings.enableAutoOpenTimeline = v; this.plugin.saveSettings(); });
    });
    new Setting(c).setName("手写模式").setDesc("时间线节点卡片启用手写画板").addToggle((t) => {
      t.setValue(this.plugin.settings.enableHandwriting);
      t.onChange((v) => { this.plugin.settings.enableHandwriting = v; this.plugin.saveSettings(); });
    });

    c.createEl("h3").textContent = "主分类 (删除需二次确认)";
    for (const cat of this.plugin.settings.mainCategories) {
      const s = new Setting(c).setName(cat.name).setDesc(cat.description || "");
      s.controlEl.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${cat.color}` } }).textContent = cat.name;
      s.addButton((b) => { b.setIcon("trash-2"); b.onClick(async () => { if (confirm(`确定删除主分类 "${cat.name}"? 其下子类也会一并删除, 作品文件不会删除。`)) { await this.plugin.templates.removeMainCategory(cat.id); this.display(); } }); });
    }

    c.createEl("h3").textContent = "子类管理 (删除需二次确认)";
    for (const cat of this.plugin.settings.mainCategories) {
      const subs = this.plugin.settings.subTypes[cat.id] || [];
      if (subs.length === 0) continue;
      const catTitle = c.createDiv({ cls: "ef-setting-cat-title" });
      catTitle.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${cat.color}` } }).textContent = cat.name;
      for (const st of subs) {
        const s = new Setting(c).setName(st.name).setDesc(st.description || "");
        s.controlEl.createSpan({ cls: "ef-wt-badge", attr: { style: `background:${st.color}` } }).textContent = st.name;
        s.addButton((b) => { b.setIcon("trash-2"); b.onClick(async () => { if (confirm(`确定删除子类 "${st.name}"? 作品文件不会删除。`)) { await this.plugin.templates.removeSubType(cat.id, st.id); this.display(); } }); });
      }
    }

    c.createEl("h3").textContent = "作品对象";
    new Setting(c).setName("管理作品对象").setDesc("目标受众/创作对象 (如: 粉丝/客户/自己), 支持自定义增删改").addButton((b) => {
      b.setButtonText("打开管理"); b.onClick(() => new AudiencesModal(this.app, this.plugin, () => this.display()).open());
    });

    c.createEl("h3").textContent = "初始化";
    new Setting(c).setName("创建文件夹结构").setDesc("一键创建所有工作流文件夹 + 模板文件 (不会覆盖已有模板)").addButton((b) => {
      b.setButtonText("创建"); b.onClick(async () => { await this.plugin.initFolders(); new Notice("已创建"); });
    });
    new Setting(c).setName("刷新模板文件").setDesc("用内置默认模板覆盖所有模板文件 (用户自定义的修改会丢失)").addButton((b) => {
      b.setButtonText("刷新模板"); b.onClick(async () => { await this.plugin.refreshTemplates(); });
    });

    c.createEl("h3").textContent = "数据";
    new Setting(c).setName("导出设置").setDesc("复制设置 JSON 到剪贴板").addButton((b) => {
      b.setButtonText("导出"); b.onClick(async () => { await navigator.clipboard.writeText(JSON.stringify(this.plugin.settings, null, 2)); new Notice("已复制"); });
    });
    new Setting(c).setName("清空作品索引").setDesc("清空已注册的作品列表 (不会删除文件, 需二次确认)").addButton((b) => {
      b.setButtonText("清空"); b.onClick(async () => { if (confirm("确定清空作品索引? 文件不会被删除, 只是清空插件内的作品列表。")) { this.plugin.settings.workIndex = []; await this.plugin.saveSettings(); new Notice("已清空"); } });
    });
    new Setting(c).setName("清空所有便签").setDesc("删除便签文件夹下所有便签 (需二次确认)").addButton((b) => {
      b.setButtonText("清空"); b.onClick(async () => {
        if (!confirm("确定删除所有便签? 便签文件夹下的所有 md 文件都会被删除。")) return;
        const folder = this.plugin.app.vault.getAbstractFileByPath(this.plugin.getStickyFolder());
        if (folder && folder.children) {
          for (const f of [...folder.children]) { if (f instanceof TFile) await this.plugin.app.vault.trash(f, true); }
        }
        this.plugin.closeAllStickyFloats();
        new Notice("已清空所有便签");
      });
    });
  }

  // 用标准 addText + FolderSuggest, 不再手动 createEl
  addFolderSetting(container, name, desc, settingsKey, defaultValue, customSetter, customGetter) {
    new Setting(container).setName(name).setDesc(desc).addText((t) => {
      const currentValue = customGetter ? customGetter() : (this.plugin.settings[settingsKey] || defaultValue);
      t.setValue(currentValue);
      t.setPlaceholder("输入关键字搜索...");
      const inputEl = t.inputEl;
      inputEl.addClass("ef-folder-input");
      new FolderSuggest(this.app, inputEl);
      const save = () => {
        const v = inputEl.value.trim() || defaultValue;
        if (customSetter) customSetter(v);
        else { this.plugin.settings[settingsKey] = v; this.plugin.saveSettings(); }
      };
      inputEl.addEventListener("change", save);
      inputEl.addEventListener("blur", save);
    });
  }
}

/* =========================================================================
 *  主插件
 * ========================================================================= */

class EditFlowPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.workflow = new WorkflowManager(this);
    this.templates = new TemplateManager(this);
    this._stickyFloats = [];

    this.addRibbonIcon("clapperboard", "Edit Flow 看板", () => this.activateDashboard());
    this.addRibbonIcon("scissors", "Edit Flow 功能区", () => this.activateTools());

    this.addCommand({ id: "open-dashboard", name: "打开看板 (左)", icon: "clapperboard", callback: () => this.activateDashboard() });
    this.addCommand({ id: "open-tools", name: "打开功能区 (右)", icon: "scissors", callback: () => this.activateTools() });
    this.addCommand({ id: "open-tools-timeline", name: "功能区: 时间线", icon: "git-branch", callback: () => this.activateTools("timeline") });
    this.addCommand({ id: "open-tools-inspiration", name: "功能区: 灵感", icon: "sparkles", callback: () => this.activateTools("inspiration") });
    this.addCommand({ id: "open-tools-sticky", name: "功能区: 便签", icon: "sticky-note", callback: () => this.activateTools("sticky") });
    this.addCommand({ id: "open-tools-material", name: "功能区: 素材", icon: "package", callback: () => this.activateTools("material") });
    this.addCommand({ id: "open-navigation", name: "打开导航页面", icon: "film", callback: () => this.activateNavigation() });
    this.addCommand({ id: "new-work", name: "新建作品", icon: "plus", callback: () => new CreateWorkModal(this.app, this, () => {}).open() });
    this.addCommand({ id: "new-sticky", name: "新建悬浮便签", icon: "sticky-note", callback: () => this.openStickyNote() });
    this.addCommand({ id: "edit-weekly-schedule", name: "编辑每周排期表", icon: "calendar-clock", callback: () => new WeeklyScheduleModal(this.app, this, () => {}).open() });
    this.addCommand({ id: "open-settings", name: "打开设置", icon: "settings", callback: () => { try { this.app.setting.open(); this.app.setting.openTabById("edit-flow"); } catch (e) { new Notice("请在设置 → 第三方插件中找到 Edit Flow"); } } });

    this.registerView(VIEW_DASHBOARD, (leaf) => new DashboardView(leaf, this));
    this.registerView(VIEW_TOOLS, (leaf) => new ToolsView(leaf, this));
    this.registerView(VIEW_NAVIGATION, (leaf) => new NavigationView(leaf, this));

    this.addSettingTab(new EditFlowSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension === "md") {
        menu.addItem((item) => {
          item.setTitle("加入 Edit Flow 作品索引"); item.setIcon("film");
          item.onClick(async () => {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
            await this.workflow.registerWork(file, fm["main-category"] || "text", fm["sub-type"] || "article", fm.status || "inspiration");
            new Notice("已添加");
          });
        });
      }
    }));
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
      const sel = editor.getSelection();
      if (sel) {
        menu.addItem((item) => {
          item.setTitle("加入新便签"); item.setIcon("sticky-note");
          item.onClick(() => this.openStickyNote({ id: uid(), title: "摘录", content: sel, color: MORANDI_LIST[0], x: 300, y: 300, w: 280, h: 220 }));
        });
      }
    }));

    // 启动时初始化文件夹 + 刷新模板 + 迁移老脚本文件 + 迁移便签到 md 文件
    this.app.workspace.onLayoutReady(async () => {
      await this.initFolders();
      await this.migrateScripts();
      await this.migrateStickyNotes();
    });
  }

  // 迁移: 把外部脚本文件 (xxx-脚本.md) 的逻辑线内容合并回作品文件的 ## 逻辑线 章节
  async migrateScripts() {
    try {
      const scriptFolder = this.workflow.getScriptFolder();
      const folder = this.app.vault.getAbstractFileByPath(scriptFolder);
      if (!folder || !(folder instanceof TFolder)) return;
      let merged = 0;
      for (const f of folder.children) {
        if (!(f instanceof TFile) || f.extension !== "md" || !f.basename.endsWith("-脚本")) continue;
        // 找对应的作品文件
        const workName = f.basename.replace(/-脚本$/, "");
        const workFile = this.app.vault.getMarkdownFiles().find((x) => x.basename === workName);
        if (!workFile) continue;
        // 读取脚本文件里的节点
        const scriptContent = await this.app.vault.read(f);
        // 简单提取脚本文件里的节点 (## 标题 + 内容 + > 备注)
        const { body } = parseFrontmatter(scriptContent);
        let nodesBody = "";
        const lines = body.split(/\r?\n/);
        let cur = null, buf = [];
        for (const line of lines) {
          const m = line.match(/^##\s+(.+)$/);
          if (m && !m[1].startsWith(workName)) {
            if (cur) { if (cur.content) nodesBody += `${cur.content}\n\n`; if (cur.note) nodesBody += `> ${cur.note}\n\n`; }
            cur = { title: m[1].trim(), content: "", note: "" }; buf = [];
          } else if (line.startsWith("> ") && cur) {
            cur.note += line.slice(2) + "\n";
          } else if (cur) {
            buf.push(line);
          }
        }
        if (cur) { cur.content = buf.join("\n").trim(); if (cur.content) nodesBody += `${cur.content}\n\n`; if (cur.note) nodesBody += `> ${cur.note}\n\n`; }
        if (!nodesBody.trim()) continue;
        // 合并到作品文件
        let workContent = await this.app.vault.read(workFile);
        const secRe = /##\s+逻辑线[\s\S]*?(?=\n##\s|$)/;
        const newSection = `## 逻辑线\n\n${nodesBody.trimEnd()}\n`;
        if (secRe.test(workContent)) {
          workContent = workContent.replace(secRe, newSection);
        } else {
          workContent = workContent.replace(/\s+$/, "") + `\n\n${newSection}`;
        }
        await this.app.vault.modify(workFile, workContent);
        // 删除外部脚本文件
        await this.app.vault.trash(f, true);
        merged++;
      }
      if (merged > 0) new Notice(`已合并 ${merged} 个逻辑线到作品文件`);
    } catch (err) {}
  }

  async activateDashboard() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_DASHBOARD)[0];
    if (!leaf) { leaf = this.app.workspace.getLeftLeaf(false); await leaf.setViewState({ type: VIEW_DASHBOARD }); }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof DashboardView) leaf.view.draw();
  }

  async activateTools(tab) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TOOLS)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TOOLS }); }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof ToolsView) {
      if (tab) leaf.view.activeTab = tab;
      leaf.view.draw();
      if (tab === "timeline") await leaf.view.tlRefresh();
    }
  }

  // 为指定作品文件激活时间线 (跳过 getActiveWorkFile 的 metadataCache 依赖)
  async activateToolsForFile(tab, workFile) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TOOLS)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: VIEW_TOOLS }); }
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof ToolsView) {
      if (tab) leaf.view.activeTab = tab;
      // 直接设置活动文件并加载脚本, 不依赖 metadataCache
      leaf.view.tlActiveWorkFile = workFile;
      await leaf.view.tlLoadScript();
      leaf.view.draw();
    }
  }

  async activateNavigation() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_NAVIGATION)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf(false); await leaf.setViewState({ type: VIEW_NAVIGATION }); }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view instanceof NavigationView) leaf.view.draw();
  }

  openStickyNote(note) {
    const v = new StickyFloatView(this, note);
    v.show();
    this._stickyFloats.push(v);
  }

  dockStickyNote(note) {
    // 关闭浮窗, 转到功能区"便签" tab (不再单独开视图)
    for (const v of this._stickyFloats) { if (v.note.id === note.id) v.close(); }
    this.activateTools("sticky");
  }

  closeAllStickyFloats() {
    for (const v of [...this._stickyFloats]) v.close();
    this._stickyFloats = [];
  }

  openSettings() { this.app.setting.openTabById("edit-flow"); }

  // 便签文件夹
  getStickyFolder() { return `${this.settings.rootFolder}/${this.settings.stickyFolder || "便签"}`; }

  // 保存便签到 md 文件 (frontmatter 存元数据, 正文存 content)
  async saveStickyToMd(note) {
    if (!note || !note.id) return;
    const folder = this.getStickyFolder();
    await this.workflow.ensureFolder(folder);
    const fileName = `${note.title || "便签"}-${note.id.slice(-4)}`.replace(/[\\/:*?"<>|]/g, "_");
    const path = `${folder}/${fileName}.md`;
    const fm = `---\ntype: edit-flow-sticky\nid: "${note.id}"\ntitle: "${(note.title || "便签").replace(/"/g, '\\"')}"\ncolor: "${note.color || MORANDI_LIST[0]}"\nx: ${note.x || 200}\ny: ${note.y || 200}\nw: ${note.w || 260}\nh: ${note.h || 240}\ncreated: ${todayStr()}\ntags:\n  - edit-flow/sticky\n---\n\n${note.content || ""}\n`;
    const f = this.app.vault.getAbstractFileByPath(path);
    try { if (f && f instanceof TFile) await this.app.vault.modify(f, fm); else await this.app.vault.create(path, fm); } catch (e) {}
  }

  // 从 md 文件加载所有便签
  async loadStickyNotes() {
    const folder = this.app.vault.getAbstractFileByPath(this.getStickyFolder());
    if (!folder || !folder.children) return [];
    const notes = [];
    for (const f of folder.children) {
      if (!(f instanceof TFile) || f.extension !== "md") continue;
      try {
        const content = await this.app.vault.read(f);
        const { fm, body } = parseFrontmatter(content);
        if (fm.id || fm.title) {
          notes.push({
            id: String(fm.id || f.basename),
            title: String(fm.title || "便签"),
            content: body.trim(),
            color: String(fm.color || MORANDI_LIST[0]),
            x: parseInt(fm.x) || 200, y: parseInt(fm.y) || 200,
            w: parseInt(fm.w) || 260, h: parseInt(fm.h) || 240,
            _path: f.path,
          });
        }
      } catch (e) {}
    }
    return notes;
  }

  // 删除便签 md 文件
  async deleteStickyMd(noteId) {
    const folder = this.app.vault.getAbstractFileByPath(this.getStickyFolder());
    if (!folder || !folder.children) return;
    for (const f of folder.children) {
      if (!(f instanceof TFile) || f.extension !== "md") continue;
      const cache = this.app.metadataCache.getFileCache(f);
      if (cache?.frontmatter?.id === noteId) { await this.app.vault.trash(f, true); return; }
    }
  }

  // 迁移旧 data.json 里的便签到 md 文件 (只迁移一次)
  async migrateStickyNotes() {
    const oldNotes = this.settings.stickyNotes;
    if (!Array.isArray(oldNotes) || oldNotes.length === 0) return;
    for (const note of oldNotes) { await this.saveStickyToMd(note); }
    this.settings.stickyNotes = []; await this.saveSettings();
    new Notice(`已迁移 ${oldNotes.length} 个便签到便签文件夹`);
  }

  async initFolders() {
    const root = this.settings.rootFolder;
    // 根目录下创建: 作品 / 脚本 / 素材库 / 便签 / 模板 / 灵感
    await this.workflow.ensureFolder(this.workflow.getWorkFolder());
    await this.workflow.ensureFolder(this.workflow.getScriptFolder());
    await this.workflow.ensureFolder(`${root}/${this.settings.materialFolder}`);
    await this.workflow.ensureFolder(this.getStickyFolder());
    await this.workflow.ensureFolder(`${root}/${this.settings.templateFolder}`);
    await this.workflow.ensureFolder(this.workflow.getInspirationFolder());
    // 生成模板文件 (如果不存在才创建, 不覆盖用户已自定义的)
    // 已存在的模板如果缺少 ## 音乐/BGM 章节, 自动补充
    for (const cat of this.settings.mainCategories) {
      const subs = this.settings.subTypes[cat.id] || [];
      for (const st of subs) {
        const path = `${root}/${this.settings.templateFolder}/EF-${st.name}.md`;
        const exist = this.app.vault.getAbstractFileByPath(path);
        if (!exist) {
          try { await this.app.vault.create(path, st.template); } catch (e) {}
        } else if (exist instanceof TFile) {
          try {
            const t = await this.app.vault.read(exist);
            let newT = t;
            let modified = false;
            // 清理 "灵感/产出" 标签行
            if (t.includes("灵感/产出")) {
              newT = t.replace(/\n?\s*-\s*灵感\/产出\n?/g, "\n");
              modified = true;
            }
            // 补充 ## 音乐/BGM 章节 (如果缺少)
            if (!newT.includes("## 音乐/BGM")) {
              newT = newT.includes("## 文案")
                ? newT.replace(/## 文案/, "## 文案\n\n## 音乐/BGM")
                : newT.replace(/\n*$/, "") + "\n\n## 音乐/BGM\n";
              modified = true;
            }
            // 补充 ## 逻辑线 章节 (如果缺少)
            if (!newT.includes("## 逻辑线")) {
              newT = newT.replace(/\n*$/, "") + "\n\n## 逻辑线\n\n> 侧边栏逻辑线视图编辑节点\n";
              modified = true;
            }
            if (modified) await this.app.vault.modify(exist, newT);
          } catch (e) {}
        }
      }
    }
  }

  // 强制刷新所有模板文件 (覆盖, 用于用户修改子类后重新生成)
  async refreshTemplates() {
    const root = this.settings.rootFolder;
    await this.workflow.ensureFolder(`${root}/${this.settings.templateFolder}`);
    let count = 0;
    for (const cat of this.settings.mainCategories) {
      const subs = this.settings.subTypes[cat.id] || [];
      for (const st of subs) {
        const path = `${root}/${this.settings.templateFolder}/EF-${st.name}.md`;
        const f = this.app.vault.getAbstractFileByPath(path);
        try {
          if (f && f instanceof TFile) await this.app.vault.modify(f, st.template);
          else await this.app.vault.create(path, st.template);
          count++;
        } catch (e) {}
      }
    }
    new Notice(`已刷新 ${count} 个模板文件`);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.mainCategories)) this.settings.mainCategories = [];
    if (!this.settings.subTypes || typeof this.settings.subTypes !== "object") this.settings.subTypes = {};
    if (!Array.isArray(this.settings.accounts)) this.settings.accounts = [];
    if (!Array.isArray(this.settings.audiences)) this.settings.audiences = [];
    if (!Array.isArray(this.settings.workIndex)) this.settings.workIndex = [];
    if (!Array.isArray(this.settings.stickyNotes)) this.settings.stickyNotes = [];
    // 确保 stageFolders 至少有 work/script (兼容老配置)
    if (!this.settings.stageFolders) this.settings.stageFolders = {};
    if (!this.settings.stageFolders.work) this.settings.stageFolders.work = "作品";
    if (!this.settings.stageFolders.script) this.settings.stageFolders.script = "脚本";
    if (!this.settings.materialFolder) this.settings.materialFolder = "素材库";
    if (!this.settings.stickyFolder) this.settings.stickyFolder = "便签";
    if (!this.settings.templateFolder) this.settings.templateFolder = "模板";
    if (!this.settings.inspirationFolder) this.settings.inspirationFolder = "灵感";
    // 迁移: 修复旧版内置子类模板 (删 发布记录, 补 文案)
    this.migrateSubTypeTemplates();
  }

  // 修复旧版内置子类模板: 如果包含"## 发布记录"或缺少"## 文案", 用最新默认模板替换; 同步修复 needsScript 等字段
  // 同时给所有子类 (含用户自定义) 补充 ## 音乐/BGM 章节
  migrateSubTypeTemplates() {
    let changed = false;
    let musicAdded = 0;
    // 1. 修复内置子类 (发布记录/文案 缺失 → 替换为默认模板)
    for (const mainId of Object.keys(DEFAULT_SUBTYPES)) {
      const defaults = DEFAULT_SUBTYPES[mainId];
      const current = this.settings.subTypes[mainId];
      if (!Array.isArray(current)) continue;
      for (const def of defaults) {
        const cur = current.find((s) => s.id === def.id);
        if (!cur) continue;
        // 检测: 包含发布记录 或 缺少文案 → 用最新模板替换
        if (cur.template && (cur.template.includes("发布记录") || !cur.template.includes("## 文案"))) {
          cur.template = def.template;
          changed = true;
        }
        // 同步修复 needsScript/needsCover/needsCopy/icon/color/name 等字段 (不覆盖用户自定义的值, 只补缺失的)
        if (cur.needsScript === undefined) cur.needsScript = def.needsScript;
        if (cur.needsCover === undefined) cur.needsCover = def.needsCover;
        if (cur.needsCopy === undefined) cur.needsCopy = def.needsCopy;
      }
    }
    // 2. 给所有子类 (含用户自定义) 补充 ## 音乐/BGM 章节 (如果缺少) + 清理 灵感/产出 标签
    let tagRemoved = 0;
    for (const mainId of Object.keys(this.settings.subTypes)) {
      const current = this.settings.subTypes[mainId];
      if (!Array.isArray(current)) continue;
      for (const cur of current) {
        if (!cur.template) continue;
        // 清理模板里的 "灵感/产出" 标签行 (作品不再自动带此标签)
        if (cur.template.includes("灵感/产出")) {
          cur.template = cur.template.replace(/\n?\s*-\s*灵感\/产出\n?/g, "\n");
          tagRemoved++; changed = true;
        }
        if (cur.template.includes("## 音乐/BGM")) continue;
        // 在 ## 文案 后插入, 否则末尾追加
        if (cur.template.includes("## 文案")) {
          cur.template = cur.template.replace(/## 文案/, "## 文案\n\n## 音乐/BGM");
        } else {
          cur.template = cur.template.replace(/\n*$/, "") + "\n\n## 音乐/BGM\n";
        }
        musicAdded++;
        changed = true;
      }
    }
    if (changed) {
      const msgs = [];
      if (musicAdded > 0) msgs.push(`补充 ${musicAdded} 个音乐/BGM 章节`);
      if (tagRemoved > 0) msgs.push(`清理 ${tagRemoved} 个 灵感/产出 标签`);
      this.saveSettings(); new Notice(`已更新作品模板${msgs.length ? " (" + msgs.join(", ") + ")" : ""}`);
    }
  }
  async saveSettings() { await this.saveData(this.settings); }
}

module.exports = EditFlowPlugin;
