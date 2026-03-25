class Plugin {
  addCommand() {}
  addRibbonIcon() {}
}

function parseFrontMatterTags(fm) {
  if (!fm || !fm.tags) return null;
  return Array.isArray(fm.tags) ? fm.tags : [fm.tags];
}

module.exports = { Plugin, parseFrontMatterTags };
