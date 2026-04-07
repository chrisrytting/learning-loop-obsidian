'use strict';

const { createEditor, createPlugin } = require('./helpers');

// ─── helpers ────────────────────────────────────────────────────────────────

function lines(doc) {
  return doc._doc;
}

function cursor(editor) {
  return editor._getCursor();
}

// ─── block-detection ────────────────────────────────────────────────────────

describe('block detection', () => {
  test('cursor on empty line after first trace starts a new trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- first content',
      '\t- User Thought / Feeling',
      '\t\t- my thought',
      '\t- User Response',
      '\t\t- my response',
      '\t- Learning Loop Output',
      '\t- Review',
      '',                          // cursor here (line 8)
    ], 8, 0);

    const { help } = await createPlugin();
    await help(editor);

    const doc = lines(editor);
    expect(doc[8]).toBe('- [[Learning Loop Trace]] %% fold %%');
    expect(doc[9]).toBe('\t- User Thought / Feeling');
    expect(cursor(editor).line).toBe(10);
  });

  test('cursor on second trace header does not operate on first trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- first content',
      '\t- Review',
      '\t\t- tags: foo',
      '\t\t- pages: [[SomePage]]',
      '- [[Learning Loop Trace]]', // cursor here (line 5)
    ], 5, 0);

    const { help } = await createPlugin();
    await help(editor);

    const doc = lines(editor);
    expect(doc[4]).toBe('\t\t- pages: [[SomePage]]');
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe('help state machine', () => {
  test('empty line → inserts trace with User Thought / Feeling', async () => {
    const editor = createEditor([''], 0, 0);
    const { help } = await createPlugin();
    await help(editor);

    const doc = lines(editor);
    expect(doc[0]).toBe('- [[Learning Loop Trace]] %% fold %%');
    expect(doc[1]).toBe('\t- User Thought / Feeling');
    expect(doc[2]).toBe('\t\t- ');
    expect(cursor(editor)).toEqual({ line: 2, ch: 4 });
  });

  test('highlighted text → creates trace with thought and User Response prompt', async () => {
    const editor = createEditor(
      ["I'm stressed"],
      0, 0,
      { text: "I'm stressed", from: { line: 0, ch: 0 }, to: { line: 0, ch: 12 } }
    );

    const { help } = await createPlugin();
    await help(editor);

    const doc = lines(editor);
    expect(doc[0]).toBe('- [[Learning Loop Trace]] %% fold %%');
    expect(doc[1]).toBe('\t- User Thought / Feeling');
    expect(doc[2]).toBe("\t\t- I'm stressed");
    expect(doc[3]).toBe('\t- User Response');
    expect(doc[4]).toBe('\t\t- ');
    // Cursor on blank bullet under "User Response"
    expect(cursor(editor)).toEqual({ line: 4, ch: '\t\t- '.length });
  });

  test('trace with User Response → retrieves pages from mentioned Problem pages and inserts Learning Loop Output', async () => {
    const stressPage = {
      basename: 'Stress',
      path: 'Problems/Stress.md',
      frontmatter: { 'Retrieve Pages': ['[[Problems/Anxiety|Anxiety]]', '[[Problems/Burnout|Burnout]]'] },
    };
    const anxietyPage = { basename: 'Anxiety', path: 'Problems/Anxiety.md', frontmatter: {} };
    const burnoutPage = { basename: 'Burnout', path: 'Problems/Burnout.md', frontmatter: {} };
    const editor = createEditor([
      '- [[Learning Loop Trace]] %% fold %%',
      '\t- User Thought / Feeling',
      "\t\t- I'm feeling [[Stress]]",
      '\t- User Response',
      '\t\t- I need to relax',       // cursor here (line 4)
    ], 4, 5);

    const { help } = await createPlugin([stressPage, anxietyPage, burnoutPage]);
    await help(editor);

    const doc = lines(editor);
    expect(doc[5]).toBe('\t- Learning Loop Output');
    expect(doc[6]).toBe('\t\t- [[Problems/Anxiety|Anxiety]]');
    expect(doc[7]).toBe('\t\t- [[Problems/Burnout|Burnout]]');
    expect(doc[8]).toBe('\t- Review');
    expect(doc[9]).toBe('\t\t- ');
    // Cursor on blank bullet under "Review"
    expect(cursor(editor)).toEqual({ line: 9, ch: '\t\t- '.length });
  });

  test('exiting trace writes query to all pages mentioned anywhere in the trace', async () => {
    const stressPage = { basename: 'Stress', path: 'Problems/Stress.md', frontmatter: {} };
    const anxietyPage = { basename: 'Anxiety', path: 'Problems/Anxiety.md', frontmatter: {} };
    const burnoutPage = { basename: 'Burnout', path: 'Problems/Burnout.md', frontmatter: {} };
    const editor = createEditor([
      '- [[Learning Loop Trace]] %% fold %%',
      '\t- User Thought / Feeling',
      "\t\t- I'm feeling [[Stress]]",
      '\t- User Response',
      '\t\t- I need to relax',
      '\t- Learning Loop Output',
      '\t\t- [[Anxiety]]',
      '\t\t- [[Burnout]]',
      '\t- Review',
      '\t\t- reviewed',                // cursor here (line 9)
    ], 9, 0);

    const { help } = await createPlugin([stressPage, anxietyPage, burnoutPage]);
    await help(editor);

    // Query should have been written to all pages in the trace (thought + output)
    expect(stressPage.frontmatter['Queries']).toEqual(["I'm feeling [[Stress]]"]);
    expect(anxietyPage.frontmatter['Queries']).toEqual(["I'm feeling [[Stress]]"]);
    expect(burnoutPage.frontmatter['Queries']).toEqual(["I'm feeling [[Stress]]"]);
  });

  test('exiting trace does not duplicate existing queries', async () => {
    const anxietyPage = {
      basename: 'Anxiety',
      path: 'Problems/Anxiety.md',
      frontmatter: { 'Queries': ["I'm feeling stressed"] },
    };
    const editor = createEditor([
      '- [[Learning Loop Trace]] %% fold %%',
      '\t- User Thought / Feeling',
      "\t\t- I'm feeling stressed",
      '\t- User Response',
      '\t\t- I need to relax',
      '\t- Learning Loop Output',
      '\t\t- [[Anxiety]]',
      '\t- Review',
      '\t\t- reviewed',
    ], 8, 0);

    const { help } = await createPlugin([anxietyPage]);
    await help(editor);

    expect(anxietyPage.frontmatter['Queries']).toEqual(["I'm feeling stressed"]);
  });
});
