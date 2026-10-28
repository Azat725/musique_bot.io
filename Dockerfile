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
CMD ["python", "-m", "server"]
