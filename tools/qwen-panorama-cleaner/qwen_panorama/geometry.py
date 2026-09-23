"""Rectilinear projection and masked inverse mapping of 2:1 panoramas.

Convention: longitude = (x/W-.5)*2*pi; latitude = (y/H-.5)*pi.
The panorama's bottom has positive Y; pitch=-90 looks toward the nadir.
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def read_rgb(path):
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if image is None:
        raise ValueError(f'Cannot decode image: {Path(path).name}')
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def save_png(path, array):
    Image.fromarray(array).save(path, compress_level=3)


def validate_projection(p):
    for key in ('width', 'height'):
        if not isinstance(p[key], int) or not 32 <= p[key] <= 8192:
            raise ValueError(f'projection.{key} must be an integer between 32 and 8192')
    if not all(np.isfinite(p[key]) for key in ('yaw', 'pitch', 'hfov')):
        raise ValueError('Projection angles must be finite')
    if not -90 <= p['pitch'] <= 90 or not 1 < p['hfov'] < 179:
        raise ValueError('pitch must be in [-90,90]; hfov must be in (1,179)')
    crop = p['crop']
    if len(crop) != 4 or not all(isinstance(v, int) for v in crop):
        raise ValueError('crop must be [x, y, width, height] in integer pixels')
    x, y, w, h = crop
    if x < 0 or y < 0 or w < 16 or h < 16 or x+w > p['width'] or y+h > p['height']:
        raise ValueError('crop must be contained in the perspective view')


def camera(p):
    yaw, pitch = np.deg2rad([p['yaw'], p['pitch']])
    cp, sp, cy, sy = np.cos(pitch), np.sin(pitch), np.cos(yaw), np.sin(yaw)
    rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]], np.float64)
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], np.float64)
    focal = .5 * p['width'] / np.tan(np.deg2rad(p['hfov']) / 2)
    return rx, ry, focal


def perspective(source, p):
    validate_projection(p)
    h, w = source.shape[:2]
    rx, ry, focal = camera(p)
    xx, yy = np.meshgrid(np.arange(p['width']) - (p['width']-1)/2,
                         np.arange(p['height']) - (p['height']-1)/2)
    rays = np.stack([xx/focal, -yy/focal, np.ones_like(xx)], -1)
    rays /= np.linalg.norm(rays, axis=2, keepdims=True)
    rays = rays @ rx.T @ ry.T
    mx = ((np.arctan2(rays[..., 0], rays[..., 2])/(2*np.pi)+.5)*w).astype(np.float32)
    my = np.clip((np.arcsin(np.clip(rays[..., 1], -1, 1))/np.pi+.5)*h, 0, h-1).astype(np.float32)
    # Wrap longitude only. Replicated vertical padding prevents the nadir from
    # accidentally sampling ceiling pixels when cubic interpolation reaches a pole.
    padded = cv2.copyMakeBorder(source, 2, 2, 0, 0, cv2.BORDER_REPLICATE)
    return cv2.remap(padded, mx, my+2, cv2.INTER_CUBIC, borderMode=cv2.BORDER_WRAP)


def crop_view(view, p):
    x, y, w, h = p['crop']
    return view[y:y+h, x:x+w].copy()


def read_mask(path, shape):
    with Image.open(path) as image:
        array = np.array(image.convert('L'))
    if array.shape != tuple(shape):
        raise ValueError(f'Mask size must match the perspective crop: {shape[1]}x{shape[0]}')
    mask = array >= 128
    if not mask.any():
        raise ValueError('Mask is empty. Paint the equipment and its shadows white first.')
    if mask.all() or mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any():
        raise ValueError('Mask must leave an unmasked border. Enlarge/reposition the perspective crop.')
    return mask


def compose_patch(source, generated, mask, colour_match=True):
    h, w = source.shape[:2]
    gh, gw = generated.shape[:2]
    if abs(gw/gh - w/h) > .01:
        raise ValueError('Model output aspect ratio differs from the crop; refusing to distort it.')
    image = Image.fromarray(generated).resize((w, h), Image.Resampling.LANCZOS)
    candidate = np.array(image)
    correction = np.zeros_like(source, np.float32)
    if colour_match:
        delta = source.astype(np.float32) - candidate.astype(np.float32)
        correction = None
        kernel = np.array([[0, .25, 0], [.25, 0, .25], [0, .25, 0]], np.float32)
        longest = max(w, h)
        levels = [(side, count) for side, count in [(32, 600), (64, 500), (128, 500), (256, 600)] if side < longest]
        levels.append((longest, 900))
        for side, iterations in levels:
            size = (max(1, round(w*side/longest)), max(1, round(h*side/longest)))
            d = cv2.resize(delta, size, interpolation=cv2.INTER_AREA)
            active = cv2.resize(mask.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST) > 0
            correction = d.copy() if correction is None else cv2.resize(correction, size, interpolation=cv2.INTER_LINEAR)
            correction[~active] = d[~active]
            for _ in range(iterations):
                mean = cv2.filter2D(correction, -1, kernel, borderType=cv2.BORDER_REFLECT)
                correction[active] = mean[active]
    result = np.clip(np.rint(candidate.astype(np.float32)+correction), 0, 255).astype(np.uint8)
    result[~mask] = source[~mask]
    return result, candidate


def inverse_map(source, patch, mask, p, feather=4.0, chunk_rows=96):
    validate_projection(p)
    if not np.isfinite(feather) or feather < 0:
        raise ValueError('feather_pixels must be finite and nonnegative')
    h, w = source.shape[:2]
    x0, y0, pw, ph = p['crop']
    if patch.shape[:2] != (ph, pw) or mask.shape != (ph, pw):
        raise ValueError('Patch, mask and projection crop must agree')
    result, support = source.copy(), np.zeros((h, w), np.uint8)
    if feather:
        distance = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
        alpha = np.clip(distance/feather, 0, 1)
        alpha = alpha*alpha*(3-2*alpha)
    else:
        alpha = mask.astype(np.float32)
    rx, ry, focal = camera(p)
    transform = (ry @ rx).astype(np.float32)
    cx, cy = (p['width']-1)/2-x0, (p['height']-1)/2-y0
    longitude = (np.arange(w, dtype=np.float32)/w-.5)*(2*np.pi)
    sine, cosine = np.sin(longitude)[None, :], np.cos(longitude)[None, :]
    for start in range(0, h, chunk_rows):
        end = min(h, start+chunk_rows)
        latitude = (np.arange(start, end, dtype=np.float32)/h-.5)[:, None]*np.pi
        world = np.empty((end-start, w, 3), np.float32)
        world[..., 0], world[..., 1], world[..., 2] = sine*np.cos(latitude), np.sin(latitude), cosine*np.cos(latitude)
        local = world @ transform
        z = local[..., 2]
        denominator = np.where(np.abs(z) < 1e-6, 1e-6, z)
        mx = (local[..., 0]/denominator*focal+cx).astype(np.float32)
        my = (-local[..., 1]/denominator*focal+cy).astype(np.float32)
        valid = (z > 0) & (mx >= 0) & (mx <= pw-1) & (my >= 0) & (my <= ph-1)
        weight = cv2.remap(alpha, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
        weight[~valid] = 0
        active = weight > 0
        if not active.any():
            continue
        mapped = cv2.remap(patch, mx, my, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        mixed = np.clip(np.rint(source[start:end].astype(np.float32)*(1-weight[..., None])
                               + mapped.astype(np.float32)*weight[..., None]), 0, 255).astype(np.uint8)
        result[start:end][active] = mixed[active]
        support[start:end][active] = 255
    return result, support


def outside_changes(source, result, support):
    if source.shape != result.shape:
        raise ValueError('Final panorama size differs from its source')
    count = 0
    for y in range(0, source.shape[0], 96):
        changed = np.any(source[y:y+96] != result[y:y+96], axis=2)
        count += int(np.sum(changed & (support[y:y+96] == 0)))
    return count


def save_panorama_jpeg(path, rgb):
    h, w = rgb.shape[:2]
    xmp = f'''<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:GPano="http://ns.google.com/photos/1.0/panorama/" GPano:ProjectionType="equirectangular" GPano:UsePanoramaViewer="True" GPano:FullPanoWidthPixels="{w}" GPano:FullPanoHeightPixels="{h}" GPano:CroppedAreaImageWidthPixels="{w}" GPano:CroppedAreaImageHeightPixels="{h}" GPano:CroppedAreaLeftPixels="0" GPano:CroppedAreaTopPixels="0"/></rdf:RDF></x:xmpmeta>'''
    Image.fromarray(rgb).save(path, quality=95, subsampling=0, xmp=xmp.encode())
