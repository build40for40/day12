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
| It happened | There is a result, not a prediction | "could", "may", "promises to", "set to revolutionise" |
| The source checks out | The primary source is opened and says what the headline says | Mouse study sold as a cure, a newsletter summary nobody traced back |
| Enough evidence | Peer-reviewed, a trial result, or in real use | Preprint only, press release with no paper |
| Independent for company claims | A company's claim has one source that isn't the company | Lab blog post on its own |
| AI is the reason | Take the AI away and the story disappears | "The hospital also uses AI", ordinary statistics called AI |
| It's about the world | Something changed for a person, place or field outside the AI industry | Funding rounds, model launches, benchmarks, executive moves |
| It's fresh | First made public in the last 90 days, or it comes from the evergreen bank | A 2019 result doing the rounds again |
| It fits in 140 | The line can be written to the rules below | Needs jargon or a paragraph of context to make sense |

The 140 gate is tested by writing the line. If the agent can't write it, the story fails.

### Extra gates for flips

| Gate | Passes when | Typical fail |
| --- | --- | --- |
| The good side is its own fact | It has its own source and would be true even if you'd never read the bad story | "This shows how capable AI is", "AI might fix this one day" |
| It doesn't shrink the harm | The line admits the bad news, then adds to it | "It's not that bad", "but think of the productivity" |
| Nobody was hurt | No death, injury, abuse or named victim in the original story | A scam victim, a self-harm case, a crash |

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
- If fewer than five pass, fill from the evergreen bank. Never lower a gate to fill a slot.

## The 140-character line

- 140 characters at most, counting spaces. The link and the stage tag sit beside the line and don't count.
- Says what happened and to whom or where.
- No "could", "may", "might", "promises" or "revolutionise".
- No jargon, and no dashes in the middle of a sentence.
- A flip names the bad news first, then the good side.

Every story carries one stage tag next to its line: **in the lab**, **in a trial** or **helping people now**.

## Decisions made here, to confirm

- **The stage tag sits beside the 140, not inside it.** Inside, it would cost up to 18 characters.
- **One flip a day at most.** The science stories earn the trust that lets the flip land.
- **Preprints fail.** This matches the sources card, which skips raw arXiv.
- **Industry news fails.** Launches and funding are news about AI companies, not about the world getting better.

## Still open

- The Day 12 "Define the 5 W's" card is empty. Mass appeal is written for people worn down by AI doom who don't work in tech. If the audience is different, that score changes first.
- Who does the fact-check: the agent, a person, or the agent with a person signing off flips.
- Whether job-loss stories count as "somebody was hurt". The test set treats them as flippable only when the good side is documented and doesn't play down the losses.
