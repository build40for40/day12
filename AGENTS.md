# Day 12

Day 12 of 40 for 40, built live on Twitch on Tuesday 17 November 2026. The problem is "Imagining a hopeful AI future", from Samira. Work is tracked on the Superthread `day12` board and the "Day 12" page.

- **Form factor:** Agent.
- **Name:** the app doesn't have one yet, so the repo is `day12` until it does. Once it's named, anything web-facing is served at `build40for40.com/<app>/`.

Shared 40 for 40 context lives in `../AGENTS.md`.

## The problem

Feel optimistic and inspired about the world we are creating with the use of Ai.
A solution could be…
Eg create a world building game cf minecraft where we can simulate and envisage the future for people, communities and the planet

## The brief

From the "Day 12 - Brief & prep" page on Superthread. The team picked a **positive AI news agent**: a morning brief with five hopeful stories a day about AI and scientific progress, built to counter the brain's bias towards bad news. Think "Morning Brew", but optimistic. Human stories beat productivity rhetoric.

An agent here means something with tools (APIs, data, actions), not just a chat or voice front end. Hosted agent kits are fine, so there's no infrastructure to run.

### The pipeline

Build the engine first and pick where it publishes after:

1. **Sources:** university press releases are the richest. EurekAlert collects them and has an AI Spotlight section with an RSS feed, but it doesn't say whether a story is positive. Also conservation groups, charities and lab blogs.
2. **Reverse real news:** take a major publication's story (data centres, say) and find the honest positive angle in the technology behind it, like data centre water cooling ending up in air conditioning. Don't manufacture news out of non-news.
3. **Quality filter:** does the story get featured at all?
4. **Scoring:** did it happen, might it happen, or is it only promised? How strong is the evidence? Is there a real person or place? Is the day balanced across climate, space, health and so on?
5. **Fact-check** every story that makes the cut.
6. **Format:** short items, about 200 words, or a 140-character hit.
7. **Publish:** see below.

Keep about 30 evergreen stories banked as a fallback for thin days. Prompts and evals are part of the plumbing, not an afterthought.

### Where it publishes

Not chosen yet. The front runners can go live the same day: SMS or text, an RSS feed or podcast, or a website with an email digest. These were ruled out for today because review takes too long: ChatGPT and Claude Code plugins, Alexa skills and podcast directory listings. On X, posting from our own account is fine, but automated replies to keyword searches aren't allowed without approval.
