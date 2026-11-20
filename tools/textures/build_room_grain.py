"""Pack repeatable close-up surface detail for the baked room. Requires NumPy and ffmpeg."""
import base64
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[2] / 'assets'
SOURCES = ROOT / 'living-room-textures'
SIZE = 384


def crop(path, filter_chain):
    rgb = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-vf',
                                   f'{filter_chain},scale={SIZE}:{SIZE}:flags=lanczos',
                                   '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(rgb, np.uint8).reshape(SIZE, SIZE, 3).astype(float) / 255


def detail_tile(color, normal, crop_filter, pigment):
    albedo = crop(color, crop_filter) @ [.2126, .7152, .0722]
    n = 2 * crop(normal, crop_filter) - 1
    slope = n[:, :, :2] / np.maximum(n[:, :, 2:], .30)
    # Recover mid-scale height from the normal scan. Suppress board joints and
    # broad dyed patterns already stored in the baked room atlas.
    fx = np.fft.fftfreq(SIZE)[None, :] * (2*np.pi)
    fy = np.fft.fftfreq(SIZE)[:, None] * (2*np.pi)
    power = fx*fx + fy*fy
    height = np.fft.ifft2((1j*fx*np.fft.fft2(slope[:,:,0]) - 1j*fy*np.fft.fft2(slope[:,:,1])) /
                          np.maximum(power, 1e-6) * (1-np.exp(-22*power))).real
    fine_color = np.fft.ifft2(np.fft.fft2(albedo) * (1-np.exp(-30*power))).real

    def centered(values):
        return values / max(np.percentile(np.abs(values), 94), .003)

    packed = np.empty((SIZE, SIZE, 3), np.uint8)
    packed[:,:,:2] = np.rint(127.5 + 115 * np.clip(slope, -1, 1))
    packed[:,:,2] = np.rint(127.5 + 65*np.clip((1-pigment)*centered(height) +
                                                 pigment*centered(fine_color), -1.9, 1.9))
    jpeg = subprocess.run(['ffmpeg','-v','error','-f','rawvideo','-pix_fmt','rgb24',
                           '-s',f'{SIZE}x{SIZE}','-i','-','-c:v','mjpeg','-q:v','3',
                           '-pix_fmt','yuvj444p','-frames:v','1','-f','image2pipe','-'],
                          input=packed.tobytes(), stdout=subprocess.PIPE, check=True).stdout
    return base64.b64encode(jpeg).decode()


tiles = {}
for name, scan, area, color_weight in [
        ('linen', 'rough_linen', 'crop=320:320:352:352', .18),
        ('wool', 'wool_boucle', 'crop=260:260:360:460', .12),
        ('veneer', 'grey_oak_veneer_02', 'crop=420:420:240:220', .65),
        ('floor', 'wooden_floor_02', 'crop=256:120:570:280', .72)]:
    tiles[name] = detail_tile(SOURCES / (scan+'-color.jpg'), SOURCES / (scan+'-normal.jpg'), area, color_weight)
stone = ROOT / 'stone/source-textures'
tiles['mineral'] = detail_tile(stone/'worn_rock_natural_01-Diffuse.jpg', stone/'worn_rock_natural_01-nor_gl.jpg',
                              'crop=400:400:200:300', .43)
(ROOT / 'living-room-v4/room-grain.js').write_text('window.AQUARIUM_ROOM_GRAIN=' +
                                                   json.dumps(tiles, separators=(',',':')) + ';\n')
