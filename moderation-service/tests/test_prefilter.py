from prefilter import is_risky_text, prefilter


def test_phone_intercepted():
    hit, reason = prefilter("联系我 13800138000", [])
    assert hit is True
    assert "手机号" in reason


def test_url_intercepted():
    hit, _ = prefilter("看这个 https://evil.example.com/a?token=1", [])
    assert hit is True
    hit, _ = prefilter("访问 www.example.com", [])
    assert hit is True


def test_email_intercepted():
    hit, reason = prefilter("发我邮箱 test@example.com", [])
    assert hit is True
    assert "邮箱" in reason


def test_id_card_intercepted():
    hit, reason = prefilter("身份证 11010519491231002X", [])
    assert hit is True
    assert "身份证" in reason


def test_neutral_text_not_intercepted():
    hit, reason = prefilter("今天分享一首歌，希望大家喜欢", ["https://cdn.example.com/a.jpg"])
    assert hit is False
    assert reason == ""


def test_risky_text_detection():
    assert is_risky_text("加微信 abcdef12 私聊") is True
    assert is_risky_text("代购日结兼职") is True
    assert is_risky_text("今天天气不错，分享一首歌") is False
    assert is_risky_text("") is False
