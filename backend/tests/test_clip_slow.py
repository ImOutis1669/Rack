import numpy as np
import pytest
from PIL import Image

from rack.embeddings.clip import ClipEmbedder

pytestmark = pytest.mark.slow


def test_real_clip_embeddings() -> None:
    emb = ClipEmbedder()
    imgs = emb.embed_images([Image.new("RGB", (224, 224), c) for c in ("red", "blue")])
    texts = emb.embed_texts(["a plain red square", "a plain blue square"])
    assert imgs.shape == (2, 512) and texts.shape == (2, 512)
    assert np.allclose(np.linalg.norm(imgs, axis=1), 1.0, atol=1e-4)
    cross = texts @ imgs.T
    assert cross[0, 0] > cross[0, 1] and cross[1, 1] > cross[1, 0]
