'use strict';

const LearningLoopPlugin = require('../main.js');

function makeLeaf(id) {
  return { id };
}

function makeContainer(leafIds) {
  const children = leafIds.map(makeLeaf);
  return { children };
}

function createMockWorkspace({ paneCount, activePane }) {
  const rootChildren = [];
  for (let i = 0; i < paneCount; i++) {
    rootChildren.push(makeContainer([`leaf-${i}`]));
  }

  const setActiveLeafCalls = [];
  const getLeafCalls = [];

  const workspace = {
    rootSplit: { children: rootChildren },
    activeLeaf: { ...rootChildren[activePane].children[0], parent: rootChildren[activePane] },
    setActiveLeaf(leaf, opts) {
      setActiveLeafCalls.push({ leaf, opts });
    },
    getLeaf(type, direction) {
      const newLeaf = makeLeaf('new-split-leaf');
      const newContainer = makeContainer([]);
      newContainer.children.push(newLeaf);
      rootChildren.push(newContainer);
      getLeafCalls.push({ type, direction });
      return newLeaf;
    },
  };

  return { workspace, rootChildren, setActiveLeafCalls, getLeafCalls };
}

function createPlugin(workspace) {
  const plugin = new LearningLoopPlugin();
  plugin.app = { workspace };
  plugin.manifest = { dir: '/mock' };
  return plugin;
}

describe('smartOpenRightPane', () => {
  test('with 3 panes, focus on pane 0 → focuses pane 1 (right neighbor)', () => {
    const { workspace, rootChildren, setActiveLeafCalls, getLeafCalls } = createMockWorkspace({ paneCount: 3, activePane: 0 });
    const plugin = createPlugin(workspace);

    const result = plugin.smartOpenRightPane();

    expect(result.created).toBe(false);
    expect(getLeafCalls).toHaveLength(0);
    expect(setActiveLeafCalls).toHaveLength(1);
    expect(setActiveLeafCalls[0].leaf).toBe(rootChildren[1].children[0]);
  });

  test('with 3 panes, focus on pane 1 → focuses pane 2 (right neighbor)', () => {
    const { workspace, rootChildren, setActiveLeafCalls, getLeafCalls } = createMockWorkspace({ paneCount: 3, activePane: 1 });
    const plugin = createPlugin(workspace);

    const result = plugin.smartOpenRightPane();

    expect(result.created).toBe(false);
    expect(getLeafCalls).toHaveLength(0);
    expect(setActiveLeafCalls).toHaveLength(1);
    expect(setActiveLeafCalls[0].leaf).toBe(rootChildren[2].children[0]);
  });

  test('with 3 panes, focus on pane 2 (rightmost) → creates a new pane', () => {
    const { workspace, setActiveLeafCalls, getLeafCalls } = createMockWorkspace({ paneCount: 3, activePane: 2 });
    const plugin = createPlugin(workspace);

    const result = plugin.smartOpenRightPane();

    expect(result.created).toBe(true);
    expect(getLeafCalls).toHaveLength(1);
    expect(getLeafCalls[0]).toEqual({ type: 'split', direction: 'vertical' });
    expect(setActiveLeafCalls).toHaveLength(1);
    expect(setActiveLeafCalls[0].leaf.id).toBe('new-split-leaf');
  });

  test('with 1 pane → creates a new pane', () => {
    const { workspace, setActiveLeafCalls, getLeafCalls } = createMockWorkspace({ paneCount: 1, activePane: 0 });
    const plugin = createPlugin(workspace);

    const result = plugin.smartOpenRightPane();

    expect(result.created).toBe(true);
    expect(getLeafCalls).toHaveLength(1);
    expect(setActiveLeafCalls).toHaveLength(1);
    expect(setActiveLeafCalls[0].leaf.id).toBe('new-split-leaf');
  });

  test('with 2 panes, focus on pane 0 → focuses pane 1, does not create', () => {
    const { workspace, rootChildren, setActiveLeafCalls, getLeafCalls } = createMockWorkspace({ paneCount: 2, activePane: 0 });
    const plugin = createPlugin(workspace);

    const result = plugin.smartOpenRightPane();

    expect(result.created).toBe(false);
    expect(getLeafCalls).toHaveLength(0);
    expect(setActiveLeafCalls[0].leaf).toBe(rootChildren[1].children[0]);
  });
});
