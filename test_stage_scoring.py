import unittest
from stage_scoring import score_stages, select_stages, validate_threshold


def candidate(name, **changes):
    return {"stage": name, "correctness_status": "pass", "speed_status": "pass", "agent_status": "used",
            "total_cases": 100, "passed_cases": 100, "failed_cases": 0, "source_sha256": name, **changes}


class ScoringTests(unittest.TestCase):
    def test_correct_outweighs_incorrect_and_missing_is_unscored(self):
        rows = [candidate('stage_1.py'), candidate('stage_2.py', correctness_status='fail', passed_cases=99, failed_cases=1),
                candidate('stage_3.py', speed_status='skipped')]
        score_stages(rows, [{"stage": 'stage_1.py', "speedup": .1}, {"stage": 'stage_2.py', "speedup": 10000}])
        self.assertGreater(rows[0]['stage_score'], rows[1]['stage_score'])
        self.assertFalse(rows[1]['selection_eligible'])
        self.assertIsNone(rows[2]['stage_score'])
        self.assertFalse(rows[0]['is_key_stage'])

    def test_same_mean_but_variance_and_worst_case_reduce_score(self):
        rows = [candidate('stage_1.py'), candidate('stage_2.py')]
        score_stages(rows, [{"stage": 'stage_1.py', "speedup": x} for x in [2, 2]] +
                     [{"stage": 'stage_2.py', "speedup": x} for x in [.5, 3.5]])
        self.assertEqual(rows[0]['mean_speed_increase_percent'], rows[1]['mean_speed_increase_percent'])
        self.assertGreater(rows[0]['stage_score'], rows[1]['stage_score'])
        self.assertTrue(rows[0]['is_key_stage'])
        self.assertFalse(rows[1]['is_key_stage'])

    def test_no_top_three_limit_and_final_not_ranked(self):
        rows = [candidate(f'stage_{i}.py', source_sha256='same' if i in [1, 2] else str(i)) for i in range(1, 6)]
        rows.append(candidate('final_optimised.py'))
        score_stages(rows, [{"stage": row['stage'], "speedup": 2} for row in rows])
        keys = [row for row in rows if row['is_key_stage']]
        self.assertEqual(len(keys), 5)
        self.assertIsNone(rows[-1]['rank'])
        self.assertFalse(rows[-1]['is_key_stage'])
        self.assertTrue(all(0 <= row['stage_score'] <= 100 for row in rows))

    def test_strict_threshold_equality_and_zero_does_not_allow_failed_stages(self):
        rows = [candidate('stage_1.py'), candidate('stage_2.py', correctness_status='fail', failed_cases=1, passed_cases=99)]
        score_stages(rows, [{'stage': 'stage_1.py', 'speedup': 2}], threshold=75)
        self.assertEqual(rows[0]['stage_score'], 75)
        self.assertFalse(rows[0]['is_key_stage'])
        select_stages(rows, 74.99)
        self.assertTrue(rows[0]['is_key_stage'])
        select_stages(rows, 0)
        self.assertFalse(rows[1]['is_key_stage'])
        select_stages(rows, 100)
        self.assertFalse(any(row['is_key_stage'] for row in rows))

    def test_invalid_thresholds(self):
        for value in [-1, 101, float('nan'), float('inf'), True, 'bad']:
            with self.assertRaises(ValueError):
                validate_threshold(value)

    def test_agent_error_blocks_score_and_all_wrong_scores_zero(self):
        rows = [candidate('stage_1.py', agent_status='error'),
                candidate('stage_2.py', correctness_status='fail', passed_cases=0, failed_cases=100)]
        score_stages(rows, [{"stage": 'stage_1.py', "speedup": 10}])
        self.assertIsNone(rows[0]['stage_score'])
        self.assertEqual(rows[1]['stage_score'], 0)


if __name__ == '__main__':
    unittest.main()
