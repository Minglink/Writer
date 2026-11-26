| 分支与会话态 | 通过用例 | 证据完整率 | 版本准确率 | 组装泄漏数 | 历史/检查点残留 | 归因：缺证据 | 归因：选错证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline (Current Writer) - Fresh | 0/8 | 0.0% | 100.0% | 0 | 0 | 8 | 0 |
| Baseline (Current Writer) - Hot | 0/8 | 0.0% | 100.0% | 0 | 1 | 8 | 0 |
| Long Context Baseline (12k Chars) - Hot | 0/8 | 47.1% | 100.0% | 0 | 1 | 8 | 0 |
| Oracle Evidence Baseline - Hot | 8/8 | 100.0% | 100.0% | 0 | 1 | 0 | 0 |
| P1 Chapter Evidence - Fresh | 8/8 | 100.0% | 100.0% | 0 | 0 | 0 | 0 |
| P1 Chapter Evidence - Hot | 8/8 | 100.0% | 100.0% | 0 | 1 | 0 | 0 |
| P1 Chapter Evidence - Post Compaction | 8/8 | 100.0% | 100.0% | 0 | 1 | 0 | 0 |
| P1 Chapter Evidence - Cold Restore | 8/8 | 100.0% | 100.0% | 0 | 2 | 0 | 0 |