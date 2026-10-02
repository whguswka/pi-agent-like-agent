---
name: data-analysis
description: CSV·엑셀·parquet 같은 표 데이터를 탐색하고 요약 통계·집계·그래프를 만들 때 사용. "이 데이터 분석해줘", "월별 추이를 그래프로 그려줘" 같은 요청.
---
# 데이터 분석

## 순서
1. 파일 크기부터 본다 (`ls -lh`). 큰 파일(수백 MB 이상)은 `nrows=`, `usecols=` 로 일부만 먼저 읽는다.
2. 구조 파악: 행·열 수, 열 이름과 형식(`dtypes`), 앞 5줄, 빈 값 개수(`df.isna().sum()`), 중복 행 수.
3. 질문에 맞게 집계한다: `groupby`, `pivot_table`, `value_counts`. 기간별 분석은 날짜 열을 `pd.to_datetime` 으로 바꾼 뒤 `resample` 이나 월 열로 묶는다.
4. 결과는 숫자로 말한다. 표가 크면 상위 몇 개만 보여 주고 전체는 파일로 저장한다 (예: `결과_요약.csv`, `encoding="utf-8-sig"`).
5. 무엇을 가정했는지(빈 값 처리, 제외한 이상치, 기준 기간)를 함께 적는다.

## 그래프
화면이 없으므로 그림은 파일로 저장하고 경로를 알려 준다.
```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(8, 4.5))
ax.plot(x, y, marker="o"); ax.set_title("월별 추이"); ax.grid(alpha=0.3)
fig.tight_layout(); fig.savefig("그림_월별추이.png", dpi=120); plt.close(fig)
```
- 한글 글꼴: Windows 는 `plt.rcParams["font.family"] = "Malgun Gothic"`. 리눅스(노트북)는 `fc-list :lang=ko` 로 한글 글꼴이 있는지 보고, 없으면 제목·축 이름을 영어로 쓴다. 한글 글꼴을 쓸 때는 `plt.rcParams["axes.unicode_minus"] = False`.
- jupyter 모드에서 그린 그림을 PC 에서 보려면 `/download 그림파일` 로 받는다.

## 주의
- 원본 데이터 파일은 고치지 않는다.
- 데이터 전체를 출력하지 않는다 (요약과 일부만).
- 주민번호·연락처 같은 개인정보가 보이면 출력하지 말고 알린다.
