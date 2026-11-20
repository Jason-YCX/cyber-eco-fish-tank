"""Rebuild the registered soil channels from the two original TU Dresden photographs."""
import json
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
STUDY = ROOT / "design/水族素材纹理/实拍配准/草泥"
OUTPUT = ROOT / "assets/substrate/source"
SIZE = 1024
CROP = (100, 80, 696)
NAMES = ("IMG_0530", "IMG_1948", "IMG_0034")


def load_calibration():
    return {key: np.array(value)
            for key, value in json.loads((STUDY / "相机标定.json").read_text()).items()}


def project(points, model, camera):
    local = points @ model["rs"][camera].T + model["ts"][camera]
    xy = local[..., :2] / local[..., 2:]
    radial = 1 + model["ks"][camera] * np.sum(xy * xy, axis=-1, keepdims=True)
    return (xy * radial * model["fs"][camera] + [2136, 1424]).astype(np.float32)


def lookup(image, xy):
    return cv2.remap(image, xy.astype(np.float32), None, cv2.INTER_LINEAR,
                     borderMode=cv2.BORDER_REFLECT_101)


def ground_grid(model):
    axis = (np.arange(SIZE, dtype=np.float32) + .5) / SIZE - .5
    x, y = np.meshgrid(axis, axis)
    return (model["origin"] + (x[..., None] * model["axis"] +
                               y[..., None] * model["ay"]) * model["side"]).astype(np.float32)


def to_grid(points, model):
    delta = points - model["origin"]
    xy = np.stack((delta @ model["axis"], delta @ model["ay"]), axis=-1)
    return (xy / model["side"] + .5) * SIZE - .5


def elevation(photos, model, ground):
    """Triangulate flow along source rays. Camera III does not enter reconstruction."""
    canonical = [lookup(photos[i], project(ground, model, i)) for i in (0, 1)]
    contrast = cv2.createCLAHE(2., (12, 12))
    gray = [contrast.apply(cv2.cvtColor(im, cv2.COLOR_BGR2LAB)[:, :, 0]) for im in canonical]
    flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow.setFinestScale(0)
    flow.setPatchSize(12)
    flow.setPatchStride(4)
    flow.setVariationalRefinementIterations(12)
    forward = flow.calc(gray[0], gray[1], None)
    backward = flow.calc(gray[1], gray[0], None)

    pixels = np.stack(np.meshgrid(np.arange(SIZE, dtype=np.float32),
                                  np.arange(SIZE, dtype=np.float32)), axis=-1)
    cycle = np.linalg.norm(forward + lookup(backward, pixels + forward), axis=-1)
    normal = model["n"]
    ray = ground / (ground @ normal)[..., None]
    center = -model["rs"][1].T @ model["ts"][1]
    sight = ground + ray * (.010 * model["side"]) - center
    plane = center + sight * (((model["origin"] - center) @ normal) /
                               (sight @ normal))[..., None]
    parallax = (to_grid(plane, model) - pixels) / .010
    height = (forward * parallax).sum(-1) / (parallax * parallax).sum(-1)
    transverse = np.linalg.norm(forward - height[..., None] * parallax, axis=-1)
    reliable = (cycle <= 2) & (transverse <= 2.2) & np.isfinite(height) & (abs(height) <= .12)
    support = reliable.astype(np.float32)
    for radius in (1.5, 4, 10, 25):
        weight = cv2.GaussianBlur(support, (0, 0), radius)
        weighted = cv2.GaussianBlur(height * support, (0, 0), radius)
        fill = (support == 0) & (weight > .08)
        height[fill] = weighted[fill] / weight[fill]
        support[fill] = 1
    height = cv2.bilateralFilter(ndimage.median_filter(height.astype(np.float32), size=3),
                                 7, .003, 1.4)

    # Highest visible surface wins when separate source rays hit a common texel.
    surface = ground + ray * height[..., None] * model["side"]
    ix, iy = np.rint(to_grid(surface, model)).astype(np.int32).transpose(2, 0, 1)
    good = (ix >= 0) & (ix < SIZE) & (iy >= 0) & (iy < SIZE)
    regular = np.full((SIZE, SIZE), -1., np.float32)
    np.maximum.at(regular, (iy[good], ix[good]), height[good])
    empty = regular < -.5
    nearest = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
    regular[empty] = regular[tuple(nearest[:, empty])]
    return ndimage.gaussian_filter(regular, 1.35)


def seamless(channel, width=17):
    channel = channel.astype(np.float32)
    for axis in (0, 1):
        rows = np.moveaxis(channel, axis, 0)
        for i in range(width):
            k = .25 * (1 + np.cos(np.pi * i / width))
            a, b = rows[i].copy(), rows[-i - 1].copy()
            rows[i] = a * (1 - k) + b * k
            rows[-i - 1] = b * (1 - k) + a * k
    return channel


def uint8(value):
    return np.uint8(np.clip(np.rint(value), 0, 255))


def write(channel, image):
    options = [cv2.IMWRITE_JPEG_QUALITY, 97, cv2.IMWRITE_JPEG_SAMPLING_FACTOR,
               cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444]
    path = OUTPUT / f"opara_plot0_soil-{channel}.jpg"
    if not cv2.imwrite(str(path), image, options):
        raise OSError(f"Could not write {path}")


def main():
    model = load_calibration()
    photos = [cv2.imread(str(STUDY / "原片" / (name + ".jpg"))) for name in NAMES[:2]]
    if not all(im is not None and im.shape[:2] == (2848, 4272) for im in photos):
        raise ValueError("Camera I and II need their original 4272 × 2848 images.")
    ground = ground_grid(model)
    z = elevation(photos, model, ground)
    surface = ground + (z[..., None] * model["side"] * model["n"]).astype(np.float32)
    colour = lookup(photos[0], project(surface, model, 0))
    x, y, length = CROP
    roi = np.s_[y:y + length, x:x + length]
    colour = cv2.resize(seamless(colour[roi]), (SIZE, SIZE), interpolation=cv2.INTER_CUBIC)
    height = seamless(z[roi]) * SIZE / length
    lower, upper = np.percentile(height, [.5, 99.5])
    ratio = upper - lower
    height = cv2.resize(np.clip((height - lower) / ratio, 0, 1), (SIZE, SIZE))
    dy, dx = np.gradient(height * ratio * SIZE)
    normal = np.dstack((-dx, dy, np.ones_like(dx)))
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    write("color", uint8(colour))
    write("height", uint8(height * 255))
    write("normal", uint8((normal + 1) * 127.5)[:, :, ::-1])
    write("roughness", np.full((SIZE, SIZE), 226, np.uint8))
    metadata = {"heightRatio": float(ratio), "source": "https://doi.org/10.25532/OPARA-1038",
                "license": "CC BY 4.0", "heightRange": "0.5 to 99.5 stereo elevation percentiles"}
    (OUTPUT / "opara_plot0_soil-calibration.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Rebuilt four channels. Height span / tile width = {ratio:.6f}")


if __name__ == "__main__":
    main()
