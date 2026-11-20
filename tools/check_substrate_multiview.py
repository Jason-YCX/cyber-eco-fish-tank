"""Measure held-out gravel landmark reprojection. Input: CUReT sample08.zip.
Needs Python with NumPy and OpenCV (SIFT); gzip reads the archive's Unix .Z images.
"""
import argparse
import subprocess
from zipfile import ZipFile

import cv2
import numpy as np


def measure(archive):
    # Sample pose 03 keeps lighting and orientation fixed across these five cameras.
    angles = {2: 33.75, 3: 11.25, 4: -11.25, 5: -33.75}
    target = np.float32([[0, 0], [339, 0], [339, 339], [0, 339]])
    sift = cv2.SIFT_create(2000, contrastThreshold=.009)
    contrast = cv2.createCLAHE(2, (5, 5))
    points, features, rectifiers = {}, {}, {}
    for camera in angles:
        stem = f"sample08/08-{camera:02d}-03"
        corners = np.fromstring(archive.read(stem+".cnr"), sep=" ", dtype=np.float32).reshape(4, 2)
        bmp = subprocess.run(["gzip", "-cd"], input=archive.read(stem+".bmp.Z"),
                             check=True, stdout=subprocess.PIPE).stdout
        # Match the conversion used for the study: RGB decode, then luminance.
        raw = cv2.imdecode(np.frombuffer(bmp, np.uint8), cv2.IMREAD_COLOR)
        rectifiers[camera] = cv2.getPerspectiveTransform(corners, target)
        crop = cv2.warpPerspective(raw, rectifiers[camera], (340, 340))
        grayscale = contrast.apply(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))
        points[camera], features[camera] = sift.detectAndCompute(grayscale, None)

    bf = cv2.BFMatcher()

    def matches(a, b):
        return {first.queryIdx: first.trainIdx for first, second in bf.knnMatch(features[a], features[b], k=2)
                if first.distance < .76 * second.distance}

    pairs = {}
    for camera in (2, 4, 5):
        forward, backward = matches(3, camera), matches(camera, 3)
        pairs[camera] = {i: j for i, j in forward.items() if backward.get(j) == i}
    tracks = np.array(sorted(set.intersection(*(set(pair) for pair in pairs.values()))))
    ref = np.array([points[3][i].pt for i in tracks])
    unique = np.unique(ref.round(), axis=0, return_index=True)[1]
    ref, tracks = ref[unique], tracks[unique]
    controls = np.arange(len(tracks)) % 4 == 0
    rectified = {3: ref}
    for camera in (2, 4, 5):
        uv = np.array([points[camera][pairs[camera][i]].pt for i in tracks])
        plane, _ = cv2.findHomography(uv[controls], ref[controls], cv2.USAC_MAGSAC, 2)
        rectified[camera] = cv2.perspectiveTransform(uv[:, None, :], plane)[:, 0]
        if camera == 4:
            to_sensor = np.linalg.inv(rectifiers[camera]) @ np.linalg.inv(plane)

    train = (2, 3, 5)
    slopes = np.tan(np.deg2rad([angles[j] for j in train]))
    design = np.column_stack((np.ones(len(slopes)), slopes))
    sample = np.stack([rectified[j] for j in train])
    flat_position, relief = np.einsum("kl,lij->kij", np.linalg.pinv(design), sample)
    prediction = flat_position + np.tan(np.deg2rad(angles[4])) * relief

    def sensor(uv):
        return cv2.perspectiveTransform(uv[~controls, None, :], to_sensor)[:, 0]

    observed = sensor(rectified[4])
    miss = np.linalg.norm(sensor(prediction)-observed, axis=1)
    print(f"{len(miss)} held-out landmarks; median {np.median(miss):.3f} px; "
          f"90th percentile {np.quantile(miss, .90):.3f} px")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sample08_zip")
    with ZipFile(parser.parse_args().sample08_zip) as archive:
        measure(archive)
