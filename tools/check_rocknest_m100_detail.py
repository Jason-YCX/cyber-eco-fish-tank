"""Render the current Rocknest mesh against the Sol 56 Mastcam 100 mm exposure."""
import json

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from check_rocknest_mastcam import BACKGROUND, DIRECTORY, Grid, local_contrast, maps, render


DETAIL = DIRECTORY / '细节'


def photograph(view):
    width, height = view['size']
    raw = np.fromfile(DETAIL / (view['product']+'.IMG'), dtype='>u2').reshape(3, height, width)
    rgb = np.moveaxis(raw.astype(np.float32), 0, -1)
    rgb[rgb == 4096] = 0
    low, high = np.percentile(rgb[rgb > 0], [.15, 99.9])
    image = Image.fromarray(np.uint8(255*np.clip((rgb-low)/(high-low), 0, 1)**.85))
    image.save(DETAIL/view['original'])
    x, y, w, h = view['crop']
    return np.array(image.crop((x, y, x+w, y+h)))


def board(photo, model, mix):
    canvas = Image.new('RGB', (1260, 655), '#172520')
    draw = ImageDraw.Draw(canvas)
    def write(x, y, words, size, color='#d8e2d9'):
        font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', size)
        draw.text((x, y), words, font=font, fill=color)
    write(27, 21, '暖红砂　｜　近看砂粒的轮廓与间隙', 35, '#f4efdf')
    write(29, 76, 'Rocknest 同一块 32.768 毫米砂面   ·   Mastcam 右相机 Sol 56   ·   视线偏离样块法线约 28°', 20)
    left = [27, 444, 861]
    for x, heading in zip(left, ['实拍局部', '同机位三维模型', '黄框放大　｜　50% 叠图']):
        write(x, 132, heading, 22, '#e6bc7e')
    rect = (40, 40, 123, 120)
    # The source is shaded. A common display curve preserves the comparison.
    lut = [round(255*(v/255)**.72) for v in range(256)]*3
    for i, panel in enumerate([photo, model, mix.crop(rect)]):
        panel = panel.point(lut)
        scale = min(368/panel.width, 354/panel.height)
        width, height = (round(q*scale) for q in panel.size)
        x, y = left[i]+(368-width)//2, 178+(354-height)//2
        canvas.paste(panel.resize((width, height), Image.Resampling.NEAREST), (x, y))
        if i < 2:
            draw.rectangle((x+rect[0]*scale, y+rect[1]*scale, x+rect[2]*scale-1,
                            y+rect[3]*scale-1), outline='#e6bc7e', width=2)
    draw.line((29, 551, 1230, 551), fill='#4c6352')
    write(28, 572, '每个原始像素约 0.19 毫米。相机用样块外围定位，框内亮粒、暗隙及轮廓用于独立比对。', 20)
    write(29, 615, '同一显示曲线提亮阴影。图像来源 NASA / JPL-Caltech / MSSS。', 17, '#afc5b7')
    canvas.save(DETAIL / '暖红砂颗粒斜拍对照.png')


def main():
    path = DETAIL / '机位与留出颗粒.json'
    view = json.loads(path.read_text())
    photo = photograph(view)
    color, normal, height, _, _ = maps()
    grid = Grid(height)
    rgb, alpha = render(view, color, normal, grid)
    flat, _ = render(view, color, normal, grid, displaced=False)
    interior = cv2.erode((alpha > .985).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    gain = photo[interior].mean(axis=0)/rgb[interior].mean(axis=0)
    reference = local_contrast(photo)[interior]
    view['centralCorrelation'] = {name: float(np.corrcoef(reference, local_contrast(pix*gain)[interior])[0, 1])
                                  for name, pix in [('flat', flat), ('mesh', rgb)]}
    view['displayRgbGain'] = gain.tolist()
    path.write_text(json.dumps(view, ensure_ascii=False, indent=2)+'\n')
    rgb = np.uint8(np.clip(np.rint(rgb*gain), 0, 255))
    rgba = np.dstack([rgb, np.uint8(np.rint(alpha*255))])
    Image.fromarray(rgba).save(DETAIL / '同机位模型.png')
    opacity = alpha[:, :, None]/2
    mix = Image.fromarray(np.uint8(np.rint(photo*(1-opacity)+rgb*opacity)))
    mix.save(DETAIL / '半透明叠图.png')
    model = np.uint8(np.rint(rgb*alpha[:, :, None]+np.array(BACKGROUND)*(1-alpha[:, :, None])))
    board(Image.fromarray(photo), Image.fromarray(model), mix)
    print(view['centralCorrelation'])


if __name__ == '__main__':
    main()
