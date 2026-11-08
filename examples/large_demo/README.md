# Large optimisation demo

`original.py` is a roughly 190-line integer-list analysis program with 14 separate calculations. It preserves the current test adapter's signature:

```python
count_matches(numbers: list[int], target: int) -> int
```

The historical name is retained for compatibility. The output is now a weighted **integer analysis score**, not simply the number of target matches. For example, `count_matches([], 0)` returns `0`, `count_matches([0], 0)` returns `104`, and `count_matches([0, 0], 0)` returns `265`.

The original remains the source of expected outputs for the validator. No changes to the function adapter or agent input contract are needed. The score incorporates every calculation below, so replacing the whole program with `numbers.count(target)` is incorrect. It uses exact integer arithmetic, supports positive/negative/zero/large integers, preserves the caller's list, and produces no output when imported.

## Optimisation opportunities

These are independent local transformations to try against the baseline. Some may overlap when combined. Benchmark each proposal: the list is not a claim that every change improves every workload.

| # | Function | Current bottleneck | Proposed change |
| --- | --- | --- | --- |
| 1 | `_count_target` | Python index loop | `numbers.count(target)` |
| 2 | `_total` | Python addition loop | Built-in `sum` |
| 3 | `_square_total` | Append loop and temporary array | Comprehension or iterator-based aggregation; benchmark both |
| 4 | `_positive_total` | Repeated list concatenation | Comprehension/append or direct summation |
| 5 | `_distinct_count` | Repeated linear membership | A set |
| 6 | `_frequency_energy` | Recounts the list for every position | One frequency table / `Counter` |
| 7 | `_spread` | Sorts the entire input for extrema | `min` and `max` |
| 8 | `_equal_pair_count` | Nested comparisons | Sum `count * (count - 1) // 2` over frequencies |
| 9 | `_target_pair_count` | Nested pair-sum comparisons | Running frequency lookup for the complement |
| 10 | `_prefix_total` | Repeated prefix slicing and summation | Running total or weighted sum |
| 11 | `_window_total` | Rebuilds and sums overlapping windows | Rolling sum |
| 12 | `_opposite_count` | Linear membership per element | Build one set for membership |
| 13 | `_longest_run` | Repeated scans of matching suffixes | One pass tracking the current run |
| 14 | `_median_distance` | Sorts the sample inside every iteration | Compute the upper median once |

Target counts, totals, squares, and spread cover the full input. The more expensive analyses cover the first 64 items; complete moving windows have width 8. This is part of the defined behaviour and keeps the existing 10,000-element benchmarks responsive. Optimisations must preserve that sampling boundary, pair multiplicities, zero handling, order-sensitive runs/windows, and the upper-median definition.

## Use it in the existing pipeline

From the repository root in PowerShell:

```powershell
# Verify the demo independently before replacing your current baseline:
python -m unittest test_large_demo -v

# Save the current baseline, then install the demo:
Copy-Item original.py original.before-large-demo.py
Copy-Item examples/large_demo/original.py original.py

# Generate candidates using your running LM Studio model:
python api_call1.py
python correctness_test.py
python speed_test.py --score-threshold 70
```

Choose a different backup filename if `original.before-large-demo.py` already exists. The generator may identify fewer than 10 stages or merge several opportunities into one proposal: having 14 local opportunities does not force an LLM to return 14 independent stages. Existing outputs belong to the previous baseline until you regenerate them.

`optimised_reference.py` is a hand-written equivalent implementation used by the regression tests. It is not presented as model-generated output or installed as a candidate automatically. The tests compare both implementations on hand-calculated cases, shared random/boundary inputs, the speed suite, exhaustive short lists, and the sampling/window boundaries.
