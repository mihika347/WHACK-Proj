"""Integer-list analysis demo with deliberately unoptimised implementations.

Contract: count_matches(numbers: list[int], target: int) -> int.
The returned integer is an analysis score, NOT just the number of matches.
All phases affect the result. No input mutation, printing, floats, or randomness.
Quadratic analyses use the first 64 items to keep the existing benchmarks usable.
"""

SAMPLE_LIMIT = 64
WINDOW_WIDTH = 8


def _count_target(numbers, target):
    count = 0
    index = 0
    while index < len(numbers):
        if numbers[index] == target:
            count += 1
        index += 1
    return count


def _total(numbers):
    result = 0
    for number in numbers:
        result = result + number
    return result


def _square_total(numbers):
    squares = []
    for number in numbers:
        squares.append(number * number)
    return sum(squares)


def _positive_total(sample):
    # Use generator expression to avoid intermediate list creation
    return sum(number for number in sample if number > 0)


def _distinct_count(sample):
    # Build a set once for O(n) distinct count
    return len(set(sample))


def _frequency_energy(sample):
    from collections import Counter

    freq = Counter(sample)
    energy = 0
    for count in freq.values():
        energy += count * count
    return energy


def _spread(numbers):
    if len(numbers) == 0:
        return 0
    ordered = sorted(numbers)
    smallest = ordered[0]
    largest = ordered[len(ordered) - 1]
    return largest - smallest


def _equal_pair_count(sample):
    # Use frequencies to compute pair counts in O(n)
    from collections import Counter

    freq = Counter(sample)
    pairs = 0
    for count in freq.values():
        pairs += count * (count - 1) // 2
    return pairs


def _target_pair_count(sample, target):
    # Two-sum logic with dictionary
    counts = {}
    pairs = 0
    for number in sample:
        complement = target - number
        pairs += counts.get(complement, 0)
        counts[number] = counts.get(number, 0) + 1
    return pairs


def _prefix_total(sample):
    prefixes = []
    running_sum = 0
    for end in range(1, len(sample) + 1):
        running_sum += sample[end - 1]
        prefixes.append(running_sum)
    return sum(prefixes)


def _window_total(sample):
    totals = []
    if len(sample) < WINDOW_WIDTH:
        return 0
    # Rolling window sum
    window_sum = sum(sample[:WINDOW_WIDTH])
    totals.append(window_sum)
    for start in range(1, len(sample) - WINDOW_WIDTH + 1):
        window_sum += sample[start + WINDOW_WIDTH - 1] - sample[start - 1]
        totals.append(window_sum)
    return sum(totals)


def _opposite_count(sample):
    s = set(sample)
    count = 0
    for number in sample:
        if -number in s:
            count += 1
    return count


def _longest_run(sample):
    longest = 0
    current_start = None
    current_len = 0
    for i, value in enumerate(sample):
        if i == 0 or value != sample[i - 1]:
            # start new run
            current_start = i
            current_len = 1
        else:
            current_len += 1
        if current_len > longest:
            longest = current_len
    return longest


def _median_distance(sample):
    if not sample:
        return 0
    ordered = sorted(sample)
    middle = ordered[len(ordered) // 2]
    distance = sum(abs(number - middle) for number in sample)
    return distance


def count_matches(numbers, target):
    """Return a reproducible integer score using 14 separate analysis features.

    The historical function name is retained for the current testing adapter.
    Entire-list features: matches, total, squares, and spread.
    Other features use the first SAMPLE_LIMIT elements, preserving their order.
    Pair counts use distinct positions, not distinct values. Zero is its own
    opposite. Median distance uses the upper middle value for even lengths.
    """
    sample = numbers[:SAMPLE_LIMIT]

    matches = _count_target(numbers, target)
    total = _total(numbers)
    squares = _square_total(numbers)
    positive = _positive_total(sample)
    distinct = _distinct_count(sample)
    frequency_energy = _frequency_energy(sample)
    spread = _spread(numbers)
    equal_pairs = _equal_pair_count(sample)
    target_pairs = _target_pair_count(sample, target)
    prefixes = _prefix_total(sample)
    windows = _window_total(sample)
    opposites = _opposite_count(sample)
    longest = _longest_run(sample)
    median_distance = _median_distance(sample)

    return (
        2 * matches
        + 3 * total
        + 5 * squares
        + 7 * positive
        + 11 * distinct
        + 13 * frequency_energy
        + 17 * spread
        + 19 * equal_pairs
        + 23 * target_pairs
        + 29 * prefixes
        + 31 * windows
        + 37 * opposites
        + 41 * longest
        + 43 * median_distance
    )


if __name__ == "__main__":
    examples = [([], 0), ([0], 0), ([2, 2, 2, 3], 2),
                ([0, 1, 0, 0], 0), ([-3, 1, -3], -3),
                (list(range(-20, 21)), 0)]
    for numbers, target in examples:
        print(f"numbers={numbers}, target={target} -> {count_matches(numbers, target)}")