---
name: llm-wiki
description: 켜진 LLM 위키(/wiki)에 원본을 반영(ingest)하거나, 위키를 근거로 답하거나(query), 위키를 점검·정리(lint)할 때 사용. 위키 도구 wiki_search·wiki_read·wiki_write 의 순서와 페이지 형식.
---
# LLM 위키 다루기

위키는 사용자 PC 의 마크다운 폴더다 (Obsidian 보관소). `raw/` 는 원본(읽기만), `pages/` 는 내가 쓰는 페이지, `index.md`(목록)·`log.md`(기록)는 pi 가 고친다.
이 위키의 규칙은 `WIKI.md`: 그 세션에서 위키 작업을 처음 할 때 `wiki_read path="WIKI.md"` 로 한 번 읽는다.

## 도구를 아껴 쓴다
Copilot·사내AI 에서는 도구 한 번이 대화 한 번이고 결과는 6000자까지 온다.
- 여러 페이지는 `wiki_read paths=[...]` 로 한 번에 읽고, `wiki_write` 한 번에 3~5쪽씩 쓴다.
- 찾을 때는 `index.md` 를 통째로 읽지 말고 `wiki_search`.
- 긴 원본은 offset 으로 나눠 읽고, 읽으면서 정리해 두었다가 끝에 한 번에 쓴다.

## wiki_write 형식
페이지마다 `=== pages/<분류>/<제목>.md` 줄, 이어서 머리말과 본문. Copilot·사내AI 에서는 이스케이프 없는 이 형식을 쓴다 (다른 모델은 보통의 도구 호출로 text 에 같은 내용):
````text
@tool wiki_write op=ingest title="회의록 반영"
=== pages/model/수요 예측 모델.md
---
title: 수요 예측 모델
summary: 주간 수요 예측. 매주 월요일 학습, 결과는 대시보드로
type: model
sources: [raw/회의록.md]
---
# 수요 예측 모델
- 학습: 매주 월요일 ([[주간 학습 작업]])
- 지표: [[예측 오차 지표]]
=== pages/source/회의록.md
---
title: 회의록
summary: 학습 주기와 지표 기준을 정한 회의
type: source
sources: [raw/회의록.md]
---
...
````
- 분류(type)는 `WIKI.md` 의 '분류'에 있는 이름. 파일 이름 = 제목 (다르면 pi 가 제목으로 바꿈).
- 링크는 `[[제목]]`. 아직 없는 페이지로 가는 링크도 된다 (pi 가 알려 줌).
- 이미 있는 페이지는 `wiki_read` 로 읽은 뒤 전체를 다시 쓴다 (고치기 전 것은 `.history/` 에 남음).
- 같은 제목이 다른 분류에 있으면 거절된다. 그 페이지를 고친다.
- 본문에 ``` 코드 블록이 있으면 바깥 블록은 ````text 로 연다.

## ingest (원본 하나 반영)
1. `wiki_read path="raw/<파일>"`. 길면 알려 주는 offset 으로 이어 읽는다.
2. 사용자가 바로 하라고 하지 않았으면, 핵심을 3~5줄로 보여 주고 반영 방향이 맞는지 짧게 묻는다.
3. `wiki_search` 로 관련 페이지를 찾고 `wiki_read paths=[...]` 로 읽는다.
4. `wiki_write op=ingest` 로 쓴다: 원본 요약(type: source, sources 에 raw 경로), 고칠 관련 페이지, 필요하면 새 페이지. 서로 `[[링크]]`.
5. 이미 있는 내용과 다르면 지우지 말고 "(원본 X 에서는 …)" 처럼 함께 적고, 답에서 알린다.
6. 답 끝에 쓴 페이지를 `[[제목]]` 으로 적는다.

## query (위키로 답하기)
1. `wiki_search` 로 찾고 `wiki_read paths=[...]` 로 읽는다.
2. 위키 내용을 근거로 답하고 근거 페이지를 `[[제목]]` 으로 밝힌다. 위키에 없으면 없다고 말한다.
3. 남길 만한 답이면 (사용자가 원하거나 위키 규칙에 남기라고 되어 있으면) type: answer 페이지로 `wiki_write op=query`.

## lint (점검·정리)
1. 사용자가 `/wiki lint` 결과를 주면 깨진 링크, 같은 이름, 머리말 빠짐, 고아 페이지부터 고친다 (`wiki_write op=lint`).
2. 모순·낡은 내용은 분류 하나씩 본다: 같은 대상을 다룬 페이지를 `wiki_search`·`wiki_read` 로 비교해 고칠 점을 제안한다.
3. 반영 안 된 원본은 알려 주고 `/wiki ingest <파일>` 을 권한다.

## 하지 않는 것
- `raw/` 의 원본과 `WIKI.md` 는 고치지 않는다 (WIKI.md 는 고칠 점을 사용자에게 제안).
- 비밀번호·토큰·접속 정보, 개인정보, 확인하지 않은 추측은 남기지 않는다.
- 위키 폴더 밖의 파일은 위키 도구로 다루지 않는다.
