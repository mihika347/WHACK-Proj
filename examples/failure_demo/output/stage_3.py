"""INTENTIONAL BUG: a truthiness filter incorrectly excludes matching zeros."""


def count_matches(numbers, target):
    return sum(1 for number in numbers if number and number == target)
