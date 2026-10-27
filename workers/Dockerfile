FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd -m -u 10001 video
COPY workers/trade_lord_video.py ./trade_lord_video.py
USER video
ENV OMP_NUM_THREADS=2
CMD ["python", "/app/trade_lord_video.py"]
