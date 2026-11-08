"""Known-correct baseline for the deliberately broken demonstration."""


def count_matches(numbers, target):
    count = 0
    for number in numbers:
        if number == target:
            count += 1
    return count
