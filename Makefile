# Strata — common tasks. Standard library only; no third-party build deps required.
.PHONY: help install dev test demo run serve build wheel docker docker-run clean

help:
	@echo "make install     - pip install this package (provides the 'strata' CLI)"
	@echo "make test        - run the full offline test suite"
	@echo "make demo        - seed reproducible reviews + monitored claims"
	@echo "make run         - seed demo data and serve on http://127.0.0.1:8600"
	@echo "make build       - build wheel + sdist into dist/"
	@echo "make docker      - build the Docker image 'strata'"
	@echo "make docker-run  - run the container on :8600 (set STRATA_API_KEYS)"
	@echo "make clean       - remove build artifacts"

install:
	python -m pip install .

dev:
	python -m pip install -e .

test:
	python tests/test_strata.py
	python tests/test_review.py
	python tests/test_verify.py

demo:
	python -m strata.cli demo --force

run: demo serve

serve:
	python -m strata.cli serve

build:
	python -m pip install --quiet build && python -m build

wheel:
	python -m pip wheel . --no-deps -w dist

docker:
	docker build -t strata .

docker-run:
	docker run --rm -p 8600:8600 -v strata-data:/data -e STRATA_API_KEYS=$${STRATA_API_KEYS:-} strata

clean:
	rm -rf dist build *.egg-info .strata
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
