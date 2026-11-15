"""CLIP embedder (open_clip, CPU). Loaded lazily, only in the worker."""

import threading
from typing import Any, Protocol

import numpy as np
from PIL import Image

from rack.ranking.vectors import Mat, normalize_rows


class Embedder(Protocol):
    def embed_images(self, images: list[Image.Image]) -> Mat: ...
    def embed_texts(self, texts: list[str]) -> Mat: ...


class ClipEmbedder:
    def __init__(self, model: str = "ViT-B-32", pretrained: str = "laion2b_s34b_b79k") -> None:
        self.model_name = model
        self.pretrained = pretrained
        self._lock = threading.Lock()
        self._model: Any = None
        self._preprocess: Any = None
        self._tokenizer: Any = None

    def _load(self) -> None:
        with self._lock:
            if self._model is not None:
                return
            import open_clip
            import torch

            torch.set_num_threads(max(1, (torch.get_num_threads() or 2)))
            model, _, preprocess = open_clip.create_model_and_transforms(
                self.model_name, pretrained=self.pretrained
            )
            model.eval()
            self._model = model
            self._preprocess = preprocess
            self._tokenizer = open_clip.get_tokenizer(self.model_name)

    def embed_images(self, images: list[Image.Image]) -> Mat:
        if not images:
            return np.zeros((0, 512), dtype=np.float32)
        self._load()
        import torch

        batch = torch.stack([self._preprocess(img) for img in images])
        with torch.no_grad():
            feats = self._model.encode_image(batch)
        return normalize_rows(feats.float().numpy())

    def embed_texts(self, texts: list[str]) -> Mat:
        if not texts:
            return np.zeros((0, 512), dtype=np.float32)
        self._load()
        import torch

        tokens = self._tokenizer(texts)
        with torch.no_grad():
            feats = self._model.encode_text(tokens)
        return normalize_rows(feats.float().numpy())
