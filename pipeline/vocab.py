"""表示する語の選び方。記号や数字だけの語、ひらがな 1〜2 文字（助詞や助動詞が大半）、カタカナ 1 文字、英字 1 文字、載せない言葉を除く。"""

import regex


def kept_ids(words: list[str], ng: set[str]) -> list[int]:
    """表示する語の chiVe での番号（よく使われる順）。この並びの番号をアプリの中の語の番号にする"""

    def skip(w: str) -> bool:
        return (
            w in ng
            or (regex.fullmatch(r"[\p{P}\p{S}\p{N}\s]+", w) is not None and not regex.search(r"\p{Extended_Pictographic}", w))
            or regex.fullmatch(r"[\p{Script=Hiragana}ー]{1,2}", w) is not None
            or regex.fullmatch(r"[\p{Script=Katakana}ー]", w) is not None
            or regex.fullmatch(r"[A-Za-z]", w) is not None
        )

    return [i for i, w in enumerate(words) if not skip(w)]
