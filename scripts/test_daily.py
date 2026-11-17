"""Tests for the pick call and checks in scripts/daily.py. Run with: python3 scripts/test_daily.py"""
import os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily


class PickStory(unittest.TestCase):
    """pick_story against a stand-in for the Worker's /pick."""

    def ask(self, answer, day=None):
        import io, json
        from datetime import datetime
        from unittest import mock
        from zoneinfo import ZoneInfo
        day = day or datetime.now(ZoneInfo('Europe/London')).date().isoformat()
        response = io.BytesIO(json.dumps(answer).encode())
        response.__enter__ = lambda self: self
        response.__exit__ = lambda *a: None
        with mock.patch.object(daily, 'token', return_value='t'), mock.patch.object(daily.urllib.request, 'urlopen', return_value=response) as opened:
            result = daily.pick_story('https://worker.example.com', day, False, None)
        return result, opened

    def test_returns_the_record_and_reason_from_the_worker(self):
        record = {'id': 'a', 'headline': 'A', 'sourceUrl': 'https://example.com/a'}
        (got, reason), opened = self.ask({'record': record, 'pick': {'reason': 'Because.'}, 'bank': {'low': False}})
        self.assertEqual((got, reason), (record, 'Because.'))
        self.assertEqual(opened.call_args[0][0].full_url, 'https://worker.example.com/pick')

    def test_stops_when_nothing_is_left_or_there_is_no_link(self):
        with self.assertRaises(daily.Stop):
            self.ask({'record': None, 'pick': None})
        with self.assertRaises(daily.Stop):
            self.ask({'record': {'id': 'a', 'sourceUrl': None}, 'pick': {'reason': 'x'}})

    def test_only_picks_for_today(self):
        with self.assertRaises(daily.Stop):
            self.ask({'record': None}, day='2020-01-01')

    def test_editor_input_uses_the_workers_field_names(self):
        story = {'id': 'a', 'headline': 'H', 'whatHappened': 'W', 'whyItsGood': 'G', 'careful': ['c'], 'stage': 's', 'topic': 't', 'lane': 'good', 'sourceUrl': 'u'}
        self.assertEqual(daily.editor_input(story, {'a': 'draft'})['what_happened'], 'W')
        self.assertEqual(daily.editor_input(story, {'a': 'draft'})['draft_line'], 'draft')


class CheckPost(unittest.TestCase):
    url = 'https://example.com/a'

    def test_accepts_a_good_post(self):
        self.assertEqual(daily.check_post({'decision': 'write', 'post': f'Fine words. {self.url}'}, self.url), ('Fine words.', None))

    def test_rejects_long_text_hashtags_extra_links_and_a_missing_link(self):
        for post in [f"{'x' * 256} {self.url}", f'Good #AI {self.url}', f'See https://other.example {self.url}', 'No link at all']:
            self.assertIsNone(daily.check_post({'decision': 'write', 'post': post}, self.url)[0], post)


class Api(unittest.TestCase):
    """ask_api against a stand-in for the anthropic package, so the request shape is checked without a key."""

    def setUp(self):
        import types
        self.calls = []
        calls = self.calls

        class Messages:
            def create(self, **kwargs):
                calls.append(kwargs)
                block = types.SimpleNamespace(type='text', text='{"decision": "write"}')
                return types.SimpleNamespace(stop_reason=calls[-1].get('_stop', 'end_turn'), content=[block])

        fake = types.ModuleType('anthropic')
        fake.Anthropic = lambda: types.SimpleNamespace(beta=types.SimpleNamespace(messages=Messages()))
        for name in ('AuthenticationError', 'RateLimitError', 'APIStatusError', 'APIConnectionError'):
            setattr(fake, name, type(name, (Exception,), {}))
        sys.modules['anthropic'] = fake

    def tearDown(self):
        sys.modules.pop('anthropic', None)

    def test_calls_the_current_opus_with_the_prompt_as_system_and_fallbacks_on(self):
        self.assertEqual(daily.ask_api('SYSTEM', 'record', None), '{"decision": "write"}')
        call = self.calls[0]
        self.assertEqual((call['model'], call['system'], call['fallbacks']), ('claude-opus-5-5', 'SYSTEM', 'default'))
        self.assertEqual(call['messages'], [{'role': 'user', 'content': 'record'}])


if __name__ == '__main__':
    unittest.main()
