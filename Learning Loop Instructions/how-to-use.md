This Obsidian Plugin helps you keep track of the behaviors that do and don't work to solve the problems you experience in your own life. I built this because I often forget the things that work best for me, but navigating my notes where I've kept track of what does and doesn't work is super hard. This makes it easy.

# A Concrete Example
Here's a concrete example (skip to "How it works" if you just want to know that :) ): Let's say I'm living my life on Jan 15 and suddenly I notice I'm feeling very anxious. It's unpleasant. I ask "How can I feel less anxious?" I try breathwork, and it doesn't calm me down. I try just plowing through the feeling, it doesn't calm me down. I finally try stopping and journaling for 20 minutes, and it calms me down. The pain here was anxiety, and the ineffective solutions were 

So I would add the following content to an [[Anxiety]] page in my graph.
> - solutions
> 	- Journal for 20 minutes
> 		- Tried on Jan 15, 2026. Worked great
> - ineffective solutions
> 	- breathwork
> 		- Tried on Jan 15, 2026. Still felt awful
> 	- ignore the feeling, plow through
> 		- Tried on Jan 15, 2026. Still felt awful

Now I have a resource (the [[Anxiety]] page) for solving anxiety, grounded in what's worked and hasn't worked in the past.

I can also continue gathering data (e.g., if I try these solutions again on Feb 3, a few weeks later, I could add my observations on how well they work then, fleshing out the [[Anxiety]] page.)

Additionally, I might have these solutions spread out over several relevant pages, e.g., similar negative pages such as [[Legacy Tiny Obsidian/Stress]], [[Overwhelmed]], as well as related but non-synonymic pages such as [[Calm]] and [[Focus]].

Here's where this plugin helps.


# How it works
You install this plugin, and now you can execute a command called `Learning Loop: Main Command`
To run it, do `Command + P`, search for the command by typing part of it, and select it. However, doing this everytime, is tedious, so I recommend mapping it this command to a hotkey (I use `Command + L`). 

Clicking this allows you to step through a "Learning Loop Trace", which basically means proceed through several steps (by repeatedly executing this command / hotkey) of the following process
1. Start on a blank line
2. Explain your current context (e.g., "I'm stressed")
3. Retrieve related pages (those that have frontmatter tags matching any of the words in your query)
4. You consult the retrieved pages and write down what does/doesn't resonate
5. You add new/existing tags to be assigned to new/existing pages.


# FAQs

> Why wouldn't I just ask AI or google how to solve these problems?

You could! But it's better for exploring new solutions than for tracking what you know has worked before, since it's so inclined to make things up or leave things out, when it's reading over a big chunk of text, like all the notes you keep on pains/solutions. But if you don't believe me, you should definitely try it to prove me right or wrong (either way, let me know how the experiment goes!)

Roadmap is to expand beyond Pains and Solutions


[^1]: Learning loop is a general philosophy and framework for not forgetting wisdom you happen upon over the course of your life. See the [Learning Loop Podcast YouTube channel](https://www.youtube.com/@christopherrytting) for a primer.
