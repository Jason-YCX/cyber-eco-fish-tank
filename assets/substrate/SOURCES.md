# 底床实物参照

鱼缸使用同坐标的颜色、OpenGL 法线、高度及粗糙度图。颗粒的高度进入网格和近看的视差计算。下表的角度是视线偏离样块法线的角度，正俯视为 0°。

整缸铺设时，在不规则区域内旋转和错开样块，颜色、坡面方向与位移使用相同的取样和过渡权重。抽屉与实物对照保留原样块坐标，便于逐粒检查。[随机取样与拼接方法，Deliot 与 Heitz](https://eheitzresearch.wordpress.com/738-2/)

拖动底床会在挖走和堆起的位置之间转移等量体积。暖红砂超过临界坡度后沿坡滑落，草泥采用较慢的松弛和黏聚屈服，保留沟痕。发生侵蚀的位置可扬起少量细泥，较粗的砂粒贴近床面移动。速度、粒子数与黏聚参数按鱼缸交互尺度选取。[水下颗粒滑落实验](https://pubmed.ncbi.nlm.nih.gov/12570427/) · [天然黏泥流变实验](https://research.utwente.nl/en/publications/rheology-of-cohesive-sediments-comparison-between-a-natural-and-a/) · [砂粒与细料的输移实验](https://ascelibrary.org/doi/10.1061/%28ASCE%29WW.1943-5460.0000054)

| 底床 | 实物与取样 | 样块宽度 / 高程量程 | 独立实拍核对 |
|---|---|---|---|
| 黑褐草泥 | 德累斯顿工大 Plot 0，2021-07-21 的同一块框内褐土 | 96 mm / 14.97 mm | 两台相机测高，第三台约 49°；32 处留出地标中位偏差 0.70 px，平面为 4.43 px。[实拍叠图](../../design/水族素材纹理/实拍配准/草泥/草泥斜拍与模型.png) |
| 暖红砂 | NASA 好奇号在 Rocknest 的同一块天然风成砂，Sol 55、56、58、102 | 32.768 mm / 2.17 mm | Sol 102 的 45.7°、Sol 55 的 49.5°、Sol 56 的 28.4° 都拍到这块砂面。Sol 58 的 0491 微距另有 233 处留出地标，中位偏差 0.14 px。[大斜角叠图](../../design/水族素材纹理/实拍配准/暖红砂/Mastcam/暖红砂双角度对照.png) |
| 杂色河砾 | Amal Kumar 的 Ganges River Pebbles；色卡附近的原位置使用同一扫描的高清局部 | 82 mm / 外围 5.93 mm、高清区 4.74 mm | 色卡近照拟合约 4.7°。在实际 640 × 464 渲染区重认的 48 个特征，中位偏差 1.60 px，90 分位 7.09 px。现场斜拍光轴离法线约 64.6°，原近照视野在宽景中约 51 × 25 像素，可见的浅灰圆石和小浅石能对回原位。现场斜拍的 15 个留出地标，中位偏差从旧高度 3.62 px 降到 3.08 px，压平为 7.60 px。[交互对照](../../design/水族素材纹理/实拍配准/实拍与模型.html#gravel) |

草泥相片和衍生素材署名 Lea Epple、Anette Eltner、Oliver Grothum、Anne Bienert，采用 CC BY 4.0。采集物为日光下的表土，缸内通过线性颜色系数 0.46 表现湿泥；粗糙度 226/255 为哑光估值。[原始数据](https://doi.org/10.25532/OPARA-1038) · [拍摄方法](https://essd.copernicus.org/articles/18/1275/2026/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

暖红砂照片署名 NASA/JPL-Caltech/MSSS。根据信息完整的四份父曝光相机标签建立初始坐标，以三组照片的同名颗粒拟合起伏。第四台相机的控制点只校正机位，其余匹配点用于测误差。源图的光照按测得的法线分离后交给缸内灯光重新着色，粗糙度是材质估值。原片、相机标签、三角测量与可旋转的样块保存在设计目录。[Rocknest 砂粒说明](https://science.nasa.gov/photojournal/windblown-sand-from-the-rocknest-drift/) · [0491 原片](https://mars.nasa.gov/raw_images/29145/?site=msl) · [PDS 相机档案](https://planetarydata.jpl.nasa.gov/img/data/msl/MSLMHL_0001/DATA/RDR/SURFACE/0058/) · [JPL 图像使用及署名](https://www.jpl.nasa.gov/jpl-image-use-policy/)

Mastcam 的两个大斜角均用中心样块以外的纹理修正遥测机位，中心独立检验。45.7° 机位用了 25 个外围窗口，49.5° 用了 58 个。用 0.85 倍校正重建起伏，并重算法线与颜色后，Sol 55、56、58、102 四个机位的纹理对照均改善。相机约 0.90 与 0.70 mm/像素，适合核对颗粒群，单粒表面的细纹取自 MAHLI 微距。对照脚本 `python3 tools/check_rocknest_mastcam.py` 读取实际打包高度、颜色和法线，按各自的太阳方向渲染。[Sol 102 原片](https://mars.nasa.gov/msl-raw-images/msss/00102/mcam/0102ML0006750020103025E01_DXXX.jpg) · [Sol 55 原片](https://mars.nasa.gov/msl-raw-images/msss/00055/mcam/0055ML0002540080102275E01_DXXX.jpg)

河砾的源资产由 Amal Kumar 实地采集，颜色与高程来自 Poly Haven，生产扫描采用 CC0。[原始资产及两张现场照片](https://polyhaven.com/a/ganges_river_pebbles) · [Poly Haven 许可](https://polyhaven.com/license)

在项目根目录使用 Python 3 运行以下脚本。图像重建用 NumPy、OpenCV、SciPy、Pillow，离线贴图打包用 FFmpeg。

- 草泥可用 `python3 tools/reconstruct_opara_soil.py` 重建源图。
- 暖红砂可依次用 `python3 tools/calibrate_rocknest_sand.py`、`python3 tools/build_rocknest_sand.py` 重建相机与源图。
- `python3 tools/build_substrate_textures.py` 打包三套底床，`python3 tools/build_river_detail.py` 打包河砾高清区域。
- 暖红砂对照和 GLB 可用 `python3 tools/check_rocknest_view.py` 从实际打包材质重建。另有 [三套底床实时渲染核对](../../design/水族素材纹理/底床实物扫描对照.png) 和 [35°、68° 共 48 个模拟角度](../../design/水族素材纹理/底床环绕核对.jpg) 可查看实时渲染在大角度下的表现。

[CUReT 的五机位砾石研究](../../design/水族素材纹理/砾石实拍五机位研究.png) 记录了早期的独立大学样块实验。该样块只作研究，生产使用上表中的恒河实物。[大学样本库](https://www.cs.columbia.edu/CAVE/software/curet/)
