def count_matches(numbers, target):
    return sum(1 for number in numbers if number == target)

print(count_matches([1, 2, 3, 2, 2, 4], 2))