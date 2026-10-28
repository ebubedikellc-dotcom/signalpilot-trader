FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt 'yt-dlp[default]' deno && useradd -m -u 10001 hub && mkdir /data && chown hub:hub /data
COPY workers /app/workers
COPY training-hub /app/hub
WORKDIR /app/hub
USER hub
ENV HUB_DATA=/data
CMD ["python", "server.py"]
