def count_matches(numbers, target):
    t = target
    count = 0
    for number in numbers:
        if number == t:
            count += 1
    return count

print(count_matches([1, 2, 3, 2, 2, 4], 2))