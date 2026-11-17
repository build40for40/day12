"""Tests for scripts/score.py, against a stand-in for the anthropic package. Run with: python3 scripts/test_score.py"""
import json, os, sys, types, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score


def candidate(id, title='A fake story'):
    return {'id': id, 'title': title, 'summary': 'Fake summary.', 'url': f'https://example.com/{id}', 'publisher': 'Fake News',
            'publishedAt': None, 'sourceId': 'fake', 'tier': 'lead', 'pulledAt': '2026-11-17T06:00:00Z'}


def passing(**over):
    out = {'gate': 'pass', 'failed_gate': None, 'reason': 'Checked.', 'topic': 'health', 'stage': 'in_a_trial',
           'scores': {'mass_appeal': 3, 'real_person_or_place': 2, 'stage': 2, 'surprise': 1}, 'total': 99,
           'story': {'headline': 'H', 'what_happened': 'W', 'why_its_good': 'G', 'careful': [], 'sources': ['https://example.org/paper']}}
    out.update(over)
    return out


class FakeClient:
    """Answers each request with the next reply in the list. A reply is (stop_reason, text)."""

    def __init__(self, replies):
        self.replies, self.calls = list(replies), []
        client = self

        class Messages:
            def create(self, **kwargs):
                client.calls.append(kwargs)
                stop, text = client.replies.pop(0)
                return types.SimpleNamespace(stop_reason=stop, content=[types.SimpleNamespace(type='text', text=text)])

        self.beta = types.SimpleNamespace(messages=Messages())


class Base(unittest.TestCase):
    def setUp(self):
        fake = types.ModuleType('anthropic')
        fake.AuthenticationError = type('AuthenticationError', (Exception,), {})
        sys.modules['anthropic'] = fake

    def tearDown(self):
        sys.modules.pop('anthropic', None)


class Triage(Base):
    def test_shortlists_in_order_and_drops_the_rest_including_ones_the_model_skipped(self):
        reply = {'shortlist': [{'id': 2, 'why': 'trial'}, {'id': 99, 'why': 'not ours'}], 'rejected': [{'id': 1, 'reason': 'Funding round.'}]}
        client = FakeClient([('end_turn', json.dumps(reply))])
        shortlist, dropped = score.triage(client, [candidate(1), candidate(2), candidate(3)])
        self.assertEqual(shortlist, [2])
        self.assertEqual({d['id']: d['reason'] for d in dropped}, {1: 'Funding round.', 3: 'Not shortlisted.'})
        call = client.calls[0]
        self.assertEqual((call['model'], call['fallbacks'], call['output_config']['format']['type']), ('claude-opus-5-5', 'default', 'json_schema'))


class Score(Base):
    def test_a_pass_gets_its_total_recomputed_from_the_scores(self):
        verdict = score.to_verdict(candidate(1), passing())
        self.assertEqual((verdict['gate'], verdict['total']), ('pass', 3 * 3 + 2 * 2 + 2 * 2 + 1))

    def test_a_fail_keeps_the_gate_and_reason(self):
        self.assertEqual(score.to_verdict(candidate(1), {'gate': 'fail', 'failed_gate': 'evidence', 'reason': 'Preprint.'}),
                         {'id': 1, 'gate': 'fail', 'failed_gate': 'evidence', 'reason': 'Preprint.'})

    def test_rejects_scores_out_of_range_or_an_unknown_gate(self):
        with self.assertRaises(ValueError):
            score.to_verdict(candidate(1), passing(scores={'mass_appeal': 4, 'real_person_or_place': 0, 'stage': 0, 'surprise': 0}))
        with self.assertRaises(ValueError):
            score.to_verdict(candidate(1), {'gate': 'maybe'})

    def test_opens_sources_with_web_tools_and_resumes_a_paused_turn(self):
        client = FakeClient([('pause_turn', ''), ('end_turn', 'Here it is: ' + json.dumps(passing()))])
        verdict = score.score_one(client, candidate(7), '2026-11-17')
        self.assertEqual(verdict['id'], 7)
        self.assertEqual(len(client.calls), 2)
        self.assertEqual([t['name'] for t in client.calls[0]['tools']], ['web_fetch', 'web_search'])
        self.assertIn('Live scoring', client.calls[0]['system'])
        self.assertEqual(client.calls[1]['messages'][-1]['role'], 'assistant')

    def test_a_refusal_is_an_error_not_a_verdict(self):
        with self.assertRaises(ValueError):
            score.score_one(FakeClient([('refusal', '')]), candidate(1), '2026-11-17')


if __name__ == '__main__':
    unittest.main()
