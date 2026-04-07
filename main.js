const { Plugin, PluginSettingTab, Setting, parseFrontMatterTags, requestUrl, normalizePath } = require('obsidian');

const DEFAULT_SETTINGS = { anthropicApiKey: '', smartOpenOnCmdClick: false };

const SYNCED_FILES_DIR = 'Learning Loop Instructions';

class LearningLoopPlugin extends Plugin {

  getSyncedFilesPath() {
    return normalizePath(this.manifest.dir + '/' + SYNCED_FILES_DIR);
  }

  async syncVaultFiles() {
    const adapter = this.app.vault.adapter;
    const syncDir = this.getSyncedFilesPath();

    if (!await adapter.exists(syncDir)) return;

    const listing = await adapter.list(syncDir);
    this._syncedFileNames = new Set();

    const vaultDir = normalizePath(SYNCED_FILES_DIR);
    if (!await adapter.exists(vaultDir)) {
      await adapter.mkdir(vaultDir);
    }

    for (const pluginFilePath of listing.files) {
      const fileName = pluginFilePath.split('/').pop();
      this._syncedFileNames.add(fileName);
      const vaultFilePath = normalizePath(SYNCED_FILES_DIR + '/' + fileName);

      const pluginStat = await adapter.stat(pluginFilePath);
      const vaultExists = await adapter.exists(vaultFilePath);

      if (!vaultExists) {
        // File doesn't exist in vault root — copy from plugin
        const content = await adapter.read(pluginFilePath);
        await adapter.write(vaultFilePath, content);
      } else {
        const vaultStat = await adapter.stat(vaultFilePath);
        if (pluginStat.mtime > vaultStat.mtime) {
          // Plugin copy is newer — update vault root
          const content = await adapter.read(pluginFilePath);
          await adapter.write(vaultFilePath, content);
        } else if (vaultStat.mtime > pluginStat.mtime) {
          // Vault root copy is newer — update plugin dir
          const content = await adapter.read(vaultFilePath);
          await adapter.write(pluginFilePath, content);
        }
      }
    }

    // Watch for edits to synced files in the vault root
    this._syncHandler = this.app.vault.on('modify', async (file) => {
      if (file.parent?.path === SYNCED_FILES_DIR && this._syncedFileNames.has(file.name)) {
        const pluginFilePath = normalizePath(syncDir + '/' + file.name);
        const content = await adapter.read(file.path);
        await adapter.write(pluginFilePath, content);
      }
    });
    this.registerEvent(this._syncHandler);
  }
  enterInsertMode(editor) {
    const cm = editor.cm;
    if (!cm) return;
    // CM6 vim: access the vim plugin's Vim object
    const vim = cm.state?.vim;
    if (vim) {
      vim.mode = 'insert';
      vim.insertMode = true;
      cm.contentDOM?.classList?.remove('cm-vimMode', 'cm-vim-normal');
      cm.contentDOM?.classList?.add('cm-vimMode', 'cm-vim-insert');
      return;
    }
    // Fallback: try dispatching 'i' key to the content DOM
    cm.contentDOM?.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', code: 'KeyI', bubbles: true }));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Extract [[wiki-link]] names from editor lines in [startLine+1, endLine]
  extractLinks(editor, startLine, endLine) {
    const links = [];
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    for (let i = startLine + 1; i <= endLine; i++) {
      const line = editor.getLine(i);
      let match;
      while ((match = linkRegex.exec(line)) !== null) {
        const raw = match[1];
        const name = raw.includes('|') ? raw.split('|').pop() : raw.split('/').pop();
        links.push(name);
      }
    }
    return links;
  }

  // Convert a vault file to an unambiguous link string: "path/to/Page|Page"
  fileToLink(file) {
    return file.path.replace(/\.md$/, '') + '|' + file.basename;
  }

  // Given page names mentioned in the trace, look up each Problem page's
  // "Retrieve Pages" frontmatter and return the union of all referenced pages.
  // Returns [{ name, link }] where link is the full path|alias for [[...]] insertion.
  async retrieveLinkedPages(mentionedLinks) {
    const allFiles = this.app.vault.getFiles();
    const problemFiles = allFiles.filter(f => f.extension === 'md' && f.path.startsWith('Problems/'));
    const problemNameSet = new Set(problemFiles.map(f => f.basename));

    const seen = new Set();
    const results = [];
    for (const name of mentionedLinks) {
      if (!problemNameSet.has(name)) continue;
      const file = problemFiles.find(f => f.basename === name);
      if (!file) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const retrievePages = cache?.frontmatter?.['Retrieve Pages'];
      if (!Array.isArray(retrievePages)) continue;
      for (const entry of retrievePages) {
        const match = entry.match(/\[\[([^\]]+)\]\]/);
        if (!match) continue;
        const raw = match[1];
        // Preserve the original link text from frontmatter (already has path|alias)
        const entryName = raw.includes('|') ? raw.split('|').pop() : raw.split('/').pop();
        if (seen.has(entryName)) continue;
        seen.add(entryName);
        results.push({ name: entryName, link: raw });
      }
    }

    return results;
  }

  async insertSearchResults(editor, mentionedLinks, cueText, blockEnd) {
    const retrieveMatches = await this.retrieveLinkedPages(mentionedLinks);
    const excludeNames = retrieveMatches.map(m => m.name);
    const { aiMatches, aiWarning } = await this.runAiSearch(cueText, excludeNames);

    let outputLines = '';
    for (const m of retrieveMatches) outputLines += '\n\t\t- [[' + m.link + ']]';
    for (const m of aiMatches) outputLines += '\n\t\t- [[' + m.link + ']] (ai)';
    if (aiWarning) outputLines += '\n\t\t- ' + aiWarning;

    const insertion = '\n\t- Learning Loop Output' + outputLines +
      '\n\t- Review\n\t\t- ';

    const lineLen = editor.getLine(blockEnd).length;
    editor.replaceRange(insertion, { line: blockEnd, ch: lineLen });

    const totalOutputLines = retrieveMatches.length + aiMatches.length + (aiWarning ? 1 : 0);
    const reviewLabelLine = blockEnd + 1 + totalOutputLines + 1;
    const cursorLine = reviewLabelLine + 1;
    editor.setCursor({ line: cursorLine, ch: '\t\t- '.length });
    this.enterInsertMode(editor);
  }

  // Build a mapping of queries → page names from all Problem pages' Queries frontmatter.
  buildQueryIndex() {
    const allFiles = this.app.vault.getFiles();
    const problemFiles = allFiles.filter(f => f.extension === 'md' && f.path.startsWith('Problems/'));
    const entries = [];
    for (const file of problemFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const queries = cache?.frontmatter?.['Queries'];
      if (!Array.isArray(queries)) continue;
      for (const q of queries) {
        entries.push({ query: q, page: file.basename });
      }
    }
    return entries;
  }

  // AI search — returns { aiMatches: {name,link}[], aiWarning: string|null }
  // Uses stored queries from Problem pages to find semantically similar matches.
  async runAiSearch(cueText, excludeNames) {
    let aiMatches = [];
    let aiWarning = null;

    const queryIndex = this.buildQueryIndex();
    if (queryIndex.length === 0) return { aiMatches, aiWarning };

    // Build a lookup from basename → full link for Problem pages
    const allFiles = this.app.vault.getFiles();
    const problemFiles = allFiles.filter(f => f.extension === 'md' && f.path.startsWith('Problems/'));
    const nameToLink = new Map();
    for (const f of problemFiles) nameToLink.set(f.basename, this.fileToLink(f));

    if (!this.settings.anthropicApiKey) {
      aiWarning = '⚠ no API key set — Retrieve Pages search only (add key in plugin settings)';
    } else {
      try {
        const indexText = queryIndex.map(e => `- "${e.query}" → ${e.page}`).join('\n');
        const prompt = `Given this cue: "${cueText}"\n\nHere is an index of past queries mapped to their problem pages:\n${indexText}\n\nReturn a JSON array of page names whose queries are semantically similar to the cue. Only return page names from the index. Deduplicate page names. Return ONLY a raw JSON array with no markdown, no code fences, no explanation. Example: ["Stress", "Anxiety"]`;

        const response = await requestUrl({
          url: 'https://api.anthropic.com/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.settings.anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`API error ${response.status}: ${response.text}`);
        }

        const data = response.json;
        const raw = (data.content?.[0]?.text ?? '[]').replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(raw);
        const validNames = new Set(queryIndex.map(e => e.page));
        const excludeSet = new Set(excludeNames);
        aiMatches = parsed
          .filter(name => validNames.has(name) && !excludeSet.has(name))
          .map(name => ({ name, link: nameToLink.get(name) || name }));
      } catch (e) {
        aiWarning = `⚠ AI search failed — Retrieve Pages search only (${e.message})`;
      }
    }

    return { aiMatches, aiWarning };
  }

  // Append a query to the Queries frontmatter of each named page.
  async writeQueriesToPages(query, pageNames) {
    const allFiles = this.app.vault.getFiles();
    for (const name of pageNames) {
      const file = allFiles.find(f => f.extension === 'md' && f.basename === name);
      if (!file) continue;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (!Array.isArray(fm['Queries'])) fm['Queries'] = [];
        if (!fm['Queries'].includes(query)) fm['Queries'].push(query);
      });
    }
  }

  smartOpenRightPane() {
    const workspace = this.app.workspace;
    const rootChildren = workspace.rootSplit.children;

    const activeContainer = workspace.activeLeaf?.parent;
    const activeIndex = rootChildren.indexOf(activeContainer);
    const rightIndex = activeIndex + 1;

    if (rightIndex < rootChildren.length) {
      const rightContainer = rootChildren[rightIndex];
      const rightLeaf = rightContainer.children ? rightContainer.children[0] : rightContainer;
      if (rightLeaf) workspace.setActiveLeaf(rightLeaf, { focus: true });
      return { created: false };
    } else {
      const newLeaf = workspace.getLeaf('split', 'vertical');
      workspace.setActiveLeaf(newLeaf, { focus: true });
      return { created: true };
    }
  }

  setupCmdClickHandler() {
    const plugin = this;
    const workspace = this.app.workspace;
    const original = workspace.openLinkText.bind(workspace);
    this._originalOpenLinkText = original;

    workspace.openLinkText = async function(linktext, sourcePath, newLeaf, openState) {
      if (newLeaf === 'split') {
        const { created } = plugin.smartOpenRightPane();
        return original(linktext, sourcePath, created ? false : 'tab', openState);
      }
      return original(linktext, sourcePath, newLeaf, openState);
    };
  }

  teardownCmdClickHandler() {
    if (this._originalOpenLinkText) {
      this.app.workspace.openLinkText = this._originalOpenLinkText;
      this._originalOpenLinkText = null;
    }
  }

  async onload() {
    await this.loadSettings();
    await this.syncVaultFiles();
    this.addCommand({
      id: 'smart-open-right',
      name: 'Smart Open Right',
      callback: () => this.smartOpenRightPane()
    });

    if (this.settings.smartOpenOnCmdClick) this.setupCmdClickHandler();

    this.addSettingTab(new LearningLoopSettingTab(this.app, this));
    console.log('Learning Loop plugin loaded');

    this.addRibbonIcon('repeat-2', 'Learning Loop: Help', () => {
      this.app.commands.executeCommandById('learning-loop:help');
    });

    this.addCommand({
      id: 'help',
      name: 'Help',
      icon: 'repeat-2',
      editorCallback: async (editor) => {
        const selection = editor.getSelection();
        const cursor = editor.getCursor();

        // If text is highlighted, cut it and create a trace with User Thought / Feeling + User Response
        if (selection) {
          const from = editor.getCursor('from');
          const to = editor.getCursor('to');
          const thoughtLines = selection.trim().split('\n').filter(l => l.trim());
          const thoughtContent = thoughtLines.map(l => '\t\t- ' + l.replace(/^[\s\t]*[-*]?\s*/, '')).join('\n');
          const traceInsertion = '- [[Learning Loop Trace]] %% fold %%\n\t- User Thought / Feeling\n' + thoughtContent + '\n\t- User Response\n\t\t- ';
          editor.replaceRange(traceInsertion, { line: from.line, ch: 0 }, { line: to.line, ch: editor.getLine(to.line).length });
          const responseLine = from.line + 2 + thoughtLines.length + 1;
          editor.setCursor({ line: responseLine, ch: '\t\t- '.length });
          this.enterInsertMode(editor);
          return;
        }

        let text = editor.getLine(cursor.line);

        // Check if already inside a Learning Loop Trace block
        let insideBlock = false;
        let blockStart = -1;
        const totalLines = editor.lineCount();
        let blockEnd = -1;
        for (let i = cursor.line - 1; i >= 0; i--) {
          const line = editor.getLine(i);
          if (line.length > 0 && !line.match(/^\s/)) {
            if (line.trim().startsWith('- [[Learning Loop Trace]]')) {
              blockStart = i;
              blockEnd = blockStart;
              for (let j = blockStart + 1; j < totalLines; j++) {
                const bline = editor.getLine(j);
                if (bline.length > 0 && !bline.match(/^\s/)) break;
                if (bline.trim()) blockEnd = j;
              }
              if (cursor.line <= blockEnd) {
                insideBlock = true;
              }
            }
            break;
          }
        }

        // If inside an LL block, advance to the next step
        if (insideBlock) {

          // Find key sections
          let thoughtLineIdx = -1;
          let responseLineIdx = -1;
          let llOutputLineIdx = -1;
          let reviewLineIdx = -1;
          for (let i = blockStart + 1; i <= blockEnd; i++) {
            const lineText = editor.getLine(i).trim();
            if (lineText === '- User Thought / Feeling') thoughtLineIdx = i;
            if (lineText === '- User Response') responseLineIdx = i;
            if (lineText === '- Learning Loop Output') llOutputLineIdx = i;
            if (lineText === '- Review') reviewLineIdx = i;
          }

          // Review exists — write queries to pages, then exit the trace
          if (reviewLineIdx !== -1) {
            // Extract the query from User Thought / Feeling
            if (thoughtLineIdx !== -1 && llOutputLineIdx !== -1) {
              const thoughtIndentLen = editor.getLine(thoughtLineIdx).match(/^(\s*)/)[1].length;
              let query = '';
              const thoughtEndLine = responseLineIdx !== -1 ? responseLineIdx - 1 : llOutputLineIdx - 1;
              for (let i = thoughtLineIdx + 1; i <= thoughtEndLine; i++) {
                const line = editor.getLine(i);
                if (!line.trim()) continue;
                if (line.match(/^(\s*)/)[1].length <= thoughtIndentLen) break;
                query += ' ' + line.replace(/^[\s\t]*-\s*/, '');
              }
              query = query.trim();

              // Extract page names from the entire trace
              if (query) {
                const allTracePages = this.extractLinks(editor, blockStart, blockEnd);
                const uniquePages = [...new Set(allTracePages)];
                if (uniquePages.length > 0) {
                  await this.writeQueriesToPages(query, uniquePages);
                }
              }
            }

            const lineLen = editor.getLine(blockEnd).length;
            editor.replaceRange('\n', { line: blockEnd, ch: lineLen });
            editor.setCursor({ line: blockEnd + 1, ch: 0 });
            this.enterInsertMode(editor);
            return;
          }

          // No thought section yet — nothing to do
          if (thoughtLineIdx === -1) return;

          // If thought exists but no User Response yet, insert User Response
          if (responseLineIdx === -1) {
            const insertion = '\n\t- User Response\n\t\t- ';
            const lineLen = editor.getLine(blockEnd).length;
            editor.replaceRange(insertion, { line: blockEnd, ch: lineLen });
            const responseBulletLine = blockEnd + 2;
            editor.setCursor({ line: responseBulletLine, ch: '\t\t- '.length });
            this.enterInsertMode(editor);
            return;
          }

          // User Response exists — extract links and text, then search
          const thoughtIndentLen = editor.getLine(thoughtLineIdx).match(/^(\s*)/)[1].length;
          let thoughtText = '';
          for (let i = thoughtLineIdx + 1; i <= blockEnd; i++) {
            const line = editor.getLine(i);
            if (!line.trim()) continue;
            if (line.match(/^(\s*)/)[1].length <= thoughtIndentLen) break;
            thoughtText += ' ' + line.replace(/^[\s\t]*-\s*/, '');
          }
          thoughtText = thoughtText.trim();
          if (!thoughtText) return;

          // Extract [[links]] from both User Thought / Feeling and User Response sections
          const mentionedLinks = [
            ...this.extractLinks(editor, thoughtLineIdx, responseLineIdx - 1),
            ...this.extractLinks(editor, responseLineIdx, blockEnd),
          ];

          await this.insertSearchResults(editor, mentionedLinks, thoughtText, blockEnd);
          return;
        }

        // Empty line: insert a "Learning Loop Trace" block with nested bullet
        // But not if we're already indented inside a Learning Loop Trace block
        const currentLineIndented = editor.getLine(cursor.line).match(/^\s/);
        if (!text.replace(/[-\s]/g, '') && !(insideBlock && currentLineIndented)) {
          const insertion = '- [[Learning Loop Trace]] %% fold %%\n\t- User Thought / Feeling\n\t\t- ';
          const lineLen = editor.getLine(cursor.line).length;
          editor.replaceRange(insertion, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineLen });
          editor.setCursor({ line: cursor.line + 2, ch: '\t\t- '.length });
          this.enterInsertMode(editor);
          return;
        }

        // Line has text: cut it and create a trace with User Thought / Feeling + User Response
        const thoughtText = text.replace(/^[\s\t]*[-*]?\s*/, '').trim();
        if (!thoughtText) return;
        const traceInsertion = '- [[Learning Loop Trace]] %% fold %%\n\t- User Thought / Feeling\n\t\t- ' + thoughtText + '\n\t- User Response\n\t\t- ';
        const lineLen = editor.getLine(cursor.line).length;
        editor.replaceRange(traceInsertion, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineLen });
        const responseLine = cursor.line + 3 + 1;
        editor.setCursor({ line: responseLine, ch: '\t\t- '.length });
        this.enterInsertMode(editor);
      },
    });

  }

  onunload() {
    this.teardownCmdClickHandler();
  }
}

class LearningLoopSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Anthropic API key')
      .setDesc('Used for AI-powered page recommendations in LL output. Get a key at console.anthropic.com.')
      .addText(text => text
        .setPlaceholder('sk-ant-...')
        .setValue(this.plugin.settings.anthropicApiKey)
        .onChange(async (value) => {
          this.plugin.settings.anthropicApiKey = value.trim();
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName('Smart open on Cmd+Opt+Click')
      .setDesc('When enabled, Cmd+Opt+clicking an internal link opens it using smart open right (max 2 panes).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.smartOpenOnCmdClick)
        .onChange(async (value) => {
          this.plugin.settings.smartOpenOnCmdClick = value;
          await this.plugin.saveSettings();
          if (value) this.plugin.setupCmdClickHandler();
          else this.plugin.teardownCmdClickHandler();
        }));
  }
}

module.exports = LearningLoopPlugin;
