# 全景图拍摄设备清理工具

这是独立的离线/命令行预处理工具。它从完整的 2:1 等距柱状全景图提取天底透视裁切图，调用百炼 `qwen-image-3.0-pro` 清理拍摄设备，再用本地遮罩把修复区域逆映射回原全景。它不改变 PlaceEcho 的 Scene、API 或 Web 导入契约；清理后的全景图可作为普通 `PanoramaAsset` 输入。

本仓库只包含代码、通用配置和合成数据测试。原代码包中的用户照片、专用遮罩、模型返回图和生成结果均未提交。

## 安装与测试

从本目录运行，建议 Python 3.10 及以上：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

## 使用

先复制 `config.example.json`，按自己的全景图调整 `projection` 中的方向、视角和裁切范围。`crop` 为 `[x, y, width, height]`，在生成的透视图内取框；其宽高比必须与 `api.size` 一致。提示词路径相对于配置文件所在目录。

```bash
python -m qwen_panorama prepare \
  --input /path/to/panorama.jpg \
  --config config.example.json \
  --out results/my-panorama
```

检查 `results/my-panorama/input.png`。用图片编辑器创建与它同尺寸的黑白 PNG 遮罩：白色只覆盖相机、支架及确认属于设备的阴影，边缘必须保留未遮罩区域。将它保存为 `results/my-panorama/mask.png`。确认 `projection` 与遮罩合适后再调用模型：

```bash
cp .env.example .env
# 在 .env 中填入自己的百炼 API Key 和工作空间地址
python -m qwen_panorama generate --job results/my-panorama --count 1
python -m qwen_panorama finish --job results/my-panorama --run 001
```

也可以直接运行 `python -m qwen_panorama run --input ... --config ... --mask ... --out ... --count 1`。此命令会发起一次可能收费的模型请求。`--count` 每次建立独立运行记录；请求超时不会自动重复付费调用。如果模型生成成功但下载失败，可按运行记录使用 `generate --job ... --resume 001` 仅重试下载。

已有修复图可离线导入，不需要密钥：

```bash
python -m qwen_panorama finish \
  --job results/my-panorama \
  --model-output /path/to/existing-response.png
```

最终输出位于 `results/my-panorama/runs/001/`：`panorama_clean.png`、带 GPano 元数据的 `panorama_clean.jpg`、遮罩、校验记录和对比图。PNG 在投影遮罩外逐像素保持原图；JPG 为有损压缩。检查 `validation.json` 的 `outside_mask_changed_pixels_in_png` 是否为 0，并人工查看天底对比图。模型不能自动识别所有设备或保证纹理无瑕疵。

## 边界

- 模型只接收透视裁切图和文字提示。遮罩由本地合成阶段使用；百炼接口没有原生遮罩参数。
- `.env`、`results/`、临时下载 URL 与私有图像不得提交。
- 该工具不生成 3D 坐标、Collider、World Grounding 或 Hero Object。
