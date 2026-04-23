"""
sum_numbers.py — Sample Python script demonstrating NUMERIC merge.

Usage: python3 sum_numbers.py <chunk_file_path>

Each line in the chunk file should be an integer or float.
The script prints the sum of the chunk as a plain number to stdout.

The distributed controller detects that all chunk results are numbers
and sums them to produce the final result.
"""
import sys


def main():
    if len(sys.argv) < 2:
        print(0)
        sys.exit(0)

    chunk_path = sys.argv[1]
    total = 0.0

    with open(chunk_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    total += float(line)
                except ValueError:
                    pass  # skip non-numeric lines

    # Print as int if whole number, else float
    if total == int(total):
        print(int(total))
    else:
        print(total)


if __name__ == "__main__":
    main()
