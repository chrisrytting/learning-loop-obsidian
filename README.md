This plugin helps you efficiently solve problems you often face. You write down a problem you're facing and the plugin finds notes you've written about related problems in the past — including what solved them.

# A Concrete Example

Let's say it's Jan 15 and you realize you're feeling stressed, and it's unpleasant so you want to feel more calm. You've dealt with stress before and have an `[[Stress]]` page in your Obsidian vault (i.e., your personal database of notes) (inside a `Problems/` folder) that tracks what's worked and what hasn't:

> - solutions
> 	- Journal for 20 minutes
> 		- Tried Dec 3, 2025. Worked great
> - ineffective solutions
> 	- breathwork
> 		- Tried Dec 3, 2025. Still felt awful

That page is your personal knowledge base for stress — built up from real experience, not generic advice.

Now it's Jan 15 and you're in your daily note. You write:

> Feeling really stressed this morning.

Without this plugin, you might manually search for your `[[Stress]]` page, open it, and read through it to see what's worked before. In reality, you probably have related solutions in other pages too, like `[[Anxiety]]`, `[[Overwhelm]]`, etc. But it's tedious to manually navigate to all these pages and keep track of which one helped.

Here's where this plugin helps: it helps you successfully execute a "**Learning Loop Trace**", which is where you write down your current problem, find related pages, try the solutions they suggest, and update your library so future-you benefits from today's experience, over time building up a library of wisdom about how to solve problems you often face.

Instead of manually navigating to `[[Stress]]`, press `⌘L`. The plugin sees the word "stressed" in your note, matches it against the tags on your Problems/ pages, and inserts `[[Stress]]` right there. You can glance (either by hovering over the link while holding command, or by opening it in a new tab, or by clicking on it) at what's worked before, and try doing that now. You can also try new solutions and see whether they help. You can also brainstorm other related pages by typing `[[` and typing the title of other notes you've made to track problems and their solutions. As you read these pages, you write in the current trace your experience and observations. 

 Then  write what you tried today, and press `⌘L` a few more times to tag the page — updating your library so future-you benefits from today's experience.


# How it works

> **Assumption:** This guide assumes you have already mapped **Learning Loop Step** to `⌘L` in Obsidian's Hotkeys settings (`⌘,` → Hotkeys → search "Learning Loop Step"). You can use any hotkey you like, but `⌘L` is what's used throughout.

The plugin exposes a single command: **Learning Loop Step**. You press it repeatedly and it advances through a sequence of stages depending on where your cursor is. Each press does exactly one thing and leaves your cursor ready for the next.

The stages all happen inside a **Learning Loop Trace** — a structured block in your daily note that captures a moment, links it to your problem library, and records your review. It looks like this when complete:

```
- Learning Loop Trace
	- Feeling really stressed this morning.
	- [[Stress]]
	- Review
		- tags: stress, stress
			- pages: [[Stress]]
```

Here's how you get there, one `⌘L` at a time:

### Stage 1 — Empty line → start a trace

Press `⌘L` on an **empty line**. The plugin inserts the trace block header and drops your cursor inside it:

```
- Learning Loop Trace
	-
```

Type whatever you're experiencing. This is your raw observation — the thing that happened.

### Stage 2 — Text on line → surface matching problem pages

Press `⌘L` while your cursor is on a **line with text** (or with text selected). The plugin scans your `Problems/` folder and checks whether any of their frontmatter `tags` appear in your text. If something matches, it inserts the wiki-link below your line:

```
Feeling really stressed this morning.
[[Stress]]
```

This is the link back to your personal knowledge base for that problem. Open it to see what's worked before, then come back and write what you tried today.

### Stage 3 — Inside the trace block → add a Review section

Press `⌘L` while your cursor is **inside** the trace block. The plugin appends a `Review` section with a `tags:` prompt:

```
- Learning Loop Trace
	- Feeling really stressed this morning.
	- [[Stress]]
	- Review
		- tags:
```

Fill in the tags you want to assign to your problem pages (e.g. `stress, stress`). This is how you keep your library up to date — tagging pages makes them easier to find and query later.

### Stage 4 — `tags:` filled → add a `pages:` prompt

Press `⌘L` again. The plugin adds a `pages:` line below `tags:`:

```
		- tags: stress, stress
			- pages:
```

Type the wiki-links of the pages you want to tag (e.g. `[[Stress]]`). These are the Problems/ pages that should receive the tags you just wrote.

### Stage 5 — Both filled → write tags to page frontmatter

Press `⌘L` one final time. The plugin reads your `tags:` and `pages:` lines and writes those tags into the YAML frontmatter of each linked page (skipping duplicates). Your cursor lands on a new bullet, ready for your next note.

Now `[[Stress]]` has updated frontmatter tags — making it findable via search, graph view, and Dataview queries next time stress comes up.

---

## Quick Reference

| Cursor position | `⌘L` does |
|---|---|
| Empty line | Insert `Learning Loop Trace` block |
| Line with text | Find matching `Problems/` pages and insert links |
| Inside block, no Review | Add `Review` + `tags:` prompt |
| Inside block, `tags:` filled | Add `pages:` prompt |
| Inside block, both filled | Write tags to page frontmatter |

---

## Setup

1. Create a `Problems/` folder at the root of your vault. Put your problem/topic pages inside it (e.g. `Problems/Stress.md`, `Problems/Nausea.md`).
2. Add frontmatter `tags` to each problem page — these are the keywords the plugin matches against:

```yaml
---
tags:
  - stress
  - stress
---
```

3. Assign `⌘L` (or any hotkey) to **Learning Loop Step** in Obsidian's Hotkeys settings.


# FAQs

> Why wouldn't I just ask AI or Google how to solve these problems?

You could! But AI is better for exploring new solutions than for tracking what *you* know has worked before. It's inclined to make things up or leave things out when reading over a big chunk of personal notes. Your Problems/ pages are grounded in your actual experience — that's harder to fake. But if you don't believe me, try it and let me know how the experiment goes!

Roadmap is to expand beyond Pains and Solutions.


[^1]: Learning loop is a general philosophy and framework for not forgetting wisdom you happen upon over the course of your life. See the [Learning Loop Podcast YouTube channel](https://www.youtube.com/@christopherrytting) for a primer.
