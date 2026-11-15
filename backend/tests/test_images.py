import io

import pytest
from PIL import Image

from rack.embeddings.images import ImageError, assert_public_url, open_image, sanitize_upload


def jpeg_with_exif() -> bytes:
    img = Image.new("RGB", (64, 32), "red")
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # Make
    exif[0x0112] = 6  # orientation: rotate 90
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_sanitize_strips_exif_and_applies_rotation() -> None:
    out = Image.open(io.BytesIO(sanitize_upload(jpeg_with_exif())))
    assert dict(out.getexif()) == {}
    assert out.size == (32, 64)


def test_rejects_non_images() -> None:
    with pytest.raises(ImageError):
        open_image(b"<html>not an image</html>")


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/a.jpg",
        "http://localhost/a.jpg",
        "file:///etc/passwd",
        "http://10.0.0.5/x.jpg",
        "http://[::1]/x",
    ],
)
async def test_private_urls_blocked(url: str) -> None:
    with pytest.raises(ImageError):
        await assert_public_url(url)
