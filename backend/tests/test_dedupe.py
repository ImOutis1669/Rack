import io

import numpy as np
from PIL import Image, ImageDraw

from rack.embeddings.phash import hamming, phash
from rack.ranking.dedupe import clusters
from rack.ranking.vectors import as_matrix


def photo(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    img = Image.new("RGB", (400, 500), "white")
    d = ImageDraw.Draw(img)
    for _ in range(12):
        x, y = rng.integers(0, 350, 2)
        d.rectangle(
            [int(x), int(y), int(x) + 60, int(y) + 90],
            fill=tuple(int(c) for c in rng.integers(0, 255, 3)),
        )
    return img


def recompress(img: Image.Image) -> Image.Image:
    buf = io.BytesIO()
    img.resize((300, 375)).save(buf, format="JPEG", quality=60)
    return Image.open(io.BytesIO(buf.getvalue()))


def test_phash_survives_resize_and_jpeg_but_separates_items() -> None:
    a = phash(photo(1))
    assert hamming(a, phash(recompress(photo(1)))) <= 6
    assert hamming(a, phash(photo(2))) > 12


def test_clusters_need_both_hash_and_embedding_agreement() -> None:
    e1, e2 = np.eye(4, dtype=np.float32)[0], np.eye(4, dtype=np.float32)[1]
    h = "f0f0f0f0f0f0f0f0"
    near = "f0f0f0f0f0f0f0f1"
    other = "0f0f0f0f0f0f0f0f"
    out = clusters(
        [1, 2, 3, 4],
        [h, near, other, h],
        as_matrix([e1, e1, e1, e2], dim=4),
        [100.0, 80.0, 50.0, 10.0],
    )
    # 1 & 2 match on both; 3 has a different hash; 4 has the same hash but different content
    assert out == {1: 2, 2: 2}


def test_shared_placeholder_photos_are_never_merged() -> None:
    e = np.eye(4, dtype=np.float32)[0]
    h = "abcdabcdabcdabcd"
    out = clusters(list(range(1, 8)), [h] * 7, as_matrix([e] * 7, dim=4), [10.0] * 7)
    assert out == {}


def test_different_known_brands_are_never_merged() -> None:
    e = np.eye(4, dtype=np.float32)[0]
    h = "abcdabcdabcdabcd"
    embs = as_matrix([e, e, e], dim=4)
    out = clusters(
        [1, 2, 3], [h] * 3, embs, [90.0, 185.0, 50.0], ["Rick Owens", "Maison Margiela", None]
    )
    # the unbranded copy may join either, but Rick Owens and Margiela never share a cluster
    assert out.get(1) is None or out.get(1) != out.get(2)
    assert clusters(
        [1, 2], [h] * 2, as_matrix([e, e], dim=4), [1.0, 2.0], ["Rick Owens DRKSHDW", "rick owens"]
    ) == {1: 1, 2: 1}


def test_unrelated_titles_are_never_merged() -> None:
    e = np.eye(4, dtype=np.float32)[0]
    h = "abcdabcdabcdabcd"
    two = as_matrix([e, e], dim=4)
    titles = [
        "Maison Margiela Replica GAT Sneakers White EU 46",
        "Rick Owens DRKSHDW Long Sleeve Tee Black L",
    ]
    assert clusters([1, 2], [h, h], two, [1.0, 2.0], None, titles) == {}
    sizes = [
        "Rick Owens Drkshdw Jumbo Belas Cargo Pants 34",
        "Rick Owens Drkshdw Jumbo Belas Cargo Pants 30",
    ]
    assert clusters([1, 2], [h, h], two, [1.0, 2.0], None, sizes) == {1: 1, 2: 1}
