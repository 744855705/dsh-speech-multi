# 第三方组件声明 / Third-Party Notices

本仓库发布的是**模型权重归档**，供 `dsh-speech-multi` 插件下载使用。
下列组件的版权归各自上游作者所有，均以 **Apache-2.0** 许可证再分发。
本仓库根目录的 `LICENSE` 即为这些组件共同适用的 Apache-2.0 许可证副本。

## 归档与上游对应关系

| 归档 | 组件 | 上游 | 采用的版本 / 导出版 | 许可证 | 是否修改 |
|---|---|---|---|---|---|
| `xasr-zh-en-punct-int8.tar.zst` | X-ASR zh-en (带标点) | [Gilgamesh-J/X-ASR](https://github.com/Gilgamesh-J/X-ASR) | sherpa-onnx 导出版 2026-06-03，int8 | Apache-2.0 | 未修改 |
| `funasr-nano-1024-int8.tar.zst` | Fun-ASR-Nano-2512 | [FunAudioLLM/Fun-ASR-Nano-2512](https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512) | 原始权重；ONNX 导出取自 [zengshuishui/FunASR-nano-onnx](https://www.modelscope.cn/models/zengshuishui/FunASR-nano-onnx) 的 `llm_int8_max_token_1024` | Apache-2.0 | 未修改（仅选用上游 `max_total_len=1024` 的导出变体） |
| `qwen3-asr-0.6b-int8.tar.zst` | Qwen3-ASR 0.6B | [Qwen/Qwen3-ASR-0.6B](https://huggingface.co/Qwen/Qwen3-ASR-0.6B) | sherpa-onnx 导出版 `2026-03-25`，int8 | Apache-2.0 | 未修改 |
| `firered-asr2-aed-int8.tar.zst` | FireRedASR2-AED | [FireRedTeam/FireRedASR2-AED](https://huggingface.co/FireRedTeam/FireRedASR2-AED) | sherpa-onnx 导出版，int8 | Apache-2.0 | 未修改 |
| `punctuation.tar.zst` | FireRedPunc | [FireRedTeam/FireRedASR2S](https://huggingface.co/FireRedTeam/FireRedASR2S) | 标点模型 | Apache-2.0 | **已修改**：权重由 fp32 转换为 fp16 |
| `punctuation.tar.zst` | CT-Transformer 标点 | FunASR 系列，经 sherpa-onnx 发布 | int8 | Apache-2.0 | 未修改 |

## 运行时依赖

以下依赖**不随本仓库分发**，由插件 `package.json` 声明并从 npm 安装：

| 依赖 | 许可证 |
|---|---|
| `sherpa-onnx-node` | Apache-2.0 |
| `onnxruntime-node` | MIT |
| `@huggingface/tokenizers` | Apache-2.0 |

## 免责声明

这些模型按 **"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND** 提供，
不附带任何明示或暗示的担保。使用前请自行评估其在你场景下的适用性与合规性。
