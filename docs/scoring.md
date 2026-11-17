# Scoring and quality filter

How a story gets from a source into the daily five. The model-facing version is `prompts/score-story.md`, and the cases that check it are in `evals/stories.json`.

There are three layers, because the criteria do three different jobs:

1. **Gates** decide whether a story is allowed in at all. Pass or fail, no points.
2. **Scores** rank the stories that passed.
3. **The day mix** picks five from the ranked list so the day is varied.

There are also two lanes. Most stories are **good news** (something good happened and AI was the reason). A few are **flips** (a bad AI story in the popular news that has an honest good side). Flips go through every gate the good news does, plus three of their own.

## Layer 1: gates

A story that fails any gate is dropped, with the gate named so we can see why.

| Gate | Passes when | Typical fail |
| --- | --- | --- |
| It happened | There is a result, not a prediction. A pilot that has started counts | "could", "may", "promises to", "set to revolutionise", a trial that is only planned |
| The source checks out | The primary source is opened and says what the headline says | Mouse study sold as a cure, a newsletter summary nobody traced back |
| Enough evidence | Peer-reviewed, a trial result, or in real use. A paper that has not been peer-reviewed never counts | Preprint, working paper, press release with no paper |
| Independent for company claims | A company's claim has one source that isn't the company | Lab blog post on its own |
| AI is the reason | Take the AI away and the story disappears. The source itself must call it AI or machine learning | "The hospital also uses AI", ordinary statistics called AI, software the source only calls "autonomous" or "computer vision" |
| It's about the world | Something changed for a person, place or field outside the AI industry | Funding rounds, model launches, benchmarks, executive moves |
| It's fresh | The story first appeared in the last 90 days, even if the tool behind it is older, or it comes from the evergreen bank | A 2019 result doing the rounds again |
| It can be said plainly | What happened fits in two or three plain sentences a non-specialist would follow | Needs jargon or a paragraph of context to make sense |

The plain gate is tested by writing the handoff below. If the agent can't write "what happened" plainly, the story fails.

### Extra gates for flips

| Gate | Passes when | Typical fail |
| --- | --- | --- |
| Nobody was hurt | No person was killed, physically injured, abused or defrauded in the original story, named or not. A company being hacked or sued doesn't count. Job losses and shortages are judged by the "doesn't shrink the harm" gate instead. Checked first | A scam victim, a self-harm case, a crash |
| The good side is its own fact | It is a separate, sourced fact, not an opinion about the bad story. It can sit in the same article: a lawsuit over a hack is a separate fact from the hack | "This shows how capable AI is", "AI might fix this one day" |
| It doesn't shrink the harm | The line admits the bad news, then adds to it | "It's not that bad", "but think of the productivity" |

Two of the main gates read differently for a flip. "AI is the reason" passes when the bad story is about AI or the things built to run it, such as data centres. "It's about the world" passes when the bad story reached the popular news.

A flip must also be one of these four kinds:

- **The system is responding:** a court, regulator or law is acting on the problem.
- **Owning up:** the people responsible disclosed it themselves, in public.
- **The fix:** a specific fix has shipped because of the problem.
- **Same technology, other side:** the same technology has a documented good use, with its own source.

## Layer 2: scores

Each score is 0 to 3. Multiply by the weight and add up. The top mark is 24.

| Score | Weight | 0 | 3 |
| --- | --- | --- | --- |
| Mass appeal | 3 | Only a specialist would care | Someone who doesn't work in tech would repeat it to a friend |
| Real person or place | 2 | "Stakeholders", "users" | A named place or a kind of person you can picture |
| Stage | 2 | (1) in the lab | (3) helping people now, with (2) in a trial between |
| Surprise | 1 | Heard it before | "I didn't know AI could do that" |

For flips, swap Surprise for **How well known the bad story is**, same weight. A flip only works if people have already seen the bad headline.

Mass appeal carries the most weight on purpose. The best evidence in the world doesn't help if nobody outside the field cares, and the evidence is already protected by the gates.

## Layer 3: the day mix

Pick from the ranked list, top down, skipping any story that would break a rule:

- Five stories a day.
- No more than one per topic. The topics are health, climate and nature, space, accessibility, science and everyday life.
- No more than one flip.
- At least one story at the "helping people now" stage.
- No more than two at the "in the lab" stage.
- Nothing we've run in the last 30 days.
- A new story needs a score of 12 or more to take a slot. Below that it waits, and a bank story takes the slot. It only runs if the bank has nothing left that fits.
- If fewer than five pass, fill from the evergreen bank. Never lower a gate to fill a slot.

## What gets handed on

This step does not write the 140-character line. The next step in the chain does that. This step hands it one record per story that says what the story is about and why it's good, using only checked facts.

| Field | What it holds |
| --- | --- |
| `id`, `lane`, `from` | A short id, `good` or `flip`, and `new` or `evergreen` |
| `date` | When it surfaced (new) or happened (evergreen) |
| `headline` | A plain working title, not for publishing |
| `what_happened` | Two or three plain sentences: who did what, where, and what the result was |
| `why_its_good` | One or two sentences: what the AI did that made the difference, and who is better off |
| `bad_news`, `flip_kind` | Flips only: the bad story in one sentence, and which kind of flip it is |
| `careful` | What the writer must not overstate: a pilot that hasn't started, a figure that comes from the company, an association that isn't proof |
| `topic`, `stage`, `technology` | The tags used by the day mix |
| `total` | The score out of 24 |
| `sources` | The links that were checked |

Rules for whoever writes from a record:

- Use only facts that are in `what_happened`, `why_its_good` and `bad_news`. Nothing from memory.
- Respect every item in `careful`.
- A figure that comes from the organisation itself (a company, a charity, a government) can be used, but the text must say whose figure it is.
- A flip names the bad news first, then the good side.

Stage tags:

- **In the lab:** a discovery, or a tool shown to work in a study. Nobody is relying on it yet.
- **In a trial:** being tested with real people or in a real place, including pilots.
- **Helping people now:** in routine use outside a study. For a flip, the good side is already happening.

## Decisions made here, to confirm

- **The 140-character line is written by the next step.** This step hands over the facts, the reason it's good and the cautions. The stage tag travels as its own field.
- **One flip a day at most.** The science stories earn the trust that lets the flip land.
- **Preprints fail.** This matches the sources card, which skips raw arXiv.
- **Industry news fails.** Launches and funding are news about AI companies, not about the world getting better.

## Rulings from Samira, 17 November

- Software that its own source does not call AI does not count as AI.
- No papers that have not been peer-reviewed.
- An organisation's own figures are allowed, as long as the text says they are theirs.
- The date the story first appeared is what counts for freshness.
- A pilot that has started counts as something that happened.

## Still open

- Whether a person signs off every flip before it runs, and whether two flips on the same underlying story can run in one week. Until decided, treat every flip as needing a person's sign-off.

- The Day 12 "Define the 5 W's" card is empty. Mass appeal is written for people worn down by AI doom who don't work in tech. If the audience is different, that score changes first.
- Who does the fact-check: the agent, a person, or the agent with a person signing off flips.
- Whether job-loss stories count as "somebody was hurt". The test set treats them as flippable only when the good side is documented and doesn't play down the losses.
