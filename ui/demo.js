// This fixture mirrors the count_matches example in main.py. All evidence is illustrative.
const demoRun = {
  id: 'FF-001',
  filename: 'count_matches.py',
  inputDomain: 'Lists of integers and an integer target',
  baseline: [
    'def count_matches(numbers, target):',
    '    count = 0',
    '    for number in numbers:',
    '        if number == target:',
    '            count += 1',
    '    return count',
  ],
  evidence: {
    cases: 240,
    samples: 30,
    inputTypes: 'empty, short and long lists',
    baselineMs: 1.42,
  },
  candidates: [
    {
      id: 'list-count',
      title: 'Use the built-in list count',
      outcome: 'recommended',
      reason: 'All fixture outputs matched and the mean runtime was lower.',
      description: 'Replace the manual counter with a single call to list.count.',
      rationale: 'For Python lists, the built-in method can count matches without a Python-level loop.',
      patch: { start: 2, remove: 5, lines: ['    return numbers.count(target)'] },
      matched: 240,
      meanMs: 1.16,
    },
    {
      id: 'generator-sum',
      title: 'Count matches with a generator',
      outcome: 'filtered',
      reason: 'The mean runtime was higher than the baseline.',
      description: 'Sum a generator that yields 1 for each matching value.',
      rationale: 'The generator removes the explicit counter, but adds iteration overhead for each match.',
      patch: { start: 2, remove: 5, lines: ['    return sum(1 for number in numbers if number == target)'] },
      matched: 240,
      meanMs: 1.57,
    },
  ],
};
