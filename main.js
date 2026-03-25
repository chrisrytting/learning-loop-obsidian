const { Plugin, parseFrontMatterTags } = require('obsidian');

class LearningLoopPlugin extends Plugin {
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

  async onload() {
    this.addRibbonIcon('repeat-2', 'Learning Loop: Step', () => {
      this.app.commands.executeCommandById('learning-loop:step');
    });

    this.addCommand({
      id: 'step',
      name: 'Step',
      icon: 'repeat-2',
      editorCallback: async (editor) => {
        let text = editor.getSelection();
        const cursor = editor.getCursor();
        if (!text) {
          text = editor.getLine(cursor.line);
        }

        // Check if already inside a Learning Loop Trace block
        let insideBlock = false;
        let blockStart = -1;
        const totalLines = editor.lineCount();
        let blockEnd = -1;
        for (let i = cursor.line - 1; i >= 0; i--) {
          const line = editor.getLine(i);
          if (line.length > 0 && !line.match(/^\s/)) {
            if (line.trim() === '- [[Learning Loop Trace]]') {
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

        // If inside an LL block, run the step state machine
        if (insideBlock) {

          // Find key sections
          let cueLineIdx = -1;
          let llOutputLineIdx = -1;
          let reviewLineIdx = -1;
          for (let i = blockStart + 1; i <= blockEnd; i++) {
            const lineText = editor.getLine(i).trim();
            if (lineText === '- cue') cueLineIdx = i;
            if (lineText === '- LL output') llOutputLineIdx = i;
            if (lineText === '- Review') reviewLineIdx = i;
          }

          // Step A: no cue yet → insert cue section with nested bullet
          if (cueLineIdx === -1) {
            const lineLen = editor.getLine(blockEnd).length;
            editor.replaceRange('\n\t- cue\n\t\t- ', { line: blockEnd, ch: lineLen });
            editor.setCursor({ line: blockEnd + 2, ch: '\t\t- '.length });
            this.enterInsertMode(editor);
            return;
          }

          // Step B: has cue but no LL output → read cue text, search, insert LL output
          if (llOutputLineIdx === -1) {
            const cueIndentLen = editor.getLine(cueLineIdx).match(/^(\s*)/)[1].length;
            let cueText = '';
            for (let i = cueLineIdx + 1; i <= blockEnd; i++) {
              const line = editor.getLine(i);
              if (!line.trim()) continue;
              if (line.match(/^(\s*)/)[1].length <= cueIndentLen) break;
              cueText += ' ' + line.replace(/^[\s\t]*-\s*/, '');
            }
            cueText = cueText.trim().toLowerCase();
            if (!cueText) return;

            const matches = [];
            const problemFiles = this.app.vault.getFiles().filter(f => f.extension === 'md');
            for (const file of problemFiles) {
              const cache = this.app.metadataCache.getFileCache(file);
              if (!cache || !cache.frontmatter) continue;
              const tags = parseFrontMatterTags(cache.frontmatter);
              if (!tags) continue;
              const matched = tags.some(tag => {
                const keyword = tag.replace(/^#/, '').toLowerCase();
                return cueText.includes(keyword);
              });
              if (matched) matches.push(`[[${file.basename}]]`);
            }

            const outputLines = matches.map(m => '\n\t\t- ' + m).join('');
            const lineLen = editor.getLine(blockEnd).length;
            editor.replaceRange('\n\t- LL output' + outputLines, { line: blockEnd, ch: lineLen });
            const newLine = blockEnd + 1 + matches.length;
            editor.setCursor({ line: newLine, ch: editor.getLine(newLine).length });
            this.enterInsertMode(editor);
            return;
          }

          // Step C: has cue and LL output but no Review → insert Review
          if (reviewLineIdx === -1) {
            const lineLen = editor.getLine(blockEnd).length;
            editor.replaceRange('\n\t- Review\n\t\t- tags: ', { line: blockEnd, ch: lineLen });
            editor.setCursor({ line: blockEnd + 2, ch: '\t\t- tags: '.length });
            this.enterInsertMode(editor);
            return;
          }

          // Find tags and pages lines within the Review block
          const reviewIndentLen = editor.getLine(reviewLineIdx).match(/^(\s*)/)[1].length;
          let tagsLineIdx = -1;
          let pagesLineIdx = -1;
          let reviewEnd = reviewLineIdx;
          for (let i = reviewLineIdx + 1; i <= blockEnd; i++) {
            const line = editor.getLine(i);
            if (!line.trim()) continue;
            if (line.match(/^(\s*)/)[1].length <= reviewIndentLen) break;
            reviewEnd = i;
            if (line.trim().startsWith('- tags:')) tagsLineIdx = i;
            if (line.trim().startsWith('- pages:')) pagesLineIdx = i;
          }

          // Step 1b: Review exists but no tags line
          if (tagsLineIdx === -1) {
            const lineLen = editor.getLine(reviewLineIdx).length;
            editor.replaceRange('\n\t\t- tags: ', { line: reviewLineIdx, ch: lineLen });
            editor.setCursor({ line: reviewLineIdx + 1, ch: '\t\t- tags: '.length });
            this.enterInsertMode(editor);
            return;
          }

          // Step 2: tags exists but no pages line
          if (pagesLineIdx === -1) {
            const lineLen = editor.getLine(tagsLineIdx).length;
            editor.replaceRange('\n\t\t\t- pages: ', { line: tagsLineIdx, ch: lineLen });
            editor.setCursor({ line: tagsLineIdx + 1, ch: '\t\t\t- pages: '.length });
            this.enterInsertMode(editor);
            return;
          }

          // Step 3: tags and pages both exist — apply tags to pages, add continuation bullet
          const tagsContent = editor.getLine(tagsLineIdx).replace(/^[\s\t]*-\s*tags:\s*/, '');
          const pagesContent = editor.getLine(pagesLineIdx).replace(/^[\s\t]*-\s*pages:\s*/, '');
          const reviewTags = tagsContent.split(',').map((t) => t.trim()).filter(Boolean);
          const pageNames = [...pagesContent.matchAll(/\[\[(.+?)\]\]/g)].map((m) => m[1].split('|')[0].trim());

          for (const pageName of pageNames) {
            const file = this.app.vault.getFiles().find((f) => f.basename === pageName);
            if (!file) continue;
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              if (!fm.tags) fm.tags = [];
              for (const tag of reviewTags) {
                if (!fm.tags.includes(tag)) fm.tags.push(tag);
              }
            });
          }

          const lastReviewLine = editor.getLine(reviewEnd).trim();
          const isTagsOrPages = lastReviewLine.startsWith('- tags:') || lastReviewLine.startsWith('- pages:');
          if (isTagsOrPages) {
            const lineLen = editor.getLine(reviewEnd).length;
            editor.replaceRange('\n\t\t- ', { line: reviewEnd, ch: lineLen });
            editor.setCursor({ line: reviewEnd + 1, ch: '\t\t- '.length });
          } else {
            editor.setCursor({ line: reviewEnd, ch: editor.getLine(reviewEnd).length });
          }
          this.enterInsertMode(editor);
          return;
        }

        // Empty line: insert a "Learning Loop Trace" block with nested bullet
        // But not if we're already indented inside a Learning Loop Trace block
        const currentLineIndented = editor.getLine(cursor.line).match(/^\s/);
        if (!text.replace(/[-\s]/g, '') && !(insideBlock && currentLineIndented)) {
          const insertion = '- [[Learning Loop Trace]]\n\t- cue\n\t\t- ';
          const lineLen = editor.getLine(cursor.line).length;
          editor.replaceRange(insertion, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: lineLen });
          editor.setCursor({ line: cursor.line + 2, ch: '\t\t- '.length });
          this.enterInsertMode(editor);
          return;
        }

        const selectionLower = text.toLowerCase();
        const matches = [];

        const problemFiles = this.app.vault.getFiles().filter(
          (f) => f.extension === 'md'
        );

        for (const file of problemFiles) {
          const cache = this.app.metadataCache.getFileCache(file);
          if (!cache || !cache.frontmatter) continue;

          const tags = parseFrontMatterTags(cache.frontmatter);
          if (!tags) continue;

          const matched = tags.some((tag) => {
            const keyword = tag.replace(/^#/, '').toLowerCase();
            return selectionLower.includes(keyword);
          });

          if (matched) {
            const name = file.basename;
            matches.push(`[[${name}]]`);
          }
        }

        if (matches.length === 0) return;

        const endCursor = editor.getCursor('to');
        const currentLine = editor.getLine(endCursor.line);
        const lineEnd = currentLine.length;

        // Match leading whitespace and optional list marker (- or *)
        const prefixMatch = currentLine.match(/^(\s*(?:[-*]\s)?)/);
        const prefix = prefixMatch ? prefixMatch[1] : '';

        const output = matches.map((m) => prefix + m).join('\n');
        const insertion = '\n' + output + '\n' + prefix;
        editor.replaceRange(insertion, { line: endCursor.line, ch: lineEnd });

        const newLine = endCursor.line + matches.length + 1;
        editor.setCursor({ line: newLine, ch: prefix.length });
        this.enterInsertMode(editor);
      },
    });

  }

  onunload() {}
}

module.exports = LearningLoopPlugin;
