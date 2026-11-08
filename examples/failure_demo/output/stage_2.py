"""INTENTIONAL BUG: loses duplicate matches."""


def count_matches(numbers, target):
    return list(set(numbers)).count(target)
