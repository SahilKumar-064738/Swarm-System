"""
word_count.py — Sample Python script for the distributed parallel execution system.

Usage: python3 word_count.py <chunk_file_path>

Reads the chunk file, counts word frequencies (case-insensitive),
and prints a JSON object to stdout.

The distributed system will merge multiple JSON objects by summing
numeric values for matching keys — producing a global word count.
"""
import sys
import json
from collections import Counter


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No chunk file path provided"}))
        sys.exit(1)

    chunk_path = sys.argv[1]

    with open(chunk_path, encoding="utf-8") as fh:
        content = fh.read()

    words = content.lower().split()
    counts = dict(Counter(words))

    # Print JSON to stdout — this becomes the task result
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
