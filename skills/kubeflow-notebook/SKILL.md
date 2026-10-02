---
name: kubeflow-notebook
description: Kubeflow JupyterLab 노트북 안에서 작업할 때 사용. 패키지 설치, GPU·메모리·디스크 확인, 오래 걸리는 학습·처리를 백그라운드로 실행하고 로그 확인, 파드를 다시 시작해도 남게 저장하기.
---
# Kubeflow 노트북에서 일하기

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
명령은 시간 제한 안에 끝나야 하므로, 학습·대량 처리는 백그라운드로 띄우고 로그를 본다.
```bash
mkdir -p logs
nohup python train.py --config cfg.yaml > logs/train_$(date +%m%d_%H%M).log 2>&1 &
echo $! > logs/train.pid
```
- 진행 확인: `tail -n 20 logs/<로그 파일>`. 살아 있는지: `ps -p $(cat logs/train.pid)`. 멈추기: `kill $(cat logs/train.pid)`.
- 결과(모델, 지표, 그림)는 파일로 저장하고 경로를 알려 준다. 다시 해 볼 수 있게 설정·시드·데이터 버전을 함께 남긴다.

## 주의
- 여러 사람이 같이 쓰는 데이터 폴더는 지우거나 덮어쓰지 않는다.
- 노트북 커널에서 도는 작업과 메모리·GPU 를 나눠 쓴다. GPU 가 이미 쓰이고 있으면(`nvidia-smi`) 먼저 알린다.
- PC 의 pi 에서 jupyter 모드로 일할 때는 `/upload`, `/download` 로 PC 와 파일·폴더를 주고받을 수 있다 (1GB 까지).
