---
tags:
  - flashcards/programming/concepts
flashcards-deck-id: deck_1754337047640_a508psayp
---

# Programming Concepts

This deck contains fundamental programming concepts using both header+paragraph and table formats.

## What is a variable?

A variable is a named storage location in a computer's memory that holds a value. Variables can store different types of data such as numbers, text, or boolean values.

Key characteristics:
- Has a name (identifier)
- Stores a value
- Can be changed during program execution
- Has a specific data type in statically-typed languages

## What is the difference between compiled and interpreted languages?

**Compiled languages** are translated to machine code before execution:
- Examples: C, C++, Rust, Go
- Faster execution
- Compilation step required
- Platform-specific executables

**Interpreted languages** are executed line-by-line by an interpreter:
- Examples: Python, JavaScript, Ruby
- Slower execution
- No compilation step
- Platform independent

## Common Data Structures

| Data Structure | Description |
|----------------|-------------|
| Array | Fixed-size collection of elements of the same type |
| Linked List | Collection of nodes where each node points to the next |
| Stack | LIFO (Last In, First Out) data structure |
| Queue | FIFO (First In, First Out) data structure |
| Hash Table | Key-value pairs with fast lookup using hash function |
| Tree | Hierarchical structure with root and child nodes |
| Graph | Collection of vertices connected by edges |

## What is recursion?

Recursion is a programming technique where a function calls itself to solve a problem by breaking it down into smaller subproblems.

Essential components:
1. **Base case**: The condition that stops the recursion
2. **Recursive case**: The function calling itself with modified parameters

Example: Factorial
```
factorial(n):
    if n <= 1: return 1  // base case
    return n * factorial(n-1)  // recursive case
```

## Big O Notation

| Notation | Name | Example |
|----------|------|---------|
| O(1) | Constant | Array access by index |
| O(log n) | Logarithmic | Binary search |
| O(n) | Linear | Simple loop |
| O(n log n) | Linearithmic | Efficient sorting (merge sort) |
| O(n²) | Quadratic | Nested loops |
| O(2ⁿ) | Exponential | Recursive fibonacci |

## What is polymorphism?

Polymorphism is an object-oriented programming principle that allows objects of different types to be treated as instances of the same type through inheritance or interfaces.

Types of polymorphism:
- **Compile-time (Static)**: Method overloading, operator overloading
- **Runtime (Dynamic)**: Method overriding through inheritance
- **Parametric**: Generics/Templates

Benefits:
- Code reusability
- Flexibility
- Extensibility

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 400 | Bad Request - Invalid request syntax |
| 401 | Unauthorized - Authentication required |
| 403 | Forbidden - Access denied |
| 404 | Not Found - Resource doesn't exist |
| 500 | Internal Server Error - Server error |
| 503 | Service Unavailable - Server temporarily down |

## What is the difference between == and === in JavaScript?

**== (Loose Equality)**
- Performs type coercion
- Converts operands to the same type before comparison
- Example: "5" == 5 returns true

**=== (Strict Equality)**
- No type coercion
- Checks both value and type
- Example: "5" === 5 returns false

Best practice: Always use === unless you specifically need type coercion.