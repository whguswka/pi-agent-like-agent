---
name: kubeflow-notebook
description: Kubeflow 노트북에서 패키지 설치, GPU·자원·버전 확인, 오래 걸리는 학습 실행, .ipynb 실행·결과 읽기·고치기를 할 때 사용.
---
# Kubeflow 노트북에서 일하기

## 버전 먼저
- 내 지침의 '실행 환경' 부분(사용자가 `/kit env` 로 조사해 적음)이 있으면 그 Python·패키지·CUDA 버전에 맞춰 코드와 명령을 쓴다.
- 없으면 짧게 확인한다: `python --version`, `pip list 2>/dev/null | grep -i -E '^(kfp|torch|tensorflow|scikit-learn|pandas|numpy|mlflow|transformers) '`, `nvidia-smi`.
  사용자에게 `/kit env` 로 지침에 적어 두면 다음부터 묻지 않는다고 알린다.
- kfp SDK 1.x 와 2.x 는 API 와 컴파일 결과가 다르고, 클러스터의 Kubeflow Pipelines 버전과 맞아야 한다. 어느 쪽인지 모르면 사용자에게 묻는다.

## 남는 곳과 사라지는 곳
- 홈(`~`, 보통 /home/jovyan)은 영구 저장소(PVC)라 파드를 다시 시작해도 남는다. 코드·데이터·결과는 홈 아래에 둔다.
- `/tmp`, 기본 conda 환경(`/opt/conda`) 같은 홈 밖은 다시 시작하면 사라질 수 있다.
- 패키지는 `pip install --user <패키지>` 로 설치한다 (`~/.local` 에 남는다). 사내 미러로만 받을 수 있다. 설치하기 전에 알린다.

## 자원 확인
- GPU: `nvidia-smi` (명령이 없거나 장치가 안 보이면 GPU 가 없는 노트북이다).
  PyTorch 에서: `python -c "import torch; print(torch.cuda.is_available(), torch.cuda.device_count())"`
- 메모리 `free -h`, CPU `nproc`, 디스크 `df -h ~` 와 `du -sh ~/* 2>/dev/null | sort -h | tail`
- 파드의 실제 한도는 노트북 설정을 따른다. 메모리가 넘치면 프로세스가 강제로 끝난다 ("Killed").

## 오래 걸리는 작업
명령은 시간 제한 안에 끝나야 하므로, 학습·대량 처리는 이렇게 백그라운드로 띄운다 (`python train.py ...` 부분만 바꿈).
```bash
mkdir -p logs
LOG=logs/train_$(date +%m%d_%H%M).log
nohup bash -c 'python train.py --config cfg.yaml & echo $! > logs/train.pid; wait $!; echo "[pi-done] exit=$?"' > "$LOG" 2>&1 &
echo "[pi-watch] $PWD/$LOG"
```
- 마지막 줄을 보고 pi 가 그 로그를 저절로 지켜본다 (아래 상태 줄에 진행, 끝나면 사용자에게 벨·알림, `/watch` 명령).
  그러니 띄운 뒤에는 `sleep` 과 `tail` 을 되풀이하며 기다리지 말고, 로그 경로와 "끝나면 알림이 뜬다"를 알리고 마친다.
- 사용자가 물으면 진행 확인 `tail -n 20 "<로그>"`, 살아 있는지 `ps -p $(cat logs/train.pid)`, 멈추기 `kill $(cat logs/train.pid)`.
- 결과(모델, 지표, 그림)는 파일로 저장하고 경로를 알려 준다. 다시 해 볼 수 있게 설정·시드·데이터 버전을 함께 남긴다.

## 노트북(.ipynb) 실행·결과 읽기·고치기
- 위에서부터 실행해 결과를 남기기: papermill 이 있으면 (`pip show papermill`)
  `papermill in.ipynb out.ipynb -p lr 0.01 --log-output` (`-p` 값은 'parameters' 태그가 붙은 셀에 들어감),
  없으면 `jupyter nbconvert --to notebook --execute in.ipynb --output out.ipynb --ExecutePreprocessor.timeout=-1`.
  몇 분 넘게 걸리면 위의 백그라운드 방식으로 띄운다 (`python train.py ...` 자리에 이 명령).
- .ipynb 는 큰 JSON 이라 통째로 읽지 않는다. 셀마다 오류와 출력 끝부분만 본다:
```bash
python - out.ipynb <<'EOF'
import json, sys
nb = json.load(open(sys.argv[1], encoding="utf-8"))
for i, c in enumerate(nb["cells"]):
    for o in c.get("outputs", []):
        d = o.get("data", {})
        if o.get("output_type") == "error":
            print(f"[셀 {i}] 오류 {o['ename']}: {o['evalue']}")
        elif "text" in o or "text/plain" in d:
            print(f"[셀 {i}] " + "".join(o.get("text") or d["text/plain"])[-300:])
        if "image/png" in d:
            print(f"[셀 {i}] (그림 출력)")
EOF
```
- 셀을 고칠 때 JSON 을 손으로 고치지 않는다. jupytext 가 있으면 `jupytext --to py:percent x.ipynb` 로 .py 를 만들어 고친 뒤
  `jupytext --update --to notebook x.py` (출력은 남음). 없으면 nbformat 으로:
  `python -c "import nbformat as n; nb=n.read('x.ipynb',4); nb.cells[3].source=nb.cells[3].source.replace('lr=0.1','lr=0.01'); n.write(nb,'x.ipynb')"`
- 사용자가 JupyterLab 에서 그 노트북을 열어 두었으면 저장할 때 서로 덮어쓸 수 있으므로 고치기 전에 알린다.
- 그림 출력은 글로 읽을 수 없으므로, 확인할 그림은 `plt.savefig("results/<이름>.png")` 처럼 파일로 저장하고 경로를 알린다.

## 주의
- 여러 사람이 같이 쓰는 데이터 폴더는 지우거나 덮어쓰지 않는다.
- 노트북 커널에서 도는 작업과 메모리·GPU 를 나눠 쓴다. GPU 가 이미 쓰이고 있으면(`nvidia-smi`) 먼저 알린다.
- PC 의 pi 에서 jupyter 모드로 일할 때는 `/upload`, `/download` 로 PC 와 파일·폴더를 주고받을 수 있다 (1GB 까지).
