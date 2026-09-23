"""Portable job preparation, model runs, reconstruction and comparisons."""
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .api import edit_image, write_json
from .geometry import (compose_patch, crop_view, inverse_map, outside_changes,
                       perspective, read_mask, read_rgb, save_panorama_jpeg,
                       save_png, validate_projection)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def validate_config(config):
    validate_projection(config['projection'])
    if config['model'] not in ('qwen-image-3.0-pro', 'qwen-image-3.0'):
        raise ValueError('Supported models are qwen-image-3.0-pro and qwen-image-3.0')
    api = config['api']
    if api.get('n') != 1:
        raise ValueError('Use n=1; --count creates separately recorded independent calls')
    try:
        w, h = map(int, api['size'].split('*'))
    except (ValueError, KeyError):
        raise ValueError('api.size must be WIDTH*HEIGHT, for example 1024*1024') from None
    if min(w, h) <= 0 or not 512**2 <= w*h <= 2048**2 or max(w/h, h/w) > 8:
        raise ValueError('API size must have 512^2..2048^2 pixels and aspect ratio at most 8:1')
    _, _, cw, ch = config['projection']['crop']
    if abs(w/h-cw/ch) > .01:
        raise ValueError('API output and perspective crop must have the same aspect ratio')
    feather = config['blend']['feather_pixels']
    if not np.isfinite(feather) or feather < 0:
        raise ValueError('feather_pixels must be nonnegative and finite')


def prepare(input_path, config_path, out, mask_path=None):
    input_path, config_path, out = Path(input_path), Path(config_path), Path(out)
    config = load_json(config_path)
    validate_config(config)
    source_hash = digest(input_path)
    expected = config.get('example_source_sha256')
    if expected and source_hash != expected:
        raise ValueError('This sample config/mask belongs to another photo. Create a custom config and mask first.')
    prompt_path = config_path.parent / config['prompt_file']
    prompt = prompt_path.read_text(encoding='utf-8')
    source = read_rgb(input_path)
    h, w = source.shape[:2]
    if w != 2*h:
        raise ValueError('This package expects a full 2:1 equirectangular panorama')
    if max(w, h) >= 32767:
        raise ValueError('Input exceeds OpenCV remap dimension limits')
    view = perspective(source, config['projection'])
    crop = crop_view(view, config['projection'])
    mask = read_mask(mask_path, crop.shape[:2]) if mask_path else None
    if out.exists() and any(out.iterdir()):
        raise ValueError('Output job directory is not empty; choose a new --out directory')
    out.mkdir(parents=True, exist_ok=True)
    source_name = 'source' + input_path.suffix.lower()
    shutil.copyfile(input_path, out / source_name)
    save_png(out / 'perspective.png', view)
    save_png(out / 'input.png', crop)
    save_png(out / 'mask.png', (mask.astype(np.uint8)*255) if mask is not None else np.zeros(crop.shape[:2], np.uint8))
    overlay = crop.copy()
    if mask is not None:
        overlay[mask] = np.rint(overlay[mask]*.65 + np.array([255, 50, 50])*.35).astype(np.uint8)
    save_png(out / 'mask_overlay.png', overlay)
    (out / 'prompt.txt').write_text(prompt, encoding='utf-8')
    write_json(out / 'config.json', config)
    write_json(out / 'job.json', {'source_file': source_name, 'source_size': [w, h],
                                 'source_sha256': source_hash, 'projection': config['projection'],
                                 'mask_ready': mask is not None})
    print(f'Prepared {out}: panorama {w}x{h}, perspective {view.shape[1]}x{view.shape[0]}, crop {crop.shape[1]}x{crop.shape[0]}', flush=True)
    if mask is None:
        print('Paint a white-on-black mask in an image editor and replace the job mask.png before generate.', flush=True)
    return out


def new_run(job):
    job = Path(job)
    config = load_json(job / 'config.json')
    validate_config(config)
    read_mask(job / 'mask.png', read_rgb(job / 'input.png').shape[:2])
    info = load_json(job / 'job.json')
    if digest(job / info['source_file']) != info['source_sha256']:
        raise ValueError('The job source image has changed; prepare a new job')
    runs = job / 'runs'
    runs.mkdir(exist_ok=True)
    indexes = [int(p.name) for p in runs.iterdir() if p.is_dir() and p.name.isdigit()]
    folder = runs / f'{max(indexes, default=0)+1:03d}'
    folder.mkdir()
    for name in ('config.json', 'input.png', 'mask.png', 'prompt.txt'):
        shutil.copyfile(job / name, folder / name)
    write_json(folder / 'inputs.json', {name: digest(folder / name) for name in ('config.json', 'input.png', 'mask.png', 'prompt.txt')})
    return folder


def run_path(job, run):
    if not str(run).isdigit():
        raise ValueError('--run must be a numeric run identifier, such as 001')
    folder = Path(job) / 'runs' / f'{int(run):03d}'
    if not folder.is_dir():
        raise ValueError('Run directory does not exist')
    return folder


def generate(job, env_file=None, resume=None):
    folder = run_path(job, resume) if resume else new_run(job)
    config = load_json(folder / 'config.json')
    verify_snapshot(folder)
    print(f'{folder.name}: requesting {config["model"]}', flush=True)
    edit_image(folder / 'input.png', (folder / 'prompt.txt').read_text(encoding='utf-8'),
               config['model'], config['api'], folder, env_file)
    return folder


def verify_snapshot(folder):
    for name, expected in load_json(folder / 'inputs.json').items():
        if digest(folder / name) != expected:
            raise ValueError(f'Run input {name} changed after its snapshot; create a new run')


def contact_sheet(items, destination, columns=3):
    rows = (len(items)+columns-1)//columns
    canvas = Image.new('RGB', (12+512*columns, 12+548*rows), (246, 246, 244))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default(size=22)
    for i, (label, path) in enumerate(items):
        x, y = 12+512*(i % columns), 12+548*(i//columns)
        draw.text((x+4, y+4), label, font=font, fill=(30, 30, 30))
        with Image.open(path) as image:
            image = image.convert('RGB')
            image.thumbnail((500, 500), Image.Resampling.LANCZOS)
            canvas.paste(image, (x+(500-image.width)//2, y+36+(500-image.height)//2))
    canvas.save(destination)


def import_response(job, model_output, provenance=None):
    folder = new_run(job)
    supplied = load_json(provenance) if provenance else {}
    expected = supplied.get('model_output_sha256')
    if expected and expected != digest(model_output):
        raise ValueError('The imported image does not match its supplied provenance hash')
    with Image.open(model_output) as image:
        image.convert('RGB').save(folder / 'model_raw.png')
    write_json(folder / 'request_metadata.json', {'status': 'offline_import', 'new_api_call': False,
               'model': supplied.get('model', 'unverified_external_image'),
               'provided_provenance': supplied, 'imported_sha256': digest(model_output)})
    return folder


def finish(job, folder):
    job, folder = Path(job), Path(folder)
    verify_snapshot(folder)
    info, config = load_json(job / 'job.json'), load_json(folder / 'config.json')
    if digest(job / info['source_file']) != info['source_sha256']:
        raise ValueError('The job source image has changed')
    source = read_rgb(job / info['source_file'])
    original = read_rgb(folder / 'input.png')
    mask = read_mask(folder / 'mask.png', original.shape[:2])
    raw = read_rgb(folder / 'model_raw.png')
    repaired, resized = compose_patch(original, raw, mask, config['blend']['harmonic_colour_match'])
    save_png(folder / 'model_resized.png', resized)
    save_png(folder / 'nadir_clean.png', repaired)
    output, support = inverse_map(source, repaired, mask, config['projection'], config['blend']['feather_pixels'])
    save_png(folder / 'panorama_clean.png', output)
    save_png(folder / 'panorama_mask.png', support)
    save_panorama_jpeg(folder / 'panorama_clean.jpg', output)
    preview = Image.fromarray(output)
    preview.thumbnail((2048, 1024), Image.Resampling.LANCZOS)
    preview.save(folder / 'preview.jpg', quality=94)
    returned = perspective(output, config['projection'])
    save_png(folder / 'perspective_after.png', returned)
    save_png(folder / 'nadir_reprojected.png', crop_view(returned, config['projection']))
    saved = read_rgb(folder / 'panorama_clean.png')
    changes = outside_changes(source, saved, support)
    if changes:
        raise RuntimeError(f'Outside-mask verification failed: {changes} pixels')
    request = load_json(folder / 'request_metadata.json')
    checks = {'model': request.get('model'), 'request_status': request['status'],
              'output_size': [source.shape[1], source.shape[0]], 'aspect_ratio_2_to_1': True,
              'outside_mask_changed_pixels_in_png': changes,
              'projected_mask_pixels': int(np.count_nonzero(support)), 'jpeg_is_lossy': True,
              'source_sha256': info['source_sha256'], 'telea_or_ns_inpainting_used': False}
    with Image.open(folder / 'panorama_clean.jpg') as image:
        checks['jpeg_gpano_metadata'] = b'equirectangular' in image.info.get('xmp', b'')
    write_json(folder / 'validation.json', checks)
    contact_sheet([('Original', folder / 'input.png'), ('From final panorama', folder / 'nadir_reprojected.png')],
                  folder / 'comparison_nadir.png', columns=2)
    print(f'{folder.name}: complete, {source.shape[1]}x{source.shape[0]}, outside-mask changed pixels = {changes}', flush=True)


def compare(job):
    job = Path(job)
    runs = sorted(p for p in (job / 'runs').iterdir() if p.is_dir() and (p / 'validation.json').exists())
    if not runs:
        raise ValueError('No finished runs to compare')
    contact_sheet([(f'Run {p.name}', p / 'nadir_reprojected.png') for p in runs], job / 'comparison.png', min(3, len(runs)))
    contact_sheet([(f'Run {p.name} raw', p / 'model_resized.png') for p in runs], job / 'comparison_raw.png', min(3, len(runs)))
    write_json(job / 'results.json', [{'run': p.name, 'request': load_json(p / 'request_metadata.json'),
                                      'validation': load_json(p / 'validation.json')} for p in runs])
    print(f'Comparison saved: {job / "comparison.png"}', flush=True)
