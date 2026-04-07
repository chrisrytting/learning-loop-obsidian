class Plugin {
  addCommand() {}
  addRibbonIcon() {}
}

class PluginSettingTab {}

class Setting {
  constructor() {}
  setName() { return this; }
  setDesc() { return this; }
  addText(cb) { cb({ setPlaceholder: () => ({ setValue: () => ({ onChange: () => {} }) }) }); return this; }
}

function parseFrontMatterTags(fm) {
  if (!fm || !fm.tags) return null;
  return Array.isArray(fm.tags) ? fm.tags : [fm.tags];
}

async function requestUrl() {
  return { status: 200, json: { content: [{ text: '[]' }] }, text: '' };
}

function normalizePath(p) { return p; }

module.exports = { Plugin, PluginSettingTab, Setting, parseFrontMatterTags, requestUrl, normalizePath };
