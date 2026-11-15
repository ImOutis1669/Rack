from rack.api.auth import (
    MAX_ATTEMPTS,
    WINDOW_SECONDS,
    LoginAttempts,
    hash_password,
    verify_password,
)


def test_password_hash_roundtrip() -> None:
    h = hash_password("correct horse battery")
    assert verify_password("correct horse battery", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", "")
    assert not verify_password("anything", "not-a-hash")


def test_login_attempts_block_and_expire() -> None:
    a = LoginAttempts()
    for _ in range(MAX_ATTEMPTS):
        a.fail("1.2.3.4", now=1000.0)
    assert a.blocked("1.2.3.4", now=1001.0)
    assert not a.blocked("5.6.7.8", now=1001.0)
    assert not a.blocked("1.2.3.4", now=1000.0 + WINDOW_SECONDS + 1)
