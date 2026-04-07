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

  async insertSearchResults(editor, cueText, blockEnd) {
    const allFiles = this.app.vault.getFiles();
    const { keywordMatches, aiMatches, aiWarning } = await this.runSearch(cueText, allFiles);

    let outputLines = '';
    for (const name of keywordMatches) outputLines += '\n\t\t- [[' + name + ']]';
    for (const name of aiMatches) outputLines += '\n\t\t- [[' + name + ']] (ai)';
    if (aiWarning) outputLines += '\n\t\t- ' + aiWarning;

    const insertion = '\n\t- Learning Loop Output' + outputLines +
      '\n\t- Review\n\t\t- ';

    const lineLen = editor.getLine(blockEnd).length;
    editor.replaceRange(insertion, { line: blockEnd, ch: lineLen });

    const totalOutputLines = keywordMatches.length + aiMatches.length + (aiWarning ? 1 : 0);
    const reviewLabelLine = blockEnd + 1 + totalOutputLines + 1;
    const cursorLine = reviewLabelLine + 1;
    editor.setCursor({ line: cursorLine, ch: '\t\t- '.length });
    this.enterInsertMode(editor);
  }

  // Returns { keywordMatches: string[], aiMatches: string[], aiWarning: string|null }
  // keywordMatches and aiMatches are basenames (no brackets), deduplicated between sets.
  async runSearch(cueText, allFiles) {
    const problemFiles = allFiles.filter(f => f.extension === 'md' && f.path.startsWith('Problems/'));
    const problemNames = problemFiles.map(f => f.basename);

    // Keyword search (all .md files with frontmatter tags, as before)
    const cueLower = cueText.toLowerCase();
    const keywordMatches = [];
    for (const file of allFiles.filter(f => f.extension === 'md')) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache || !cache.frontmatter) continue;
      const tags = parseFrontMatterTags(cache.frontmatter);
      if (!tags) continue;
      const matched = tags.some(tag => {
        const keyword = tag.replace(/^#/, '').toLowerCase();
        return cueLower.includes(keyword);
      });
      if (matched) keywordMatches.push(file.basename);
    }

    // AI search
    let aiMatches = [];
    let aiWarning = null;

    if (!this.settings.anthropicApiKey) {
      aiWarning = '⚠ no API key set — keyword search only (add key in plugin settings)';
    } else {
      try {
        const prompt = `Given this cue: "${cueText}"\n\nHere are the available problem pages:\n${problemNames.map(n => `- ${n}`).join('\n')}\n\nReturn a JSON array of page names from the list above that are relevant to this cue. Only return names from the list. Return ONLY a raw JSON array with no markdown, no code fences, no explanation. Example: ["Stress", "Anxiety"]`;

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
        const keywordSet = new Set(keywordMatches);
        // Validate names exist in Problems/ and aren't already in keyword results
        aiMatches = parsed
          .filter(name => problemNames.includes(name) && !keywordSet.has(name));
      } catch (e) {
        aiWarning = `⚠ AI search failed — keyword search only (${e.message})`;
      }
    }

    return { keywordMatches, aiMatches, aiWarning };
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

          // Review exists — exit the trace by inserting a new line after block
          if (reviewLineIdx !== -1) {
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

          // User Response exists — run search using thought text
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

          await this.insertSearchResults(editor, thoughtText, blockEnd);
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
