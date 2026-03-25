'use strict';

/**
 * Creates a mock Obsidian editor backed by an array of strings.
 * Supports the subset of the editor API used by the Step command.
 */
function createEditor(lines, cursorLine = 0, cursorCh = 0) {
  const doc = [...lines];
  let cursor = { line: cursorLine, ch: cursorCh };

  return {
    _doc: doc,
    _getCursor: () => ({ ...cursor }),

    getSelection: () => '',
    getCursor: (which) => ({ ...cursor }),
    getLine: (i) => (i >= 0 && i < doc.length ? doc[i] : ''),
    lineCount: () => doc.length,

    replaceRange(text, from, to) {
      const toPos = to || from;
      const beforeFrom = doc[from.line].slice(0, from.ch);
      const afterTo = doc[toPos.line].slice(toPos.ch);
      const newContent = beforeFrom + text + afterTo;
      const newLines = newContent.split('\n');
      doc.splice(from.line, toPos.line - from.line + 1, ...newLines);
    },

    setCursor(pos) {
      cursor = { line: pos.line, ch: pos.ch };
    },
  };
}

/**
 * Instantiates the plugin and returns the async editorCallback for the Step command.
 * Accepts an optional `files` array for vault/metadata mocking.
 */
function createPlugin(files = []) {
  const LearningLoopPlugin = require('../main.js');

  let capturedCallback = null;

  const app = {
    commands: { executeCommandById: () => {} },
    vault: {
      getFiles: () => files.map((f) => ({ extension: 'md', basename: f.basename })),
    },
    metadataCache: {
      getFileCache: (file) => {
        const entry = files.find((f) => f.basename === file.basename);
        return entry ? { frontmatter: entry.frontmatter } : null;
      },
    },
    fileManager: {
      processFrontMatter: async (file, fn) => {
        const entry = files.find((f) => f.basename === file.basename);
        if (entry) fn(entry.frontmatter);
      },
    },
  };

  const plugin = new LearningLoopPlugin();
  plugin.app = app;
  plugin.enterInsertMode = () => {};
  plugin.addRibbonIcon = () => {};
  plugin.addCommand = ({ editorCallback }) => {
    capturedCallback = editorCallback;
  };

  plugin.onload();

  return { step: (editor) => capturedCallback(editor) };
}

module.exports = { createEditor, createPlugin };
