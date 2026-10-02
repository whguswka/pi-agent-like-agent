---
name: office-files
description: 엑셀(xlsx, xls, csv)·워드(docx)·PDF·한글(hwp, hwpx) 파일을 읽거나 만들 때 사용. 표를 엑셀로 저장하거나, 문서 내용을 뽑아 요약·비교하는 작업.
---
# 사무 파일 다루기

이 파일들은 글자 파일이 아니라서 read 도구로 바로 읽을 수 없다. Python 으로 읽어 필요한 부분만 출력한다.

## 준비
- 패키지: 엑셀 `pandas` + `openpyxl` (예전 .xls 는 `xlrd`), 워드 `python-docx`, PDF `pypdf`, 한글 `pyhwp` 또는 `olefile`.
- 먼저 있는지 확인한다: `python -c "import pandas, openpyxl"`. 없으면 사용자에게 알리고 `pip install --user openpyxl` 처럼 설치한다 (사내 미러).
- 원본은 고치지 않는다. 결과는 새 파일(예: `결과_20261002.xlsx`)로 저장하고 경로를 알려 준다.

## 엑셀·CSV
```python
import pandas as pd
xl = pd.ExcelFile("자료.xlsx")          # 시트 목록: xl.sheet_names
df = pd.read_excel(xl, sheet_name=0)   # 머리글 위치가 다르면 header=, skiprows=, 필요한 열만 usecols=
print(df.shape); print(df.dtypes); print(df.head(10).to_string())
```
- 큰 표는 다 출력하지 말고 `head()`, `describe()`, `value_counts()` 로 요약해서 본다.
- 한글 CSV 가 깨지면 `encoding="cp949"` 로 읽는다.
- 엑셀에서 열 CSV 는 `df.to_csv(f, index=False, encoding="utf-8-sig")` 로 저장한다 (그냥 utf-8 이면 엑셀에서 한글이 깨진다).
- 엑셀로 저장: `df.to_excel("결과.xlsx", index=False)`. 여러 시트는 `with pd.ExcelWriter("결과.xlsx") as w:` 안에서 `df.to_excel(w, sheet_name="요약", index=False)`.
- 열 너비·굵은 머리글 같은 서식은 저장한 뒤 openpyxl 로 손본다.

## 워드(docx)
```python
from docx import Document
d = Document("문서.docx")
for p in d.paragraphs: print(p.style.name, "|", p.text)
for t in d.tables:
    for row in t.rows: print([c.text for c in row.cells])
```
- 새 문서: `d = Document(); d.add_heading("제목", 1); d.add_paragraph("내용"); d.save("새문서.docx")`
- 예전 .doc 는 읽을 수 없다. 사용자에게 docx 로 저장해 달라고 한다.

## PDF
```python
from pypdf import PdfReader
r = PdfReader("자료.pdf")
print(len(r.pages)); print(r.pages[0].extract_text()[:2000])
```
- 스캔한 PDF(그림)는 글자가 나오지 않는다. 그렇다고 알린다.

## 한글(hwp, hwpx)
- `pyhwp` 가 있으면 `hwp5txt 문서.hwp > 문서.txt` 로 글을 뽑는다.
- 없으면 `olefile` 로 미리보기 글(앞부분)만 읽을 수 있다: `olefile.OleFileIO("문서.hwp").openstream("PrvText").read().decode("utf-16-le")`
- hwpx 는 zip 안의 XML 이다. `zipfile.ZipFile("문서.hwpx").namelist()` 로 구조를 보고 `Contents/section0.xml` 에서 글을 읽는다.
- 전체 내용이 꼭 필요하면 사용자에게 한글 프로그램에서 docx 나 pdf 로 저장해 달라고 한다.
