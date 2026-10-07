"""SudachiDict から、語ごとの表示用の書き方・品詞・検索用の別名を決める。

chiVe の単語は Sudachi の正規化表記（迚も、其の、為る）なので、普段の書き方（とても、その、する）に戻して表示する。
基本は正規化表記のまま。かなで書かれやすい種類の語（副詞・接続詞など、下の KANA_POS と KANA_WORDS）だけ、
辞書でかなの書き方のコストが漢字の書き方より小さい（かなの方がよく使われる）ときに戻す。
"""

import regex

from sources import sudachi_lines

KANA_POS = {"副詞", "接続詞", "連体詞", "代名詞", "感動詞", "助動詞", "助詞", "接頭辞"}
KANA_WORDS = set(
    "為る 有る 無い 居る 成る 出来る 呉れる 遣る 仕舞う 貰う 御座る 致す 下さる 頂く 見える 良い 宜しい 居らっしゃる 仰る 御座います "
    "事 物 所 為 訳 筈 侭 様 達".split()
)
# 自動では変になるものの手直し。OVERRIDE は書き方を指定、KEEP は漢字のまま残す
# 形容詞などは自動にするとくだけた形（凄い→すげえ）が選ばれるので、よく出るものだけ手で指定する
OVERRIDE = dict(
    pair.split(":")
    for pair in (
        "事:こと 貴方:あなた 確り:しっかり 唯:ただ 矢張り:やはり 決して:けっして 彼奴:あいつ 偶:たま 美味しい:おいしい 可成:かなり 奇麗:きれい "
        "様々:さまざま 余り:あまり 目茶苦茶:めちゃくちゃ 目茶目茶:めちゃめちゃ 目茶:めちゃ 流石:さすが 如何:いかが 可哀想:かわいそう 酷い:ひどい "
        "有り難い:ありがたい 可笑しい:おかしい 真面目:まじめ 真っ直ぐ:まっすぐ 生憎:あいにく 怠い:だるい 仕方無い:仕方ない さり気無い:さりげない "
        "可愛い:かわいい 御八つ:おやつ 御握り:おにぎり 御御籤:おみくじ 御負け:おまけ 御免:ごめん 御萩:おはぎ 御結び:おむすび 御菓子:お菓子 "
        "御礼:お礼 御酒:お酒"
    ).split()
)
KEEP = set("突然 全然 早速 急遽 断然 依然 到底 所詮 突如 少し 時 様 真 相 毎 糞 延々 着々 当分 次々 主な 時折".split())

is_hira = regex.compile(r"[\p{Script=Hiragana}ー]+").fullmatch
has_hira = regex.compile(r"\p{Script=Hiragana}").search


def to_hira(s: str) -> str:
    """カタカナをひらがなにする（辞書の読みはカタカナ）"""
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def analyze(words: list[str]) -> tuple[dict, dict, dict]:
    """words（正規化表記）について、(表示用の書き方, 品詞, 別名 {reading, variants}) を返す"""
    pos_of, reading_of, rank_of, variants_of, readings_of = {}, {}, {}, {}, {}
    kana_pos, costs = {}, {}  # かなに戻すかどうかを決める品詞と、書き方ごとの一番小さいコスト
    for file_index, c in sudachi_lines():
        surface, pos1, conj_type, conj_form, norm = c[4], c[5], c[9], c[10], c[12]
        try:
            cost = float(c[3])
        except ValueError:
            cost = float("nan")
        # 検索用の別名: small_lex.csv にある、正規化表記と違う書き方（カブトムシ → 甲虫）と、すべての読み（甲虫 → こうちゅう、かぶとむし）
        if file_index == 0:
            if surface != norm:
                variants_of.setdefault(norm, {})[surface] = None
            readings_of.setdefault(norm, {})[to_hira(c[11])] = None
        # 品詞と読みは、同じ語の見出しのうち一番よく使われるもの（正規化表記と同じ書き方で、コストが一番小さいもの）から決める。
        # 「円」は普通名詞のほかに人名・地名の見出しもあるので、適当に選ぶと固有名詞になってしまう。コストはよく使われる語ほど小さい（負もある）。
        # ちょうど 0 はコストが付いていない（core_lex.csv の全部と、small_lex.csv の記号など）ので後回しにし、small_lex.csv にある語はそちらを優先する
        rank = (file_index, 0 if surface == norm else 1, cost if cost != 0 else float("inf"))
        if norm not in rank_of or rank < rank_of[norm]:
            rank_of[norm] = rank
            pos_of[norm] = "固有名詞" if pos1 == "名詞" and c[6] == "固有名詞" else pos1
            reading_of[norm] = to_hira(c[11])
        if conj_form not in ("*", "終止形-一般") or conj_type.startswith("文語"):
            continue
        # かなに戻すかどうかの品詞は表示の品詞とは別（こちらを変えると「当然→とうぜん」のように戻しすぎる）
        if norm not in kana_pos or surface == norm:
            kana_pos[norm] = pos1
        cs = costs.setdefault(norm, {})
        if not (cs.get(surface, float("nan")) <= cost):
            cs[surface] = cost

    display = {}
    for w in words:
        if w not in costs or not (kana_pos[w] in KANA_POS or w in KANA_WORDS) or is_hira(w):
            continue
        kana, kana_cost = None, float("inf")
        for sf, cost in costs[w].items():
            if is_hira(sf) and cost < kana_cost:
                kana, kana_cost = sf, cost
        if kana and kana_cost < costs[w].get(w, float("inf")):
            display[w] = kana
    # 「御」で始まる語（御飯、御茶）は、辞書に「お〜」「ご〜」の書き方があればそちらにする（両方あればコストの小さい方）。
    # 辞書のコストは「ゴハン ＜ 御飯 ＜ ご飯」のように普段の使われ方と合わないことがあるので、「御〜」とは比べない
    for w in words:
        if w not in costs or not w.startswith("御") or len(w) < 2 or w in display:
            continue
        best, best_cost = None, float("inf")
        for head in "おご":
            cost = costs[w].get(head + w[1:])
            if cost is not None and cost < best_cost:
                best, best_cost = head + w[1:], cost
        if best:
            display[w] = best
    for w in KEEP:
        display.pop(w, None)
    display.update(OVERRIDE)

    pos = {w: pos_of.get(w, "その他") for w in words}
    alias = {w: {"reading": reading_of.get(w), "variants": list(variants_of.get(w, {})), "readings": list(readings_of.get(w, {}))} for w in words}
    return display, pos, alias
