"""Decode bounded numeric test-data expressions; never compile/eval model code."""
import ast
import json
import re

MAX_LENGTH = 2000
MAX_BITS = 4096


def decode_cases(text):
    if not isinstance(text, str) or len(text) > 200000:
        raise ValueError('Agent response is empty or too large')
    text = re.sub(r'^```(?:json|python)?\s*', '', text.strip())
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text), 'json'
    except json.JSONDecodeError:
        tree = ast.parse(text, mode='eval')
        if sum(1 for _ in ast.walk(tree)) > 12000:
            raise ValueError('Too many data expression nodes')

    def integer(value):
        if type(value) is not int or value.bit_length() > MAX_BITS:
            raise ValueError('Expected a bounded integer')
        return value

    def array(value):
        if not isinstance(value, list) or len(value) > MAX_LENGTH:
            raise ValueError('Test arrays must contain at most 2000 items')
        return value

    def read(node, variables=None):
        variables = variables or {}
        if isinstance(node, ast.Constant):
            if isinstance(node.value, str) or node.value is None:
                return node.value
            return integer(node.value)
        if isinstance(node, ast.Name) and node.id in variables:
            return variables[node.id]
        if isinstance(node, ast.Name) and node.id == 'null':
            return None
        if isinstance(node, ast.List):
            if len(node.elts) > MAX_LENGTH:
                raise ValueError('Test array is too long')
            return [read(item, variables) for item in node.elts]
        if isinstance(node, ast.Dict):
            result = {}
            for key, value in zip(node.keys, node.values):
                if not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                    raise ValueError('Only literal string dictionary keys are allowed')
                result[key.value] = read(value, variables)
            return result
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = integer(read(node.operand, variables))
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.BinOp):
            left, right = read(node.left, variables), read(node.right, variables)
            if isinstance(node.op, ast.Mult) and (isinstance(left, list) or isinstance(right, list)):
                values, count = (left, right) if isinstance(left, list) else (right, left)
                count = integer(count)
                if count < 0 or count > MAX_LENGTH or len(values) * count > MAX_LENGTH:
                    raise ValueError('List repetition is too large')
                return values * count
            if isinstance(node.op, ast.Add) and isinstance(left, list) and isinstance(right, list):
                if len(left) + len(right) > MAX_LENGTH:
                    raise ValueError('List concatenation is too large')
                return left + right
            left, right = integer(left), integer(right)
            if isinstance(node.op, ast.Add): value = left + right
            elif isinstance(node.op, ast.Sub): value = left - right
            elif isinstance(node.op, ast.Mult): value = left * right
            elif isinstance(node.op, ast.Mod) and right: value = left % right
            elif isinstance(node.op, ast.Pow):
                if right < 0 or right > 1000 or max(1, left.bit_length()) * right > MAX_BITS:
                    raise ValueError('Integer power is too large')
                value = left ** right
            else:
                raise ValueError('Unsupported numeric data operation')
            return integer(value)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
            if node.func.id == 'range' and 1 <= len(node.args) <= 3:
                args = [integer(read(arg, variables)) for arg in node.args]
                values = range(*args)
                try:
                    if len(values) > MAX_LENGTH: raise ValueError('Range is too long')
                except OverflowError as exc:
                    raise ValueError('Range is too long') from exc
                return list(values)
            if node.func.id == 'list' and len(node.args) == 1:
                return array(read(node.args[0], variables))
        if isinstance(node, ast.ListComp) and len(node.generators) == 1:
            generator = node.generators[0]
            if not isinstance(generator.target, ast.Name) or generator.ifs or generator.is_async:
                raise ValueError('Only simple bounded range comprehensions are allowed')
            if not isinstance(generator.iter, ast.Call) or not isinstance(generator.iter.func, ast.Name) or generator.iter.func.id != 'range':
                raise ValueError('Comprehensions must iterate over a bounded range')
            values = array(read(generator.iter, variables))
            return [read(node.elt, {**variables, generator.target.id: value}) for value in values]
        raise ValueError('Unsupported data expression; function calls and attributes are not allowed')

    return read(tree.body), 'bounded_data'
