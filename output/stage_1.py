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
    return sum(numbers)


def _square_total(numbers):
    squares = []
    for number in numbers:
        squares.append(number * number)
    return sum(squares)


def _positive_total(sample):
    positive = []
    for number in sample:
        if number > 0:
            positive = positive + [number]
    return sum(positive)


def _distinct_count(sample):
    distinct = []
    for number in sample:
        if number not in distinct:
            distinct.append(number)
    return len(distinct)


def _frequency_energy(sample):
    frequencies = {}
    for number in sample:
        frequencies[number] = sample.count(number)
    energy = 0
    for number in frequencies:
        energy += frequencies[number] * frequencies[number]
    return energy


def _spread(numbers):
    if len(numbers) == 0:
        return 0
    ordered = sorted(numbers)
    smallest = ordered[0]
    largest = ordered[len(ordered) - 1]
    return largest - smallest


def _equal_pair_count(sample):
    pairs = 0
    for left in range(len(sample)):
        for right in range(left + 1, len(sample)):
            if sample[left] == sample[right]:
                pairs += 1
    return pairs


def _target_pair_count(sample, target):
    pairs = 0
    for left in range(len(sample)):
        for right in range(left + 1, len(sample)):
            if sample[left] + sample[right] == target:
                pairs += 1
    return pairs


def _prefix_total(sample):
    prefixes = []
    for end in range(1, len(sample) + 1):
        subtotal = 0
        for number in sample[:end]:
            subtotal += number
        prefixes.append(subtotal)
    return sum(prefixes)


def _window_total(sample):
    totals = []
    if len(sample) < WINDOW_WIDTH:
        return 0
    for start in range(len(sample) - WINDOW_WIDTH + 1):
        subtotal = 0
        window = sample[start:start + WINDOW_WIDTH]
        for number in window:
            subtotal += number
        totals.append(subtotal)
    return sum(totals)


def _opposite_count(sample):
    count = 0
    for number in sample:
        if -number in sample:
            count += 1
    return count


def _longest_run(sample):
    longest = 0
    for start in range(len(sample)):
        length = 0
        for index in range(start, len(sample)):
            if sample[index] != sample[start]:
                break
            length += 1
        if length > longest:
            longest = length
    return longest


def _median_distance(sample):
    if not sample:
        return 0
    distance = 0
    for number in sample:
        ordered = sorted(sample)
        middle = ordered[len(ordered) // 2]
        distance += abs(number - middle)
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