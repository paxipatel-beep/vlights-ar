# Graph Report - /home/user/vlights-ar  (2026-04-20)

## Corpus Check
- 10 files · ~10,031 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 42 nodes · 64 edges · 8 communities detected
- Extraction: 78% EXTRACTED · 22% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]

## God Nodes (most connected - your core abstractions)
1. `execute()` - 6 edges
2. `execute()` - 6 edges
3. `execute()` - 6 edges
4. `complete()` - 6 edges
5. `write()` - 6 edges
6. `executeTask()` - 5 edges
7. `search()` - 5 edges
8. `writeReport()` - 5 edges
9. `plan()` - 4 edges
10. `now()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `send()` --calls--> `write()`  [INFERRED]
  /home/user/vlights-ar/src/api/server.js → /home/user/vlights-ar/src/tools/deliverable.js
- `execute()` --calls--> `search()`  [INFERRED]
  /home/user/vlights-ar/src/agents/researcher.js → /home/user/vlights-ar/src/tools/websearch.js
- `execute()` --calls--> `complete()`  [INFERRED]
  /home/user/vlights-ar/src/agents/researcher.js → /home/user/vlights-ar/src/utils/claude.js
- `execute()` --calls--> `writeReport()`  [INFERRED]
  /home/user/vlights-ar/src/agents/researcher.js → /home/user/vlights-ar/src/tools/deliverable.js
- `plan()` --calls--> `executeTask()`  [INFERRED]
  /home/user/vlights-ar/src/agents/planner.js → /home/user/vlights-ar/src/orchestrator/index.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.36
Nodes (5): list(), createTask(), executeTask(), now(), updateTask()

### Community 1 - "Community 1"
Cohesion: 0.39
Nodes (6): ensureTaskDir(), write(), writeCode(), writeData(), writeReport(), send()

### Community 2 - "Community 2"
Cohesion: 0.33
Nodes (3): complete(), parseSteps(), plan()

### Community 3 - "Community 3"
Cohesion: 0.7
Nodes (4): buildFilename(), execute(), parseCodeBlock(), parseExplanation()

### Community 4 - "Community 4"
Cohesion: 0.7
Nodes (4): mockResults(), search(), searchBrave(), searchSerper()

### Community 5 - "Community 5"
Cohesion: 0.83
Nodes (3): execute(), formatSearchResults(), parseSections()

### Community 6 - "Community 6"
Cohesion: 0.83
Nodes (3): execute(), parseAnalysisSections(), toReportSections()

### Community 7 - "Community 7"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 7`** (1 nodes): `main.py`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `complete()` connect `Community 2` to `Community 0`, `Community 3`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.437) - this node is a cross-community bridge._
- **Why does `execute()` connect `Community 5` to `Community 1`, `Community 2`, `Community 4`?**
  _High betweenness centrality (0.347) - this node is a cross-community bridge._
- **Why does `writeReport()` connect `Community 1` to `Community 0`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.243) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `execute()` (e.g. with `search()` and `complete()`) actually correct?**
  _`execute()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `execute()` (e.g. with `complete()` and `writeCode()`) actually correct?**
  _`execute()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `execute()` (e.g. with `complete()` and `writeReport()`) actually correct?**
  _`execute()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `complete()` (e.g. with `execute()` and `plan()`) actually correct?**
  _`complete()` has 5 INFERRED edges - model-reasoned connections that need verification._