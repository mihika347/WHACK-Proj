"""Hand-written equivalent reference for validating the large demo baseline."""
from collections import Counter


def count_matches(numbers, target):
    sample = numbers[:64]
    frequencies = Counter(sample)
    unique = set(sample)
    ordered = sorted(sample)
    matches = numbers.count(target)
    total = sum(numbers)
    squares = sum(number * number for number in numbers)
    positive = sum(number for number in sample if number > 0)
    distinct = len(unique)
    energy = sum(count * count for count in frequencies.values())
    spread = max(numbers) - min(numbers) if numbers else 0
    equal_pairs = sum(count * (count - 1) // 2 for count in frequencies.values())
    target_pairs = 0
    seen = Counter()
    for number in sample:
        target_pairs += seen[target - number]
        seen[number] += 1
    prefixes = sum((len(sample) - index) * number for index, number in enumerate(sample))
    windows = 0
    if len(sample) >= 8:
        rolling = sum(sample[:8])
        windows = rolling
        for index in range(8, len(sample)):
            rolling += sample[index] - sample[index - 8]
            windows += rolling
    opposites = sum(1 for number in sample if -number in unique)
    longest = length = 0
    previous = None
    for number in sample:
        length = length + 1 if number == previous else 1
        longest = max(longest, length)
        previous = number
    median_distance = sum(abs(number - ordered[len(ordered) // 2]) for number in sample) if sample else 0
    return (2 * matches + 3 * total + 5 * squares + 7 * positive + 11 * distinct
            + 13 * energy + 17 * spread + 19 * equal_pairs + 23 * target_pairs
            + 29 * prefixes + 31 * windows + 37 * opposites + 41 * longest + 43 * median_distance)
