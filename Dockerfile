FROM python:3.12-slim

# ffmpeg: re-encoding and HLS remux; nodejs: solves YouTube's JS challenges for yt-dlp
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt "yt-dlp[default]"
COPY server server

ENV HOST=0.0.0.0 PORT=8000 DATA_DIR=/data TUNNEL=none PYTHONUNBUFFERED=1
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1
CMD ["python", "-m", "server"]
