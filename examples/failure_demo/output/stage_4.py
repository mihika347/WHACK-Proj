"""INTENTIONAL BUG: skips the last element."""


def count_matches(numbers, target):
    return numbers[:-1].count(target)
