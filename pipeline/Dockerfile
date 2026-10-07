# データを作るための環境（Python と、FAISS・UMAP などのライブラリ）。コードはイメージに入れず、compose でマウントする
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends vim-tiny && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# 元データと途中結果を置く場所（名前付きボリュームにする）。手元のユーザーで動かしても書き込めるようにしておく
RUN mkdir /work && chmod 777 /work
# PYTHONDONTWRITEBYTECODE: マウントした手元の pipeline/ に __pycache__ を作らない
ENV HOME=/tmp NUMBA_CACHE_DIR=/tmp/numba EDITOR=vim.tiny PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
ENTRYPOINT ["python", "-m"]
