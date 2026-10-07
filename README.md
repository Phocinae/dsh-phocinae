# dsh-phocinae

斑海豹（Phocinae-Largha-150M-v1）的 DeepSeek Harness（dsh）插件 bundle。
本地非生成式决策模型 × dsh 的三件套：`phocinae_ask` 决策工具、内置 skill `phocinae`、命令审批门（PreToolUse 类）。

## 定位

- dsh = DeepSeek Harness（MIT，「everything is a plugin」，Cordis 插件内核）。本包仿社区 `noetion/dsh-jev` 先例：plugin id = `phocinae`、工具 = `phocinae_ask`、内置 skill = `phocinae`、含审批门。
- 斑海豹（144.3M 参数）：非生成式、单遍判定。typed-decisions en 0.797 / zh 0.789；选项序翻转率 0.0187；8k 上下文；CPU 单线程约 1.47s（GPU fp16 p50 18.6ms）。以本地服务（laya.Agent）形态接入，协议兼容 TypeSafe `/v1/systemone`。
- 斑海豹**不做主对话模型**——只以「钩子/工具调用的本地决策服务」形态嵌入。

## 目录结构

```
dsh-phocinae/
├── package.json        # dsh.bundle.patch 声明（bundle manifest）
├── cordis.patch.yml    # bundle patch 层：插件行 phocinae + 全部默认配置
├── index.js            # 插件入口：注册 phocinae_ask 工具 + 审批门监听
├── tools/              # phocinae_ask 工具定义（POST /v1/systemone 构造）+ 说明
├── hooks/              # 审批门 guard（PreToolUse 类）+ 配置说明
├── skills/phocinae/    # 内置 skill：何时用、如何提问、审批门流程
├── scripts/validate.mjs# 本地自检脚本（npm run validate）
├── README.md
└── LICENSE             # Apache-2.0
```
## 安装

前置：

- Node.js ≥ 22.19（或 ≥ 24）；dsh CLI（Developer Preview，目标 0.1.5-rc 线）
- 本地斑海豹服务已启动（默认 http://127.0.0.1:8155）

方式 A —— 本地 npm pack（本包不上 npm，推荐）：

```
npm pack --dry-run                 # 先校验 tarball 内容
npm pack                           # 产出 dsh-phocinae-0.1.0.tgz
dsh plugin --profile <name> add ./dsh-phocinae-0.1.0.tgz
```

方式 B —— git 直装（参照 noetion/dsh-jev 路径，本包纯 JS 免构建）：

```
dsh plugin --profile <name> add github:<org>/dsh-phocinae#<commit-sha>
```

- 建议 pin commit（#sha）防后推篡改；
- pnpm ≥10 默认拒跑 git 依赖的 prepare：若首次 add 失败，按 pnpm 报错把包名写入 profile 的 pnpm-workspace.yaml 的 allowBuilds 后重跑。

## 配置

默认配置全部在 `cordis.patch.yml`（bundle 层），可被 profile / `$DSH_HOME/cordis.patch.yml` / `--patch` 覆盖：

- `endpoint`：斑海豹本地服务地址，默认 `http://127.0.0.1:8155/v1/systemone`
- `model`：默认 `Phocinae-Largha-150M-v1`（按后端协议透传）
- `timeoutMs`：默认 3000
- `gate.enabled` / `gate.threshold`（默认 0.8）/ `gate.mode`（`deny`=硬阻断，`ask`=转人工）/ `gate.tools`（默认 `[bash]`）

## 安全声明

- 全程本地：默认只连回环地址 127.0.0.1:8155，无任何外网上传、遥测或第三方转发；
- 无凭据：本地服务不鉴权，包内不含任何密钥、不收集环境变量外传；
- 审批门 fail-safe：服务不可达/超时/异常 → 默认 ask（不放行），绝不静默通过；
- 本包不发布 npm（本地开发包），分发用 pack / git 直装；模型权重许可见 HF 模型卡（另案）。

## License

Apache-2.0，详见 LICENSE。
