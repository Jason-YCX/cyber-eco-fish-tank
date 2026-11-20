# 鱼类实物参照

## 模型用到的照片

| 鱼与可见角度 | 摄影、原图与许可 | 用途 |
|---|---|---|
| 扇尾孔雀鱼，侧面 | D3LL 摄影，Togabi 调色。[Guppy1.jpg](https://commons.wikimedia.org/wiki/File:Guppy1.jpg)，[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 转正同一张照片后，沿躯干、尾扇和背鳍描点，取其眼部、鱼身和鳍纹。 |
| 浅色孔雀鱼，侧面和转身 | 胡正恆（Jackson Hu），2025-07-05。[观察 295255577](https://www.inaturalist.org/observations/295255577)，[侧面 531510628](https://www.inaturalist.org/photos/531510628)、[转身 531510605](https://www.inaturalist.org/photos/531510605)，CC BY | 同一观察中有多条鱼。选定雄鱼的尾叶外缘有一列黑斑，靠下有橙斑，尾柄两侧有橙绿色区。两图用这些标志辨认。前者用于体侧和尾形，后者用于头背颜色和斜视复核。Demo 中第二条新增孔雀鱼轮换到此形态。 |
| 熊猫鼠鱼，侧面 | Chrischang。[Corydoras panda 1.jpg](https://commons.wikimedia.org/wiki/File:Corydoras_panda_1.jpg)，[CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) | 侧面轮廓、鳍根、眼眶和头部黑带。 |
| 熊猫鼠鱼，斜俯转身 | Matthew Inabinett。[观察 240558957](https://www.inaturalist.org/observations/240558957)，[428596329](https://www.inaturalist.org/photos/428596329)、[428596424](https://www.inaturalist.org/photos/428596424)，CC BY | 同一段树根旁的两次拍摄，按前景鱼头尾的黑带、背鳍和位置辨认。第二幅用于头背纹理，两幅用于斜俯对照。这条鱼与 Chrischang 的侧面鱼为不同个体。 |
| 大斑小精灵，侧面 | Rainer Schmitt。[Otocinclus macrospilus 2.jpg](https://commons.wikimedia.org/wiki/File:Otocinclus_macrospilus_2.jpg)，[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 侧线、眼眶、尾柄斑、背鳍以及能看见的尾缘。照片最左边裁去了少许尾叶。 |
| 大斑小精灵，腹面 | Kaden Slone。[观察 336851916](https://www.inaturalist.org/observations/336851916)，[612219819](https://www.inaturalist.org/photos/612219819)，CC BY | 另一条附着前玻璃的活鱼。沿鼻端至尾柄标出腹部轮廓，测得最宽处约 86 像素，鼻端至尾柄轴长约 340 像素（参照图宽 740 像素）。用于鱼体宽度、腹侧色图和口盘位置。 |
| 大斑小精灵，贴壁斜面 | Carl Meilahn。[Otocinclus macrospilus.jpg](https://commons.wikimedia.org/wiki/File:Otocinclus_macrospilus.jpg)，[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) | 对照贴壁时胸鳍向两侧伸展的姿态。与上述照片无法逐个体配准。 |

原照片及逐角对照图中的照片裁切分别按表中许可使用。裁切、翻转、旋转、色偏校正及蒙皮取样由本项目完成。浅色孔雀鱼和熊猫鼠鱼的斜视相机依头、尾柄配准，采用统一比例，活鱼的弯曲和展鳍程度会留下可见差异。

## 独立的形态资料

- 孔雀鱼镜像视频由 Daphne Soares 与 Hilary S. Bierman 拍摄。作者在侧面用镜子同步记录同一条雄鱼的侧视、俯视。文件 `guppy-mirror-s2.ogv` 对应 Video S2。这个体是野生种群来源的短尾品系，首帧俯视鱼长约 40 像素，只辅助约束躯干宽度。[论文与拍摄方式](https://doi.org/10.1371/journal.pone.0061617) · [视频来源与 CC BY 3.0 许可](https://commons.wikimedia.org/wiki/File:Aerial-Jumping-in-the-Trinidadian-Guppy-%28Poecilia-reticulata%29-pone.0061617.s002.ogv)
- 熊猫鼠鱼正模 BMNH 1969.7.15.8 的原始描述记载标准体长 41.9 毫米、胸鳍棘处体宽 13.0 毫米、背侧骨板 23 枚、腹侧骨板 20 枚。模型用该比例限制体宽，并分两排构造体侧骨板。[Nijssen 与 Isbrücker，1971](https://repository.naturalis.nl/pub/504807/BEAU1971018239001.pdf)

## 重建与复核

从项目根目录执行 `python3 tools/textures/build_fish_photos.py`，需要 NumPy 和 FFmpeg。脚本从原图重建可编辑轮廓、鳍缘、眼部位置及离线贴图。

`node tools/textures/check_fish_registration.cjs` 读取 Demo 真实鱼身网格，每种形态取六个未作建模截面的纵向位置，比较各处背缘和腹缘的投影，共 48 个坐标。使用与描点相同的侧照，误差单位为参照图像素。浅色孔雀鱼用原图 499 像素宽，其余三组用转正前 800 像素宽的参考坐标。这个量度只覆盖这些位置的鱼身轮廓。透明鳍、鱼纹、斜俯面及腹面的差异见 [实拍与模型外缘叠图](../../design/水族素材纹理/鱼类实拍逐角对照.png)。
