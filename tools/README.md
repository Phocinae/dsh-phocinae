# phocinae_ask 工具说明

`tools/phocinae_ask.js` 是 phocinae_ask 的工具定义文件（dsh 工具形态）：
构造 `POST /v1/systemone` 请求发给本地斑海豹服务，返回 typed answers。

## 参数（inputSchema）

- `state`（string，必填）：待决策情境原文
- `questions`（array，必填，≥1）：
  - `id`（string，必填）：题目标识，响应 answers 按序/按 id 对齐
  - `type`（enum，必填）：noul | choice | score
  - `options`（string[]）：choice 型必填（≥2 项）
  - `threshold`（number）：noul 型可选（true 概率阈值）

## 响应

```
{ model, answers, usage, answer_confidence }
```

answers 逐题：noul=bool；choice=int（选项下标，0 起）；score=2–10 的 int。

## 请求示例

POST http://127.0.0.1:8155/v1/systemone

```
{ "model": "Phocinae-Largha-150M-v1",
  "state": "用户请求执行 rm -rf /tmp/build-cache && make clean",
  "questions": [
    { "id": "risk", "type": "noul", "threshold": 0.8 },
    { "id": "pick_route", "type": "choice", "options": ["A 路线", "B 路线", "C 路线"] },
    { "id": "risk_score", "type": "score" }
  ] }
```

## 响应示例

```
{ "model": "Phocinae-Largha-150M-v1",
  "answers": [ true, 1, 7 ],
  "usage": { "prompt_tokens": 84 },
  "answer_confidence": { "risk": 0.91 } }
```

## 使用注意

- 本工具是决策判定，不是文本生成——需要生成内容请用主模型；
- 服务不可达会抛错（不编造答案），由调用方决定降级；
- 端点/模型名由插件配置注入（cordis.patch.yml），工具默认 http://127.0.0.1:8155/v1/systemone。
