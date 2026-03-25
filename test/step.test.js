'use strict';

const { createEditor, createPlugin } = require('./helpers');

// ─── helpers ────────────────────────────────────────────────────────────────

function lines(doc) {
  return doc._doc;
}

function cursor(editor) {
  return editor._getCursor();
}

// ─── block-detection (the bug fix) ──────────────────────────────────────────

describe('block detection', () => {
  test('cursor inside first trace is detected as inside that trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',           // cursor here (line 1)
    ], 1, 5);

    const { step } = await createPlugin();
    await step(editor);

    // Should have advanced the first trace (inserted cue section),
    // NOT created a brand-new trace
    expect(lines(editor).join('\n')).toContain('- cue');
    expect(lines(editor).join('\n')).not.toMatch(/^- \[\[Learning Loop Trace\]\].*- \[\[Learning Loop Trace\]\]/s);
  });

  test('cursor on empty line after first trace starts a new trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- first content',
      '\t- cue',
      '\t\t- my cue text',
      '\t- LL output',
      '\t- Review',
      '\t\t- tags: foo',
      '\t\t- pages: [[SomePage]]',
      '',                          // cursor here (line 8)
    ], 8, 0);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    // A new trace should have been inserted at line 8, not a continuation of the first
    expect(doc[8]).toBe('- [[Learning Loop Trace]]');
    expect(doc[9]).toBe('\t- cue');
    // Cursor should be inside the new trace's cue
    expect(cursor(editor).line).toBe(10);
  });

  test('cursor inside second of two adjacent traces advances the second trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- first content',
      '\t- Review',
      '\t\t- tags: foo',
      '\t\t- pages: [[SomePage]]',
      '- [[Learning Loop Trace]]',
      '\t- second content',        // cursor here (line 6)
    ], 6, 5);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    // Cue should have been appended after the SECOND trace's content
    const cueLine = doc.lastIndexOf('\t- cue');
    expect(cueLine).toBeGreaterThan(5);
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

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    // The first trace should be unchanged
    expect(doc[4]).toBe('\t\t- pages: [[SomePage]]');
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe('step state machine', () => {
  test('empty line → inserts Learning Loop Trace block with cue', async () => {
    const editor = createEditor([''], 0, 0);
    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[0]).toBe('- [[Learning Loop Trace]]');
    expect(doc[1]).toBe('\t- cue');
    expect(doc[2]).toBe('\t\t- ');
    expect(cursor(editor)).toEqual({ line: 2, ch: 4 });
  });

  test('trace with no cue → inserts cue section', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',             // cursor here (line 1)
    ], 1, 5);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[2]).toBe('\t- cue');
    expect(doc[3]).toBe('\t\t- ');
    expect(cursor(editor)).toEqual({ line: 3, ch: 4 });
  });

  test('trace with cue and LL output but no Review → inserts Review + tags prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- cue',
      '\t\t- feeling stressed',
      '\t- LL output',
      '\t\t- [[Stress]]',          // cursor here (line 5)
    ], 5, 5);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[6]).toBe('\t- Review');
    expect(doc[7]).toBe('\t\t- tags: ');
    expect(cursor(editor)).toEqual({ line: 7, ch: '\t\t- tags: '.length });
  });

  test('Review exists but no tags → inserts tags prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- cue',
      '\t\t- some cue',
      '\t- LL output',
      '\t- Review',                // cursor here (line 5)
    ], 5, 5);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[6]).toBe('\t\t- tags: ');
    expect(cursor(editor)).toEqual({ line: 6, ch: '\t\t- tags: '.length });
  });

  test('tags exists but no pages → inserts pages prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- cue',
      '\t\t- some cue',
      '\t- LL output',
      '\t- Review',
      '\t\t- tags: stress',        // cursor here (line 6)
    ], 6, 5);

    const { step } = await createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[7]).toBe('\t\t\t- pages: ');
    expect(cursor(editor)).toEqual({ line: 7, ch: '\t\t\t- pages: '.length });
  });

  test('tags and pages both filled → applies tags and adds continuation bullet', async () => {
    const stressPage = { basename: 'Stress', path: 'Problems/Stress.md', frontmatter: { tags: [] } };
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- cue',
      '\t\t- some cue',
      '\t- LL output',
      '\t- Review',
      '\t\t- tags: stress',
      '\t\t- pages: [[Stress]]',   // cursor here (line 7)
    ], 7, 5);

    const { step } = await createPlugin([stressPage]);
    await step(editor);

    // Tags applied to the linked page
    expect(stressPage.frontmatter.tags).toContain('stress');

    const doc = lines(editor);
    expect(doc[8]).toBe('\t\t- ');
    expect(cursor(editor)).toEqual({ line: 8, ch: '\t\t- '.length });
  });
});
