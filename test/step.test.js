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

    const { step } = createPlugin();
    await step(editor);

    // Should have advanced the first trace (e.g. added Review section),
    // NOT created a brand-new trace
    expect(lines(editor).join('\n')).toContain('- Review');
    expect(lines(editor).join('\n')).not.toMatch(/^- \[\[Learning Loop Trace\]\].*- \[\[Learning Loop Trace\]\]/s);
  });

  test('cursor on empty line after first trace starts a new trace', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- first content',
      '\t- Review',
      '\t\t- tags: foo',
      '\t\t- pages: [[SomePage]]',
      '',                          // cursor here (line 5)
    ], 5, 0);

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    // A new trace should have been inserted at line 5, not a continuation of the first
    expect(doc[5]).toBe('- [[Learning Loop Trace]]');
    expect(doc[6]).toBe('\t- ');
    // Cursor should be inside the new trace, not back in the first one
    expect(cursor(editor).line).toBe(6);
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

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    // A new Review should have been appended after the SECOND trace's content (line 5+)
    const reviewLine = doc.lastIndexOf('\t- Review');
    expect(reviewLine).toBeGreaterThan(5); // after line 5 (second trace header)
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

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    // Should NOT have added a continuation bullet inside the first trace's review
    const firstReviewContent = doc.slice(2, 5).join('\n');
    expect(firstReviewContent).not.toContain('\t\t- \n');
    // The first trace should be unchanged
    expect(doc[4]).toBe('\t\t- pages: [[SomePage]]');
  });
});

// ─── happy path ──────────────────────────────────────────────────────────────

describe('step state machine', () => {
  test('empty line → inserts new Learning Loop Trace block', async () => {
    const editor = createEditor([''], 0, 0);
    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[0]).toBe('- [[Learning Loop Trace]]');
    expect(doc[1]).toBe('\t- ');
    expect(cursor(editor)).toEqual({ line: 1, ch: 3 });
  });

  test('trace with text but no Review → inserts Review + tags prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',             // cursor here (line 1)
    ], 1, 5);

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[2]).toBe('\t- Review');
    expect(doc[3]).toBe('\t\t- tags: ');
    expect(cursor(editor)).toEqual({ line: 3, ch: '\t\t- tags: '.length });
  });

  test('Review exists but no tags → inserts tags prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- Review',                // cursor here (line 2)
    ], 2, 5);

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[3]).toBe('\t\t- tags: ');
    expect(cursor(editor)).toEqual({ line: 3, ch: '\t\t- tags: '.length });
  });

  test('tags exists but no pages → inserts pages prompt', async () => {
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- Review',
      '\t\t- tags: stress',        // cursor here (line 3)
    ], 3, 5);

    const { step } = createPlugin();
    await step(editor);

    const doc = lines(editor);
    expect(doc[4]).toBe('\t\t\t- pages: ');
    expect(cursor(editor)).toEqual({ line: 4, ch: '\t\t\t- pages: '.length });
  });

  test('tags and pages both filled → applies tags and adds continuation bullet', async () => {
    const stressPage = { basename: 'Stress', frontmatter: { tags: [] } };
    const editor = createEditor([
      '- [[Learning Loop Trace]]',
      '\t- some text',
      '\t- Review',
      '\t\t- tags: stress',
      '\t\t- pages: [[Stress]]',   // cursor here (line 4)
    ], 4, 5);

    const { step } = createPlugin([stressPage]);
    await step(editor);

    // Tags applied to the linked page
    expect(stressPage.frontmatter.tags).toContain('stress');

    const doc = lines(editor);
    expect(doc[5]).toBe('\t\t- ');
    expect(cursor(editor)).toEqual({ line: 5, ch: '\t\t- '.length });
  });
});
