# 水族石的实物参照

**黄虎石 · Tripo** 使用 Tripo Studio H2.5 免费档按文字描述生成，作为本地鱼缸效果对照。原始导出存于 [ohko-h25.glb](tripo/ohko-h25.glb)，运行版保留颜色、法线和粗糙度／金属度贴图，按原黄虎石的 22.1 厘米高度缩放。[Tripo 生成记录](https://studio.tripo3d.ai/zh/workspace/generate/5044c532-826d-440c-9dc1-b0920dae8fd1)

**Tripo 黄虎石 · 风化** 由同一份 GLB 本地加工。减面前合并几何接缝，保留独立 UV，在凹坑附近的凸缘做局部缺口。岩面的颜色变化、微法线和粗糙度取自项目已有的 Worn Rock Natural 01 扫描及黄虎石风化纹理。这些加工用于造景预览。[扫描来源](https://polyhaven.com/a/worn_rock_natural_01)

[打开同机位实物与模型叠图](../../design/水族素材纹理/石头实物对照.html)。页面使用鱼缸的模型工厂和材质。圆溪石有两块不同标本，黄虎石和红瓦石的第一种造型分别对应下表实物，第二种造型保留了此前的造景设计。鱼缸中的大小按场景适配。

| 实物及取景 | 建模依据 | 可核查范围 |
|---|---|---|
| Carbis Bay，康沃尔。开放大学馆藏卵石 | 同一实物沿水平方向旋转一圈，转台共 72 帧，间隔约 5°。48 帧提供建模轮廓和同名特征；另 24 帧交错留出。另从训练组内的 8 张 1444 × 1173 实拍量取浅色晶粒、赭色斑与暗纹的中心、方向和大小，投到石面，搭配独立岩面扫描。 | 官方金字塔登记 5776 × 4692 原图，整圈轮廓验证在 361 × 294 的实拍层进行。下方接触面被底座遮挡，背光和灯光颜色会改变缸内外观。[开放大学原始标本和旋转照片](https://www.virtualmicroscope.org/content/carbis-bay-pebble) |
| PAS FindID 222927，Cornwall，Royal Institution of Cornwall，Anna Tyacke 摄 | 同一标本的 dorsal、ventral、left margin、right margin 四张照片（每张 960 × 1280）。沿纵轴量四个方向的宽度与不对称断面，把石英细脉、斑驳和断口投回对应表面。 | 记录人认为它可能源自海滩卵石。本项目用它作水磨石的形态参照。图像和衍生的几何及纹理按 CC BY-SA 4.0 使用，作了裁切、配准、去背景、尺度变化和多视图融合。[标本](https://finds.org.uk/database/artefacts/record/id/222927) · [原照与署名](https://commons.wikimedia.org/wiki/File:Natural_pebble_(dorsal)_(FindID_222927).jpg) · [许可](https://creativecommons.org/licenses/by-sa/4.0/) |
| Buce Plant DSP3016 黄虎石造景件 | 商品页前三张是同一编号的实物，末图是其它作品。使用前三张从轮廓、重复可见的尖峰与孔缘、可匹配的立体图像块重建。 | 接触底砂附近的边界难以分开，背面无单独实拍。只保存提取的测量数据，模型的岩面颜色、法线及粗糙度来自另列的 CC0 岩面扫描。[原图与商品说明](https://buceplant.com/products/dragon-stone-showpieces-dsp3016) |
| GeoDIL 421，Ward’s #183，纽约州 Granville 红板岩，实物宽 9.5 cm，Mike Davis 摄 | 同一张斜上方照片可见上表面、前部断口和层理，已按实物校形，并用相邻岩面补去藏品标签。 | 背面、底面和采样相机的精确俯角均无原始观测。原照 CC0。[原图和标本记录](https://geodil.dperkins.org/h/421.html) · [许可](https://commons.wikimedia.org/wiki/File:Red_Slate_(GeoDIL_number_-_421).jpg) |

`specimens/` 保存可重建的测量数据和获许可的原图。`python3 tools/build_stone_specimens.py` 生成三件标本的轻量网格、碰撞网格、相机配准参数及贴图。`python3 tools/build_carbis_pebble.py` 重建整圈卵石。运行依赖在脚本中列出。

[八个机位的轮廓对照](../../design/水族素材纹理/石头实物逐角对照.png)使用 640 × 640 的同机位渲染。边缘误差是实物和模型外轮廓间双向最近距离的平均值。这八张也是建模视图；[Carbis 独立留出角度](../../design/水族素材纹理/Carbis卵石整圈对照.png)使用不同的验证帧。

## 岩面细节贴图

以下三组岩面扫描来自 Poly Haven，使用 CC0 1.0 许可。色彩、OpenGL 法线和材质通道来自对应扫描。

| 造型 | 来源 | 作者 |
|---|---|---|
| 黄虎石 | [Worn Rock Natural 01](https://polyhaven.com/a/worn_rock_natural_01) | Dimitrios Savva 摄影，Rob Tuytel 处理 |
| 红瓦石 | [Cliff Side](https://polyhaven.com/a/cliff_side) | Dario Barresi、James Ray Cock 摄影，Jenelle van Heerden 处理 |
| 圆溪石 | [Rock 01](https://polyhaven.com/a/rock_01) | Rob Tuytel |

`source-textures/` 保存官网下载的 1K JPEG 原图，`arm` 的红、绿通道分别是环境遮蔽和粗糙度。从项目目录运行 `python3 tools/build_stone_surfaces.py` 可以用 FFmpeg 重建 `rock-surfaces.js`。每种石头的两张扫描贴图分别存储带轻微遮蔽的底色，以及法线的 X、Y 分量和粗糙度。

同一脚本会调用 `tools/stone_weathering.py` 烘焙各石种的风化起伏。带正负号的高度场描述矿粒凸起、浅凹和间歇分叉的裂隙。宽处移动网格顶点，窄处的坡度和扫描法线共同参与光照。每个品种另有一张无损细节图和一份低分辨率位移数据，两种外形共用。

第一版原石仍使用 `stone-scan-data.js` 中的独立扫描网格和贴图。[Boulder 01 / Rico Cilliers](https://polyhaven.com/a/boulder_01)
