from security import redact_url, validate_image_url


def test_scheme_restriction():
    assert validate_image_url("ftp://example.com/a.jpg")[0] is False
    assert validate_image_url("file:///etc/passwd")[0] is False
    assert validate_image_url("https://example.com/a.jpg")[0] is True


def test_private_and_loopback_blocked():
    blocked = [
        "http://127.0.0.1/a.jpg",
        "http://localhost/a.jpg",
        "http://10.1.2.3/a.jpg",
        "http://172.16.0.1/a.jpg",
        "http://192.168.1.1/a.jpg",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]/a.jpg",
        "http://100.64.0.1/a.jpg",
    ]
    for url in blocked:
        ok, _ = validate_image_url(url)
        assert ok is False, url


def test_credentials_in_url_rejected():
    assert validate_image_url("https://user:pass@example.com/a.jpg")[0] is False


def test_length_limit():
    long_url = "https://example.com/" + "a" * 2100
    assert validate_image_url(long_url)[0] is False


def test_redact_url_removes_query_and_credentials():
    redacted = redact_url(
        "https://user:pass@cdn.example.com/path/to/image.jpg?token=SECRET#frag"
    )
    assert "SECRET" not in redacted
    assert "token" not in redacted
    assert "user" not in redacted
    assert redacted.startswith("https://cdn.example.com/")
