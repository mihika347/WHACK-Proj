def count_matches(numbers, target):
    count = 0
    for num in numbers:
        if num == target:
            count += 1
    return count

if __name__ == "__main__":
    examples = [
        ([], 0, 0),
        ([2, 2, 2, 3], 2, 3),
        ([0, 1, 0, 0], 0, 3),
        ([-3, 1, -3], -3, 2),
        ([1, 2, 9], 9, 1),
        ([1, 2, 3], 8, 0),
    ]

    for numbers, target, expected in examples:
        actual = count_matches(numbers, target)
        print(
            f"{numbers}, target={target}: "
            f"result={actual}, expected={expected}"
        )