import argparse
import json
from .core import analyze


def main():
    parser = argparse.ArgumentParser(
        description="Synthetic alternative-data vintages and frozen ridge probes"
    )
    parser.add_argument("--scenario", type=int, default=0)
    parser.add_argument("--delay", type=int, default=0)
    args = parser.parse_args()
    try:
        result = analyze(vars(args))
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
