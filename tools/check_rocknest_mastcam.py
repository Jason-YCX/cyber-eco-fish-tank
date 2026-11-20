"""Render the packed 32.768 mm Rocknest mesh in two independent Mastcam observations.

The JSON stores the PDS camera projection of the four mesh corners at 0 and
1 mm above the bed. An affine correction from windows outside the tile accounts
for the rover's change of station. No pixels within the tile determine its pose.
"""
import json

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from check_rocknest_view import Grid, maps
from build_rocknest_sand import SIZE, STUDY


DIRECTORY = STUDY / 'Mastcam'
CORNERS = np.float32([[0, 0], [SIZE-1, 0], [SIZE-1, SIZE-1], [0, SIZE-1]])
BACKGROUND = (27, 37, 35)
GOLD = (243, 192, 102)


def render(view, color, normal, grid, displaced=True):
    """Intersect subpixel camera rays with the same triangles as the GLB."""
    width, height = view['crop'][2:]
    x, y = view['crop'][:2]
    supersampling = 6
    yy, xx = np.indices((height*supersampling, width*supersampling), dtype=np.float32)
    points = np.stack((x+(xx+.5)/supersampling-.5, y+(yy+.5)/supersampling-.5), axis=-1)
    points = points.reshape(-1, 1, 2)
    layers = []
    for key in ('tileCornersAtZeroMm', 'tileCornersAtOneMm'):
        matrix = cv2.getPerspectiveTransform(np.float32(view[key]), CORNERS)
        layers.append(cv2.perspectiveTransform(points, matrix).reshape(*xx.shape, 2))
    # Across 2.56 mm of relief at this range, the two-plane interpolation
    # differs from an exact perspective ray by much less than one sensor pixel.
    flat, raised = layers
    coords = flat
    if displaced:
        for _ in range(6):
            z = grid.at(coords.reshape(-1, 2)).reshape(xx.shape).astype(np.float32)
            coords = flat + (raised-flat)*z[:, :, None]
    mask = np.all((coords >= 0) & (coords <= SIZE-1), axis=-1).astype(np.float32)

    def texture(image):
        rgb = cv2.remap(image, coords, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        return rgb[:, :, ::-1].astype(np.float32)/255

    normals = texture(normal)*2-1
    normals /= np.maximum(np.linalg.norm(normals, axis=-1, keepdims=True), 1e-5)
    sun = np.array(view['sunLocal'], dtype=np.float32)
    lighting = (.46+.54*np.maximum(normals@sun, 0))/(.46+.54*max(sun[2], 0))
    rgb = texture(color)*lighting[:, :, None]

    def integrate(image):
        spread = cv2.GaussianBlur(image, (0, 0), .55*supersampling)
        return cv2.resize(spread, (width, height), interpolation=cv2.INTER_AREA)

    alpha = integrate(mask)
    return integrate(rgb*mask[:, :, None])/np.maximum(alpha[:, :, None], .001), alpha


def local_contrast(rgb):
    gray = rgb.astype(np.float32).mean(axis=2)
    band = gray - cv2.GaussianBlur(gray, (0, 0), 2)
    return band/(cv2.GaussianBlur(abs(band), (0, 0), 4)+.23*abs(band).mean()+1e-5)


def check_localization(view):
    matches = np.array(view['exteriorMatches'])
    xy = matches[:, :2]
    relative = xy-np.median(xy, axis=0)
    held = (relative[:, 0] > 0) ^ (relative[:, 1] > 0)
    design = np.column_stack((xy, np.ones(len(xy))))
    affine = np.linalg.lstsq(design[~held], matches[~held, 2:4], rcond=None)[0]
    residual = np.linalg.norm(design[held]@affine-matches[held, 2:4], axis=1)
    return float(np.median(residual))


def compare(view, color, normal, grid):
    x, y, w, h = view['crop']
    original = Image.open(DIRECTORY/view['original']).convert('RGB')
    photo = np.array(original.crop((x, y, x+w, y+h)))
    rendered, alpha = render(view, color, normal, grid)
    interior = cv2.erode((alpha > .985).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    # One exposure and white-balance adjustment for the whole model image.
    balance = photo[interior].mean(axis=0)/rendered[interior].mean(axis=0)
    model = np.uint8(np.clip(np.rint(rendered*balance), 0, 255))
    flat, _ = render(view, color, normal, grid, displaced=False)
    reference = local_contrast(photo)[interior]
    scores = [float(np.corrcoef(reference, local_contrast(v)[interior])[0, 1])
              for v in (flat*balance, rendered*balance)]
    rgba = np.dstack([model, np.uint8(np.rint(alpha*255))])
    Image.fromarray(rgba).save(DIRECTORY/f"Sol{view['sol']}-模型.png")
    mesh = Image.new('RGB', (w, h), BACKGROUND)
    mesh.paste(Image.fromarray(model), mask=Image.fromarray(rgba[:, :, 3]))
    opacity = alpha[:, :, None]*.5
    mix = Image.fromarray(np.uint8(np.rint(photo*(1-opacity)+model*opacity)))
    return Image.fromarray(photo), mesh, mix, scores


def board(views, panels):
    canvas = Image.new('RGB', (1270, 834), '#172520')
    draw = ImageDraw.Draw(canvas)
    def write(x, y, words, size=17, color='#d0ddd5'):
        font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', size)
        draw.text((x, y), words, font=font, fill=color)
    write(28, 19, '暖红砂　｜　同一块 Rocknest 砂面的两个斜角', 35, '#f3f0df')
    write(30, 70, 'NASA / JPL-Caltech / MSSS   ·   左侧直接裁切公开原片   ·   黄框对应右侧 50% 叠图', 19)
    labels = ['Mastcam 实拍', '同机位三维模型', '黄框局部放大叠图']
    for col, label in enumerate(labels):
        write(30+col*416, 111, label, 20, '#e6bc7e')
    for row, (view, (photo, mesh, mix, scores)) in enumerate(zip(views, panels)):
        top = 152+row*294
        x0, y0, w, h = view['crop']
        projected = np.float32(view['tileCornersAtZeroMm'])
        homography = cv2.getPerspectiveTransform(CORNERS, projected)
        focal = cv2.perspectiveTransform(np.float32([[[465, 510]]]), homography)[0, 0]-[x0, y0]
        hw, hh = max(5, round(w*.14)), max(4, round(h*.15))
        cx, cy = np.rint(focal).astype(int)
        rect = (cx-hw, cy-hh, cx+hw+1, cy+hh+1)
        write(30, top, f"Sol {view['sol']}     {view['angleFromNormal']:.1f}°     原片约 {view['pixelMm']:.2f} mm / 像素", 20, '#f4e8cf')
        for col, im in enumerate((photo, mesh, mix.crop(rect))):
            scale = min(390/im.width, 224/im.height)
            size = tuple(round(dim*scale) for dim in im.size)
            inset = im.resize(size, Image.Resampling.NEAREST)
            left = 24+col*416+(400-size[0])//2
            y = top+36+(224-size[1])//2
            canvas.paste(inset, (left, y))
            if col < 2:
                draw.rectangle((left+rect[0]*scale, y+rect[1]*scale,
                                left+rect[2]*scale-1, y+rect[3]*scale-1), outline=GOLD, width=2)
    draw.line((28, 745, 1240, 745), fill='#46594d')
    write(29, 761, '同一块宽 32.768 mm 的砂面。暗色轮廓是模型边界。机位用样块外围定位，中心颗粒独立对照。', 18)
    write(29, 793, '斜拍能辨成组的亮粒和宽颗粒间隙，细于单个相机像素的表面纹理需在 MAHLI 微距原片中看。', 17)
    canvas.save(DIRECTORY/'暖红砂双角度对照.png')


if __name__ == '__main__':
    observations = json.loads((DIRECTORY/'机位.json').read_text())
    color, normal, height, _, _ = maps()
    panels = [compare(view, color, normal, Grid(height)) for view in observations]
    board(observations, panels)
    for view, (_, _, _, scores) in zip(observations, panels):
        print(f"Sol {view['sol']}  exterior windows {len(view['exteriorMatches'])}, "
              f"quadrant holdout median {check_localization(view):.2f}px; "
              f"central texture correlation: flat {scores[0]:.3f}, mesh {scores[1]:.3f}")
