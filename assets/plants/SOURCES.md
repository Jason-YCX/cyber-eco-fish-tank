# 水草叶面实拍来源

三个品种分别使用本物种叶片照片制作叶面纹理。制作时沿叶脉校正透视、避开轮廓和背景，再提取局部亮度和色差。运行时按每片叶的方向贴合，另外生成起伏、粗糙度、透光和品种花纹。

| 源图 | 摄影者 | 使用部分及许可 |
| --- | --- | --- |
| [Micranthemum tweediei-1-veda aquarium-bengaluru-India.jpg](https://commons.wikimedia.org/wiki/File:Micranthemum_tweediei-1-veda_aquarium-bengaluru-India.jpg) | Yercaud-elango | 原照裁切的沉水草毯，两枚叶片内的颜色变化。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| [Vallisneria spiralis.jpg](https://commons.wikimedia.org/wiki/File:Vallisneria_spiralis.jpg) | Lara Gudmundsdottir | 原照内的一条苦草叶，保留纵向色差。虎纹栽培型的短横斑单独绘制。[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [Big leaves Phyllanthus fluitans.jpg](https://commons.wikimedia.org/wiki/File:Big_leaves_Phyllanthus_fluitans.jpg) | Monarchatto | 缩小的叶面微距，取两枚浮叶的叶肉和中脉附近观测值。[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

source 目录的裁片和 leaf-photo-data.js 内对应的衍生照片数据沿用表中的各自许可。使用 Python 3 及 FFmpeg 执行同目录的 bake_leaf_samples.py 可从源裁片重新生成数据。Demo 直接读取已生成的数据。

## 同叶对位

两类阔叶的几何叶缘和叶面颜色取自同一枚叶片。像素标志点存于 `leaf_landmarks.py`，`bake_leaf_samples.py` 按叶柄到叶尖的坐标同时生成轮廓与颜色，使照片中的叶缘、斑点及中脉对在同一位置。水草对照图左列为取形照片，中列为从 Demo 水草网格中截出的单叶。右列将同一网格投到第二张照片，使用叶面或邻近物的匹配特征估计视角，独立描出照片叶缘计算交并比。数值只覆盖画面可辨的单叶。

| 参照实物 | 图像和可核对的范围 |
| --- | --- |
| 红根浮萍同一枚带斑的浮叶 | Monarchatto 在 2021-07-01 相隔 17 秒拍摄，叶基卷折、叶面褐斑及相邻虫孔吻合。使用较清晰的 [19:15:33 实拍](https://commons.wikimedia.org/wiki/File:Phyllanthus_fluitans_clusters.jpg) 建模，由 [19:15:16 实拍](https://commons.wikimedia.org/wiki/File:Phyllanthus_fluitans_clustering.jpg) 验证。保留裁片 `floater-a.png`、`floater-b.png`，叶面内 7 个匹配点用于双视角配准。第二张裁片 490 × 430，轮廓交并比 95.5%，双向轮廓距离均值 3.49 像素。两张照片均从水面上方拍摄。模型叶身约 9–17 毫米，叶柄控制在 1 毫米内，尺寸参考 [佛罗里达大学水生植物中心](https://plant-directory.ifas.ufl.edu/plant-directory/phyllanthus-fluitans/)。照片、裁切、叶缘及衍生纹理使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。 |
| 趴地矮珍珠同一丛沉水叶 | Yercaud-elango 在同一水族馆于 2026-07-07 [16:12:46](https://commons.wikimedia.org/wiki/File:Micranthemum_tweediei-1-veda_aquarium-bengaluru-India.jpg) 和 [16:12:50](https://commons.wikimedia.org/wiki/File:Micranthemum_tweediei-2-veda_aquarium-bengaluru-India.jpg) 连拍。叶对、旁边的嫩芽和石块位置吻合。取 `monte.png` 内 113 × 85 像素区域，另一视角保存为 160 × 134 像素的 `monte-b.png`。用 6 个局部特征点配准，第二视角可见叶缘交并比 85.8%，双向轮廓距离均值 1.96 个第二张裁片原生像素。两张的观察角相近，叶基一部分被相邻叶遮挡。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。 |
| 苦草的一片带状叶 | 使用 Lara Gudmundsdottir 的母种 [Vallisneria spiralis 实拍](https://commons.wikimedia.org/wiki/File:Vallisneria_spiralis.jpg)。在 392 像素长的可见中脉上测量宽度随位置变化，再按 [Tropica 对虎纹栽培型的尺寸记录](https://tropica.com/en/plants/plantdetails/?id=4503) 调整成熟叶和幼叶的比例。将实物中线拉直后对照 Demo 叶片横截面，在另选的 8 个位置测得平均叶宽差 0.51 像素。叶片的短横斑另按 [Tropica 栽培型近照](https://tropica.com/products/vallisneria-spiralis-tiger) 量取。在长约 3.67 倍叶宽的区域，按局部绿色通道差值大于 15 筛出 27 段明显短斑，跨度中位数约为叶宽的 14%，厚度约为 2.7%。Demo 按这些尺度生成两侧错开的短斑。另核对了 [栽培方除盆视频](https://www.youtube.com/watch?v=jE0xpZRyleo) 的公开预览，近照、整盆和露根的拍摄角度无法追踪同一枚叶，未将它们混算为第二视角。[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。 |

`design/水族素材纹理/水草实拍像素对照.png` 包含以上三组照片的裁切、对位和轮廓标记，保留各摄影者署名。合成对照图按 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) 提供。

## 虎纹苦草同叶转角和沉水细纹

使用 Tropica Aquarium Plants 的完整栽培演示，研究副本为 852 × 480。盆上标签、叶尖与邻近叶片的次序可沿镜头追踪。Tropica 的实拍版权归原作者。两张新增对照图仅引用分析所需局部，游戏使用测得的几何参数和程序纹理。[Tropica 原片](https://www.youtube.com/watch?v=jE0xpZRyleo) · [便于在国内观看的同片转载](https://www.bilibili.com/video/BV1dN411N77u/) · [栽培方品种资料](https://tropica.com/products/vallisneria-spiralis-tiger)

- 在画面左前方选取一片浅色成熟叶，29.1 秒时其尖端位于原片约 (112, 332)。用 29.1 与 42.1 秒拟合末端约 30 个原片像素内的左右叶缘。按测得的八个横截面重建不对称叶尖，三种造型各有一片成熟叶使用这组网格。由像面反推的三维结果假设该小段近似平面，水中叶身沿用鱼缸的姿态与摆动。
- 留出 32.1、35.7、38.9 秒的画面，每张只按实物叶尖平移对位。只取两条轮廓都能看到的列，比较模型上下边缘与独立亮度阈值（8 位灰度 160）划出的实拍边缘。三个角度分别含 62、66、66 个边缘采样，最新保形插值后的纵向坐标绝对误差平均为 0.263、0.154、0.141 原片像素。度量范围限于这个锚定点附近的轮廓。源测量位于 `source/tiger-turntable.json`，项目根目录执行 `node tools/check_tiger_leaf.cjs` 可以复核三种活动网格。同叶转角及叠图见本地研究图 `虎纹苦草同叶转角.png`
- 另沿同一盆上另一片靠镜头的弯叶追到片尾重放。近侧立处收窄后再展开。180.2 秒、原片第 391 行的灰度 196 阈值截面仅有两个连续像素，仍无法追踪哪条叶缘翻到了哪一边，因而叶背和同一区段的正反面纹理均待实拍。另核过 Wilstermann-Hildebrand 的活体叶丛及带花近照，这些照片各自呈现单一朝向。[栽培者原图和品种说明](https://www.heimbiotop.de/vallisneria.html)
- 60.15 秒的沉水微距是另一枚叶，原片横坐标 625 处的可见宽度约 119 像素。取附近 15 列绿色通道中值，沿叶宽找出 10 道纵向亮纹。它们距上边缘约 38、41、46、50、55、61、67、72、77、81 像素。模型将这些位置用于凹凸和粗糙度图，保留两侧平缓区，横斑局部打断反光。光源方向、组织透射和水体均影响实拍亮度，实际起伏高度尚无标尺。下图使用 Three.js 对 Demo 单叶和原材质的斜光渲染。弯叶、沉水实拍和模型侧光对照见本地研究图 `虎纹苦草弯叶与叶脉.png`

## 同一片断尖叶的翻面核查

Dustin’s Fish Tanks 展示了自家培育的豹纹水兰，图中标注日期为 2024-04-08。翠湖水草栽培研究所将豹斑水兰列为虎斑水兰的别称。这是另一株实物，鱼缸中的叶尖模型仍以 Tropica 原株为参照。[栽培者图集](https://dustinsfishtanks.com/products/vallisneria-spiralis-leopard) · [栽培型名称](https://www.tbs-aqua.com/encyclopaedia/plant?plantID=466)

三盆合照中最右盆的斜断口、黄褐色尖端和紧邻的粉斑，在单盆图和加尺图都能找到。三图原图依次为 4625 × 3200、4800 × 3200、4800 × 3200，定位点约为 (4289, 2560)、(3930, 428)、(3510, 593)。缩放和旋转会改变尖端的表观宽度。沿中脉拉直、按两侧叶缘校正宽度后，在一段棕纹上分别估计同向和镜像的配准参数，再在相邻留出段检验高通亮度的相关度。合照与单盆图同向为 0.57，镜像为 0.22。合照与加尺图同向为 0.43，镜像为 0.06。三张都支持这片断尖叶的同一面，尚缺同一处翻到另一面的实拍。研究图仅引用分析所需局部，摄影版权归 Dustin’s Fish Tanks。[三盆合照原片](https://dustinsfishtanks.com/cdn/shop/files/VallisneriaSpiralisLeopard_EasyBackgroundAquariumPlantForSale_02.jpg?v=1757958135) · [单盆横放原片](https://dustinsfishtanks.com/cdn/shop/files/VallisneriaSpiralisLeopard_EasyBackgroundAquariumPlantForSale_03.jpg?v=1757958135) · [横放加尺原片](https://dustinsfishtanks.com/cdn/shop/files/VallisneriaSpiralisLeopard_EasyBackgroundAquariumPlantForSale_06.jpg?v=1757958135) · 放大核查图见本地研究图 `虎纹苦草同叶翻面核查.png`

俄罗斯种植者另有一组同株照片，同一走茎的幼株和分叉白根可定位，中央叶的斑序在几个机位上保持同向。它补充了叶丛遮挡和走茎的外观。[种植者图集](https://staraqua.ru/content/vallisneria-spiralis-tiger-vallisneriya-tigrovaya)

## 虎纹苦草叶背推断

鱼缸的三种虎纹苦草均使用 `plant-model.js` 的同一套双面材质。正反面共享叶缘、摆动、色斑、组织透光图和损伤位置。背面有较宽缓的中脊、较弱的纵向细纹与较分散的反光。从 60.15 秒的另一片沉水绿叶原帧，在 x=480 至 775 的 12 个位置，沿原来定位的 10 道纵纹采样绿色通道亮暗跨度，调节各条纵纹沿长轴的强弱。此方法只取可见结构的相对变化，未将反光换算成叶脉高度。逆光时边缘透光更强，横斑和中脊遮光更明显。同属 V. gigantea 的显微横切显示边缘夹在两层表皮间的叶肉层较少，该观察用于判断透光变化的方向。虎纹栽培株叶背的起伏、色差和透光参数属于视觉推断。[大阪大学论文图 1，第 19 页](https://ir.library.osaka-u.ac.jp/repo/ouka/all/1828/07180_Dissertation.pdf) · 实拍、模型叶背及放大叠图见本地研究图 `虎纹苦草叶背推断.png`

保留叶尖八个实测截面，在相邻截面间做单调三次插值，叶身与第一个实测截面平滑连接。用项目实际着色器渲染同一枚活动网格的前后两面，翻回后，叶尖和叶身遮罩的交并比分别为 99.957% 和 99.997%。在叶背加入逆光后，叶身区域显示亮度从仅有环境光的 30.7 升至 138.5（八位显示值）。三个造型的完整网格、根丝与摆动均经过离屏渲染检查。当前可核对同一片叶子的实拍都朝同一面。叶背待独立照片验证。
