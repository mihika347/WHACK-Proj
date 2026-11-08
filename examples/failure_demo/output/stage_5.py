"""INTENTIONAL BUG: returns the correct count but mutates the caller's list."""


def count_matches(numbers, target):
    numbers.sort()
    return numbers.count(target)
