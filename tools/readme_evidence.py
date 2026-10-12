#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh_evidence.py —— 为 dsh-phocinae 的 README 卡片生成有界的真实输出。

为什么单独成文件：这些命令里含引号、$、中文与 JS 正则，直接塞进
`python -c "..."` 会被 PowerShell 的引号/`$(...)` 展开规则吃掉。
放成文件既避免转义地狱，也让证据可复现（读者可直接运行本脚本复核）。
"""
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run(args, **kw):
    return subprocess.run(args, cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", **kw)


def tests():
    files = ["test/lib.test.mjs", "test/contract.test.mjs",
             "test/regressions.test.mjs"]
    p = run(["node", "--test"] + files)
    keep = ("ok ", "not ok", "# tests", "# pass", "# fail", "# skipped",
            "# duration")
    lines = [l for l in p.stdout.splitlines() if l.startswith(keep)]
    cases = [l for l in lines if l.startswith(("ok ", "not ok"))]
    for l in lines[:5]:
        print(l)
    print("  ... (%d cases in total; per-case lines elided) ..." % len(cases))
    for l in lines[-5:]:
        print(l)
    print("exit=%d" % p.returncode)
    return 0


def package():
    p = run(["npm", "pack", "--dry-run", "--ignore-scripts", "--json"])
    out = p.stdout.strip()
    # npm may prepend/append non-JSON noise on some versions; take the JSON array
    start = out.find("[")
    end = out.rfind("]")
    if start < 0 or end < 0:
        print("npm pack did not return JSON (exit=%d)" % p.returncode)
        print(out[:800])
        print(p.stderr[:800])
        return 1
    d = json.loads(out[start:end + 1])[0]
    print("package :", d["filename"])
    print("version :", d["version"])
    print("files   :", len(d["files"]))
    print("unpacked: %.1f kB" % (d["unpackedSize"] / 1024))
    print()
    for f in d["files"][:16]:
        print("  %-44s %7.1f kB" % (f["path"], f["size"] / 1024))
    if len(d["files"]) > 16:
        print("  ... (%d more)" % (len(d["files"]) - 16))
    print("exit=%d" % p.returncode)
    return 0


def pkgjson():
    with open(os.path.join(REPO, "package.json"), encoding="utf-8") as fh:
        p = json.load(fh)
    print("name        :", p["name"])
    print("version     :", p["version"])
    print("engines.node:", p["engines"]["node"])
    print("engines.dsh :", p["engines"]["dsh"])
    print("bundle.patch:", p["dsh"]["bundle"]["patch"])
    print("exports     :", ", ".join(sorted(k for k in p["exports"])))
    return 0


if __name__ == "__main__":
    sys.exit({"tests": tests, "package": package, "pkgjson": pkgjson}[sys.argv[1]]())
