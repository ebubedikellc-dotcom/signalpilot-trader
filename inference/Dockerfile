# Deploy as a Render PRIVATE service, never a public web service.
FROM ollama/ollama:latest
ENV OLLAMA_HOST=0.0.0.0:11434 \
    OLLAMA_MODELS=/var/lib/ollama/models \
    OLLAMA_CONTEXT_LENGTH=4096 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_MAX_QUEUE=3 \
    TRADE_LORD_MODEL=qwen3:4b-q4_K_M
COPY inference/start.sh /app/start.sh
EXPOSE 11434
ENTRYPOINT ["/bin/sh", "/app/start.sh"]
