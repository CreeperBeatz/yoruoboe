"""Card rendering as desktop's reviewer does it (aqt/reviewer.py, aqt/sound.py), for the
reviewer, the previewer and the card template editor.

The backend renders the templates; what is left is the reviewer's own work: play
buttons for [anki:play:q:N] references, the type-in-answer box and its comparison, and
the list of sounds and TTS to play, which the app plays in the browser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from anki.cards import Card
from anki.collection import Collection
from anki.sound import AV_REF_RE, SoundOrVideoTag, TTSTag, strip_av_refs

TYPE_ANS_PAT = re.compile(r"\[\[type:(.+?)\]\]")

PLAY_BUTTON = """<a class="replay-button soundLink" href=# onclick="pycmd('{ref}'); return false;" draggable="false">
    <svg class="playImage" viewBox="0 0 64 64" version="1.1">
        <circle cx="32" cy="32" r="29" />
        <path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" />
    </svg>
</a>"""


def av_tags(tags) -> list[dict]:
    out = []
    for t in tags:
        if isinstance(t, SoundOrVideoTag):
            out.append({"kind": "sound", "filename": t.filename})
        elif isinstance(t, TTSTag):
            out.append({
                "kind": "tts", "text": t.field_text, "lang": t.lang, "voices": list(t.voices),
                "speed": t.speed, "otherArgs": list(t.other_args),
            })
    return out


def prepare(col: Collection, text: str, hide_play_buttons: bool) -> str:
    """aqt.main.prepare_card_text_for_display: escape media names, add play buttons."""
    text = col.media.escape_media_filenames(text)
    if hide_play_buttons:
        return strip_av_refs(text)
    return AV_REF_RE.sub(lambda m: PLAY_BUTTON.format(ref=m.group(1)), text)


@dataclass
class TypeAnswer:
    """What the question side's type-in box compares against on the answer side."""

    correct: str | None = None
    font: str = "Arial"
    size: int = 20
    combining: bool = True
    found: bool = field(default=False)


def type_answer_question(card: Card, col: Collection, html: str) -> tuple[str, TypeAnswer]:
    ta = TypeAnswer()
    m = TYPE_ANS_PAT.search(html)
    if not m:
        return html, ta
    ta.found = True
    fld = m.group(1)
    cloze_idx = None
    if fld.startswith("cloze:"):
        cloze_idx = card.ord + 1
        fld = fld.split(":")[1]
    if fld.startswith("nc:"):
        ta.combining = False
        fld = fld.split(":")[1]
    for f in card.note_type()["flds"]:
        if f["name"] == fld:
            ta.correct = card.note()[f["name"]]
            if cloze_idx:
                ta.correct = col.extract_cloze_for_typing(ta.correct, cloze_idx) or None
            ta.font = f["font"]
            ta.size = f["size"]
            break
    if not ta.correct:
        if ta.correct is None:
            warn = (
                col.tr.studying_please_run_toolsempty_cards()
                if cloze_idx
                else col.tr.studying_type_answer_unknown_field(val=fld)
            )
            return TYPE_ANS_PAT.sub(lambda _: warn, html), ta
        return TYPE_ANS_PAT.sub("", html), ta
    box = (
        f'\n<center>\n<input type=text id=typeans onkeypress="_typeAnsPress();"\n'
        f"   style=\"font-family: '{ta.font}'; font-size: {ta.size}px;\">\n</center>\n"
    )
    return TYPE_ANS_PAT.sub(lambda _: box, html), ta


def type_answer_answer(col: Collection, html: str, ta: TypeAnswer, typed: str) -> str:
    if not ta.correct:
        return TYPE_ANS_PAT.sub("", html)
    orig = html
    stripped = html.replace("<hr id=answer>", "")
    had_hr = len(stripped) != len(html)
    output = col.compare_answer(ta.correct, typed, ta.combining)

    def repl(_m: re.Match) -> str:
        s = f"\n<div style=\"font-family: '{ta.font}'; font-size: {ta.size}px\">{output}</div>"
        return f"<hr id=answer>{s}" if had_hr else s

    if had_hr and not TYPE_ANS_PAT.search(stripped):
        return orig
    return TYPE_ANS_PAT.sub(repl, stripped)


def body_class(card: Card) -> str:
    return f"card card{card.ord + 1}"


def deck_conf_for_card(col: Collection, card: Card) -> dict:
    conf = col.decks.config_dict_for_deck_id(card.current_deck_id())
    return {
        "autoplay": bool(conf.get("autoplay", True)),
        "replayQuestion": bool(conf.get("replayq", True)),
        "showTimer": bool(conf.get("timer", 0)),
        "maxTakenSecs": int(conf.get("maxTaken", 60)),
        "stopTimerOnAnswer": bool(conf.get("stopTimerOnAnswer", True)),
        "secondsToShowQuestion": float(conf.get("secondsToShowQuestion", 0) or 0),
        "secondsToShowAnswer": float(conf.get("secondsToShowAnswer", 0) or 0),
        "questionAction": int(conf.get("questionAction", 0) or 0),
        "answerAction": int(conf.get("answerAction", 0) or 0),
        "waitForAudio": bool(conf.get("waitForAudio", True)),
    }
