"""Tests for the pick and checks in scripts/daily.py. Run with: python3 scripts/test_daily.py"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily


def story(id, total, frm='evergreen', status='in_bank', lane='good', added=None, published_on=None, sources=('https://example.com/a',)):
    return dict(id=id, total=total, lane=lane, status=status, added=added, published_on=published_on, sources=list(sources), headline=id, **{'from': frm})


class Pick(unittest.TestCase):
    def test_fresh_news_scoring_16_runs_ahead_of_a_higher_bank_story(self):
        stories = [story('bank', 23), story('news', 16, 'new', 'waiting', added='2026-11-10')]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'news')

    def test_news_below_16_or_older_than_14_days_waits_for_the_bank(self):
        stories = [story('bank', 12), story('weak', 15, 'new', 'waiting', added='2026-11-17'), story('old', 22, 'new', 'waiting', added='2026-11-01')]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'bank')

    def test_best_bank_story_wins_and_ties_go_to_the_earlier_one(self):
        stories = [story('low', 18), story('first', 23), story('second', 23)]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'first')

    def test_never_picks_a_story_that_ran_or_was_removed(self):
        stories = [story('ran', 24, status='published', published_on='2026-11-01'), story('gone', 24, status='removed'), story('ok', 10)]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'ok')

    def test_one_flip_a_week(self):
        stories = [story('old-flip', 20, 'new', 'published', lane='flip', added='2026-11-12', published_on='2026-11-12'),
                   story('flip', 22, 'new', 'waiting', lane='flip', added='2026-11-17'), story('bank', 15)]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'bank')
        self.assertEqual(daily.pick(stories, '2026-11-19')[0]['id'], 'flip')

    def test_skips_stories_with_no_link_a_reader_can_use(self):
        stories = [story('eurekalert', 24, sources=['https://www.eurekalert.org/news-releases/1']), story('ok', 10)]
        self.assertEqual(daily.pick(stories, '2026-11-18')[0]['id'], 'ok')

    def test_stops_when_there_is_nothing_left(self):
        with self.assertRaises(daily.Stop):
            daily.pick([story('ran', 20, status='published', published_on='2026-11-01')], '2026-11-18')


class Links(unittest.TestCase):
    def test_europe_pmc_search_becomes_the_doi_link(self):
        url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1111/1365-2664.13831&resultType=core&format=json'
        self.assertEqual(daily.reader_link(url), 'https://doi.org/10.1111/1365-2664.13831')

    def test_the_first_usable_source_is_the_link(self):
        s = story('x', 1, sources=['https://www.eurekalert.org/news-releases/1', 'https://news.example.org/story'])
        self.assertEqual(daily.source_url(s), 'https://news.example.org/story')


class CheckPost(unittest.TestCase):
    url = 'https://example.com/a'

    def test_accepts_a_good_post(self):
        self.assertEqual(daily.check_post({'decision': 'write', 'post': f'Fine words. {self.url}'}, self.url), ('Fine words.', None))

    def test_rejects_long_text_hashtags_extra_links_and_a_missing_link(self):
        for post in [f"{'x' * 256} {self.url}", f'Good #AI {self.url}', f'See https://other.example {self.url}', 'No link at all']:
            self.assertIsNone(daily.check_post({'decision': 'write', 'post': post}, self.url)[0], post)


if __name__ == '__main__':
    unittest.main()
