import argparse
from pathlib import Path
import sys

from .pipeline import compare, finish, generate, import_response, prepare, run_path


def positive(value):
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError('count must be positive')
    return n


def main():
    parser = argparse.ArgumentParser(description='Panorama -> perspective nadir -> Qwen-Image-3.0-Pro -> original panorama')
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('prepare', 'run'):
        p = commands.add_parser(name)
        p.add_argument('--input', required=True)
        p.add_argument('--config', default='config.example.json')
        p.add_argument('--mask', required=name == 'run')
        p.add_argument('--out', required=True)
        if name == 'run':
            p.add_argument('--count', type=positive, default=1)
            p.add_argument('--env-file')
    p = commands.add_parser('generate')
    p.add_argument('--job', required=True)
    p.add_argument('--count', type=positive, default=1)
    p.add_argument('--env-file')
    p.add_argument('--resume', help='Retry only a saved result download; never retries a previous generation POST')
    p = commands.add_parser('finish')
    p.add_argument('--job', required=True)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument('--run', help='Numeric existing run ID, e.g. 001')
    group.add_argument('--model-output', help='Offline replay of an existing response image; no API request')
    p.add_argument('--provenance', help='Optional JSON describing the imported response')
    p = commands.add_parser('compare')
    p.add_argument('--job', required=True)
    args = parser.parse_args()
    try:
        if args.command in ('prepare', 'run'):
            job = prepare(args.input, args.config, args.out, args.mask)
            if args.command == 'run':
                for _ in range(args.count):
                    folder = generate(job, args.env_file)
                    finish(job, folder)
                compare(job)
        elif args.command == 'generate':
            if args.resume and args.count != 1:
                raise ValueError('--resume cannot be combined with --count other than 1')
            for _ in range(args.count):
                folder = generate(args.job, args.env_file, args.resume)
                print(f'Next: python -m qwen_panorama finish --job "{args.job}" --run {folder.name}', flush=True)
        elif args.command == 'finish':
            folder = (import_response(args.job, args.model_output, args.provenance) if args.model_output
                      else run_path(args.job, args.run))
            finish(args.job, folder)
            compare(args.job)
        else:
            compare(args.job)
    except (ValueError, RuntimeError, OSError, KeyError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
