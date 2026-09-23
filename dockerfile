FROM continuumio/miniconda3

WORKDIR /app

COPY DRUID/environment.yml /app/DRUID/environment.yml

RUN conda env create -f /app/DRUID/environment.yml && \
    conda clean -afy 

SHELL ["conda", "run", "-n", "DRUID", "/bin/bash", "-c"]

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    python-multipart \
    jinja2

COPY . /app/

RUN cd /app/DRUID && \
    pip install .


EXPOSE 8000
