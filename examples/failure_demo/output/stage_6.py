"""INTENTIONAL BUG: every result is one too large."""


def count_matches(numbers, target):
    return numbers.count(target) + 1
